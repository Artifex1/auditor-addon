import { z } from "zod";
import fs from "fs/promises";
import { encode } from "@toon-format/toon";
import { SymbolGraph, ScanStatus, Confidence, ResolvedBy, SupportedLanguage } from "../../engine/types.js";
import { readScanState, writeScanState } from "../../static/persistence.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Engine } from "../../engine/index.js";

export const sastResolveGapsSchema = {
    description: "Resolve gaps in a SAiST scan by providing facts the static pass could not determine. Merges resolutions into the persisted symbol graph. Supply resolvedTo: { file, line } to redirect the walker to the concrete implementation.",
    inputSchema: {
        scanId: z.string().describe("Scan ID from sast_init_scan"),
        resolutions: z.array(z.object({
            gapId: z.string().describe("Gap ID to resolve"),
            facts: z.record(z.unknown()).describe("Partial GraphNode facts to merge. Include resolvedTo: { file, line } to redirect the walker to the concrete symbol."),
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

            const graph = SymbolGraph.fromJSON(state.graph);

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

            // ── Phase 2: batch-generate graphs for missing files, merge into main graph ──
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
                        const newGraph = await adapter.generateGraph(files);
                        graph.merge(newGraph);
                    } catch {
                        // Adapter error for this language — continue with others
                    }
                }

                // Add new source files to state
                for (const [filePath, content] of missingFiles) {
                    state.sourceFiles[filePath] = content;
                }
            }

            // ── Phase 3: apply resolutions ──
            let applied = 0;
            const appliedGapIds = new Set<string>();

            for (const resolution of input.resolutions) {
                const gap = state.gaps.find(g => g.id === resolution.gapId);
                if (!gap) continue;

                const resolvedTo = resolution.facts.resolvedTo as { file: string; line: number } | undefined;

                // Find the gap node by qualified name
                const gapNodes = graph.findByName(gap.qualifiedName);
                const gapNode = gapNodes.find(n => n.status === 'gap') ?? gapNodes[0];

                if (gapNode) {
                    // If resolvedTo provided, find the concrete node and update this gap node to point to it
                    if (resolvedTo) {
                        const concreteNode = graph.findByLine(resolvedTo.file, resolvedTo.line);
                        if (concreteNode) {
                            // Update the gap node to redirect to the concrete node
                            graph.updateNode(gapNode.id, {
                                status: 'concrete',
                                resolvedBy: resolution.resolvedBy as ResolvedBy,
                                confidence: resolution.confidence,
                                locator: concreteNode.locator,
                            });
                        }
                    } else {
                        // Apply partial facts directly to the gap node
                        const { resolvedTo: _stripped, ...nodeFacts } = resolution.facts;
                        graph.updateNode(gapNode.id, {
                            ...nodeFacts as any,
                            resolvedBy: resolution.resolvedBy as ResolvedBy,
                            confidence: resolution.confidence,
                        });
                    }
                }

                appliedGapIds.add(resolution.gapId);
                applied++;
            }

            // ── Phase 4: persist ──
            const remaining = state.gaps.filter(g => !appliedGapIds.has(g.id));
            const status: ScanStatus = remaining.length === 0 ? 'ready' : 'needs_resolution';

            state.graph = graph.toJSON();
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
