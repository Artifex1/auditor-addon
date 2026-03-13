import { z } from "zod";
import { encode } from "@toon-format/toon";
import { SymbolEntry, ScanStatus, Confidence, ResolvedBy } from "../../engine/types.js";
import { readScanState, writeScanState, recordToSymbolMap, symbolMapToRecord } from "../../static/persistence.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const sastResolveGapsSchema = {
    description: "Resolve gaps in a SAiST scan by providing facts the static pass could not determine. Merges resolutions into the persisted symbol map.",
    inputSchema: {
        scanId: z.string().describe("Scan ID from sast_init_scan"),
        resolutions: z.array(z.object({
            gapId: z.string().describe("Gap ID to resolve"),
            facts: z.record(z.unknown()).describe("Partial SymbolEntry facts to merge"),
            resolvedBy: z.enum(['agent', 'manual']).describe("Who resolved this gap"),
            confidence: z.enum(['high', 'medium', 'low']).describe("Confidence in the resolution"),
        })).describe("Array of gap resolutions"),
    },
};

export function createSastResolveGapsHandler() {
    return async (input: {
        scanId: string;
        resolutions: Array<{
            gapId: string;
            facts: Partial<SymbolEntry>;
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
            let applied = 0;

            for (const resolution of input.resolutions) {
                const gap = state.gaps.find(g => g.id === resolution.gapId);
                if (!gap) continue;

                // Merge facts into the symbol map
                const existing = symbolMap.get(gap.qualifiedName);
                if (existing) {
                    const merged: SymbolEntry = {
                        ...existing,
                        ...resolution.facts as Partial<SymbolEntry>,
                        resolvedBy: resolution.resolvedBy as ResolvedBy,
                        confidence: resolution.confidence,
                    };
                    symbolMap.set(gap.qualifiedName, merged);
                } else if (resolution.facts.qualifiedName) {
                    // New entry from resolution
                    symbolMap.set(gap.qualifiedName, {
                        qualifiedName: gap.qualifiedName,
                        file: gap.callSite.file,
                        line: gap.callSite.line,
                        language: 'solidity' as any, // will be overridden by facts
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
                        ...resolution.facts as Partial<SymbolEntry>,
                    });
                }

                applied++;
            }

            // Remove resolved gaps
            const resolvedGapIds = new Set(
                input.resolutions.filter((_, i) => i < applied).map(r => r.gapId)
            );
            const remaining = state.gaps.filter(g => !resolvedGapIds.has(g.id));

            const status: ScanStatus = remaining.length === 0 ? 'ready' : 'needs_resolution';

            // Update persisted state
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
