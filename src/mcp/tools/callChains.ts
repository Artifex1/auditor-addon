import { z } from "zod";
import { encode } from "@toon-format/toon";
import { Engine } from "../../engine/index.js";
import { computeHotspots, resolvePaths } from "../../static/hotspots.js";

// ==========================================
// Configuration
// ==========================================
const MAX_PATHS_PER_ENTRYPOINT = 10;
const MAX_DEPTH = 10;

// ==========================================
// Schema
// ==========================================
export const callChainsSchema = {
    description: "Generate call chains from root functions (functions nothing else calls). Chains are grouped by root and sorted longest-first. A hotspot summary identifies functions appearing across the most chains.",
    inputSchema: {
        paths: z.array(z.string()).describe("File paths or glob patterns to analyze")
    }
};

// ==========================================
// Implementation
// ==========================================
export function createCallChainsHandler(engine: Engine) {
    return async ({ paths }: { paths: string[] }) => {
        try {
            const symbolMap = await engine.processSymbolMap(paths);

            // Root nodes: functions that nothing else calls
            const allCalleeIds = new Set<string>();
            for (const entry of symbolMap.values()) {
                for (const callee of entry.callees) {
                    allCalleeIds.add(callee.qualifiedName);
                }
            }
            const roots = [...symbolMap.keys()].filter(id => !allCalleeIds.has(id));

            // Generate chains grouped by root
            const chainsByRoot: Record<string, string[]> = {};

            for (const rootId of roots) {
                const rawPaths = resolvePaths(rootId, symbolMap, 0, new Set(), MAX_DEPTH, true);
                const chains = rawPaths.map(p => p.join(' -> '));

                // Longest chains first — they show the deepest logic
                chains.sort((a, b) => b.split(' -> ').length - a.split(' -> ').length);

                chainsByRoot[rootId] = chains.slice(0, MAX_PATHS_PER_ENTRYPOINT);
            }

            // Hotspots via shared utility
            const hotspots = computeHotspots(symbolMap);

            return {
                content: [{
                    type: "text" as const,
                    text: encode({ call_chains: chainsByRoot, hotspots })
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: "text" as const,
                    text: `Error generating call chains: ${error instanceof Error ? error.message : String(error)}`
                }]
            };
        }
    };
}

