import { z } from "zod";
import fs from "fs/promises";
import { encode } from "@toon-format/toon";
import { SymbolEntry, ScanStatus, Confidence, ResolvedBy, SupportedLanguage } from "../../engine/types.js";
import { readScanState, writeScanState, recordToSymbolMap, symbolMapToRecord, buildLocatorIndex } from "../../static/persistence.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Engine } from "../../engine/index.js";

export const sastResolveGapsSchema = {
    description: "Resolve gaps in a SAiST scan by providing facts the static pass could not determine. Merges resolutions into the persisted symbol map. Supply resolvedTo: { file, line } to redirect the walker to the concrete implementation.",
    inputSchema: {
        scanId: z.string().describe("Scan ID from sast_init_scan"),
        resolutions: z.array(z.object({
            gapId: z.string().describe("Gap ID to resolve"),
            facts: z.record(z.unknown()).describe("Partial SymbolEntry facts to merge. Include resolvedTo: { file, line } to redirect the walker to the concrete symbol."),
            resolvedBy: z.enum(['agent', 'manual']).describe("Who resolved this gap"),
            confidence: z.enum(['high', 'medium', 'low']).describe("Confidence in the resolution"),
        })).describe("Array of gap resolutions"),
    },
};

export function createSastResolveGapsHandler(engine: Engine) {
    return async (input: {
        scanId: string;
        resolutions: Array<{
            gapId: string;
            facts: Record<string, unknown> & { resolvedTo?: { file: string; line: number } };
            resolvedBy: 'agent' | 'manual';
            confidence: Confidence;
        }>;
    }): Promise<CallToolResult> => {
        try {
            const state = await readScanState(input.scanId);
            if (!state) {
                return {
                    content: [{ type: "text", text: `Error: Scan ${input.scanId} not found` }],
                };
            }

            const symbolMap = recordToSymbolMap(state.symbolMap);

            // ── Phase 1: collect all files referenced by resolvedTo that are not yet in scope ──
            const missingFiles = new Map<string, string>(); // filePath → content

            for (const resolution of input.resolutions) {
                const resolvedTo = resolution.facts.resolvedTo as { file: string; line: number } | undefined;
                if (resolvedTo && !state.sourceFiles[resolvedTo.file] && !missingFiles.has(resolvedTo.file)) {
                    try {
                        const content = await fs.readFile(resolvedTo.file, 'utf-8');
                        missingFiles.set(resolvedTo.file, content);
                    } catch {
                        // Unreadable — skip; gap will remain unlinked
                    }
                }
            }

            // ── Phase 2: batch-generate symbol maps for missing files, grouped by language ──
            if (missingFiles.size > 0) {
                const byLanguage = new Map<SupportedLanguage, { path: string; content: string }[]>();

                for (const [filePath, content] of missingFiles) {
                    const lang = engine.detectLanguage(filePath, content);
                    if (!lang) continue;
                    const adapter = engine.getAdapter(lang);
                    if (!adapter) continue;
                    if (!byLanguage.has(lang)) byLanguage.set(lang, []);
                    byLanguage.get(lang)!.push({ path: filePath, content });
                }

                for (const [lang, files] of byLanguage) {
                    const adapter = engine.getAdapter(lang)!;
                    try {
                        const newSymbols = await adapter.generateSymbolMap(files);
                        for (const [qn, entry] of newSymbols) {
                            symbolMap.set(qn, entry);
                        }
                    } catch {
                        // Adapter error for this language — continue with others
                    }
                }

                // Add new source files to state and rebuild the locator index over the full map
                for (const [filePath, content] of missingFiles) {
                    state.sourceFiles[filePath] = content;
                }
                state.locatorIndex = buildLocatorIndex(symbolMap);
            }

            // ── Phase 3: apply resolutions ──
            let applied = 0;

            for (const resolution of input.resolutions) {
                const gap = state.gaps.find(g => g.id === resolution.gapId);
                if (!gap) continue;

                const resolvedTo = resolution.facts.resolvedTo as { file: string; line: number } | undefined;
                const redirectTo = resolvedTo
                    ? state.locatorIndex[`${resolvedTo.file}:${resolvedTo.line}`]
                    : undefined;

                // Strip the meta-key before merging into SymbolEntry
                const { resolvedTo: _stripped, ...entryFacts } = resolution.facts as Record<string, unknown> & { resolvedTo?: unknown };

                const existing = symbolMap.get(gap.qualifiedName);
                if (existing) {
                    symbolMap.set(gap.qualifiedName, {
                        ...existing,
                        ...entryFacts as Partial<SymbolEntry>,
                        resolvedBy: resolution.resolvedBy as ResolvedBy,
                        confidence: resolution.confidence,
                        ...(redirectTo ? { redirectTo } : {}),
                    });
                } else {
                    symbolMap.set(gap.qualifiedName, {
                        qualifiedName: gap.qualifiedName,
                        kind: 'function',
                        file: gap.callSite.file,
                        line: gap.callSite.line,
                        language: 'solidity' as any,
                        label: gap.qualifiedName.split('.').pop() ?? gap.qualifiedName,
                        writesState: [],
                        readsState: [],
                        callsExternal: false,
                        callees: [],
                        isPublic: false,
                        hasAccessControl: false,
                        modifiers: [],
                        resolvedBy: resolution.resolvedBy as ResolvedBy,
                        confidence: resolution.confidence,
                        visibility: 'internal',
                        ...entryFacts as Partial<SymbolEntry>,
                        ...(redirectTo ? { redirectTo } : {}),
                    });
                }

                applied++;
            }

            // ── Phase 4: persist ──
            const resolvedGapIds = new Set(
                input.resolutions.filter((_, i) => i < applied).map(r => r.gapId)
            );
            const remaining = state.gaps.filter(g => !resolvedGapIds.has(g.id));
            const status: ScanStatus = remaining.length === 0 ? 'ready' : 'needs_resolution';

            state.symbolMap = symbolMapToRecord(symbolMap);
            state.gaps = remaining;
            state.status = status;
            state.updatedAt = new Date().toISOString();
            await writeScanState(state);

            return {
                content: [{
                    type: "text",
                    text: encode({
                        scanId: input.scanId,
                        applied,
                        expandedFiles: missingFiles.size,
                        remainingCount: remaining.length,
                        status,
                    }),
                }],
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Error resolving gaps: ${error instanceof Error ? error.message : String(error)}`,
                }],
            };
        }
    };
}
