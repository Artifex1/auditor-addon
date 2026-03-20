import fs from "fs/promises";
import path from "path";
import os from "os";
import {
    SymbolMap, SymbolEntry, SupportedLanguage,
    ScanContext, EffectiveLanguageMeta, ScanStatus,
    RuleFinding
} from "../engine/types.js";
export type LocatorIndex = Record<string, string>; // "file:line" → qualifiedName
import { SymbolGap } from "./symbol-table.js";

export type SerializedSymbolMap = Record<string, SymbolEntry>;

export interface ScanState {
    scanId: string;
    files: string[];
    languages: SupportedLanguage[];
    context: ScanContext;
    effective: Record<string, EffectiveLanguageMeta>;
    symbolMap: SerializedSymbolMap;
    gaps: SymbolGap[];
    status: ScanStatus;
    findings: RuleFinding[];
    sourceFiles: Record<string, string>;
    // "file:line" → qualifiedName — built at init, updated on dynamic expansion.
    // Enables unambiguous resolution of overloaded and same-named symbols.
    locatorIndex: LocatorIndex;
    createdAt: string;
    updatedAt: string;
}

/** Build a locator index from a symbol map. O(n) over the map. */
export function buildLocatorIndex(symbolMap: SymbolMap): LocatorIndex {
    const index: LocatorIndex = {};
    for (const [qn, entry] of symbolMap) {
        if (entry.range) {
            index[`${entry.file}:${entry.range.start.line}`] = qn;
        } else if (entry.line) {
            index[`${entry.file}:${entry.line}`] = qn;
        }
    }
    return index;
}

function getScanPath(id: string): string {
    return path.join(os.tmpdir(), `saist-${id}.json`);
}

export async function writeScanState(state: ScanState): Promise<string> {
    const filePath = getScanPath(state.scanId);
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
    return filePath;
}

export async function readScanState(id: string): Promise<ScanState | null> {
    const filePath = getScanPath(id);
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as ScanState;
    } catch {
        return null;
    }
}

export async function deleteScanState(id: string): Promise<void> {
    const filePath = getScanPath(id);
    try {
        await fs.unlink(filePath);
    } catch {
        // ignore if already deleted
    }
}

export function symbolMapToRecord(symbolMap: SymbolMap): SerializedSymbolMap {
    const record: SerializedSymbolMap = {};
    for (const [key, value] of symbolMap) {
        record[key] = value;
    }
    return record;
}

export function recordToSymbolMap(record: SerializedSymbolMap): SymbolMap {
    const map: SymbolMap = new Map();
    for (const [key, value] of Object.entries(record)) {
        map.set(key, value);
    }
    return map;
}
