import fs from "fs/promises";
import path from "path";
import os from "os";
import {
    SymbolGraph, SerializedGraph, SupportedLanguage,
    ScanContext, EffectiveLanguageMeta, ScanStatus,
    RuleFinding
} from "../engine/types.js";
import { SymbolGap } from "./symbol-table.js";

export interface ScanState {
    scanId: string;
    files: string[];
    languages: SupportedLanguage[];
    context: ScanContext;
    effective: Record<string, EffectiveLanguageMeta>;
    graph: SerializedGraph;
    gaps: SymbolGap[];
    status: ScanStatus;
    findings: RuleFinding[];
    sourceFiles: Record<string, string>;
    createdAt: string;
    updatedAt: string;
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
