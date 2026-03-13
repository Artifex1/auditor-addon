import crypto from "crypto";
import {
    SymbolMap, LanguageAdapter, FileContent, SupportedLanguage,
    ScanContext, EffectiveLanguageMeta, ScanStatus,
    LANGUAGE_META, RuleFinding
} from "../engine/types.js";
import { computeHotspots } from "./hotspots.js";
import { detectGaps, SymbolGap } from "./symbol-table.js";
import { writeScanState, ScanState, symbolMapToRecord } from "./persistence.js";

export interface ScanResult {
    scanId: string;
    symbolMap: SymbolMap;
    gaps: SymbolGap[];
    hotspots: string[];
    status: ScanStatus;
    effective: Record<string, EffectiveLanguageMeta>;
    persistedPath: string;
}

/**
 * Resolves effective language metadata by merging LANGUAGE_META defaults
 * with scan context overrides.
 */
export function resolveEffective(
    languages: SupportedLanguage[],
    context?: ScanContext
): Record<string, EffectiveLanguageMeta> {
    const result: Record<string, EffectiveLanguageMeta> = {};
    for (const lang of languages) {
        const base = LANGUAGE_META[lang];
        const domainOverride = context?.domainOverrides?.[lang];
        result[lang] = {
            domain: domainOverride ?? base.domain,
            inheritanceModel: base.inheritanceModel,
            framework: context?.framework,
        };
    }
    return result;
}

/**
 * Orchestrates a static analysis scan:
 * 1. Calls adapter.generateSymbolMap() per language
 * 2. Computes effective language metadata from context
 * 3. Computes hotspots from the combined symbol map
 * 4. Detects gaps with hotspot-based priority
 * 5. Persists the full scan state to disk
 */
export async function runScan(
    filesByLanguage: Map<SupportedLanguage, { adapter: LanguageAdapter; files: FileContent[] }>,
    context?: ScanContext,
    sourceFiles?: Map<string, string>
): Promise<ScanResult> {
    const combined: SymbolMap = new Map();
    const allFiles: string[] = [];
    const languages: SupportedLanguage[] = [];

    for (const [lang, { adapter, files }] of filesByLanguage) {
        languages.push(lang);
        const symbolMap = await adapter.generateSymbolMap(files);
        for (const [id, entry] of symbolMap) {
            combined.set(id, entry);
        }
        for (const f of files) {
            allFiles.push(f.path);
        }
    }

    const effective = resolveEffective(languages, context);
    const hotspots = computeHotspots(combined);
    const gaps = detectGaps(combined, hotspots, sourceFiles);

    const status: ScanStatus = gaps.length === 0 ? 'ready' : 'needs_resolution';
    const scanId = crypto.randomUUID().slice(0, 8);

    // Serialize sourceFiles for persistence
    const serializedSources: Record<string, string> = {};
    if (sourceFiles) {
        for (const [p, c] of sourceFiles) {
            serializedSources[p] = c;
        }
    }

    const state: ScanState = {
        scanId,
        files: allFiles,
        languages,
        context: context ?? {},
        effective,
        symbolMap: symbolMapToRecord(combined),
        gaps,
        status,
        findings: [] as RuleFinding[],
        sourceFiles: serializedSources,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    const persistedPath = await writeScanState(state);

    return {
        scanId,
        symbolMap: combined,
        gaps,
        hotspots,
        status,
        effective,
        persistedPath,
    };
}
