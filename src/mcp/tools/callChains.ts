import { z } from "zod";
import { encode } from "@toon-format/toon";
import { Engine } from "../../engine/index.js";
import { CallGraph } from "../../engine/types.js";

// ==========================================
// Configuration
// ==========================================
const MAX_PATHS_PER_ENTRYPOINT = 10;
const MAX_DEPTH = 10;
const MAX_HOTSPOTS = 5;

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
            const graph = await engine.processCallGraph(paths);

            // Root nodes: functions that nothing else calls
            const calledIds = new Set(graph.edges.map(e => e.to));
            const roots = graph.nodes.filter(n => !calledIds.has(n.id));

            // Generate chains grouped by root
            const chainsByRoot: Record<string, string[]> = {};

            for (const root of roots) {
                const rawPaths = resolvePaths(root.id, graph, 0, new Set());
                const chains = rawPaths.map(p => p.join(' -> '));

                // Longest chains first — they show the deepest logic
                chains.sort((a, b) => b.split(' -> ').length - a.split(' -> ').length);

                chainsByRoot[root.id] = chains.slice(0, MAX_PATHS_PER_ENTRYPOINT);
            }

            // Hotspots: functions appearing in the most chains across all roots
            const chainCounts = new Map<string, number>();
            for (const chains of Object.values(chainsByRoot)) {
                const seen = new Set<string>();
                for (const chain of chains) {
                    for (const step of chain.split(' -> ')) {
                        // Strip suffixes like " (Recursive)" or " (Max Depth)"
                        const id = step.replace(/ \(.*\)$/, '');
                        if (!seen.has(id)) {
                            seen.add(id);
                            chainCounts.set(id, (chainCounts.get(id) ?? 0) + 1);
                        }
                    }
                }
            }

            // Exclude root nodes themselves from hotspots — they appear by definition
            const rootIds = new Set(roots.map(r => r.id));
            const hotspots = [...chainCounts.entries()]
                .filter(([id]) => !rootIds.has(id))
                .sort((a, b) => b[1] - a[1])
                .slice(0, MAX_HOTSPOTS)
                .map(([id, count]) => `${id}: ${count} chain${count === 1 ? '' : 's'}`);

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

/**
 * Recursive DFS to find all unique paths from a start node up to MAX_DEPTH.
 * Handles cycle detection by checking the current recursion stack.
 */
function resolvePaths(
    currentId: string,
    graph: CallGraph,
    depth: number,
    stack: Set<string>
): string[][] {
    // Stop: Recursion detected
    if (stack.has(currentId)) {
        return [[`${currentId} (Recursive)`]];
    }

    // Stop: Depth limit
    if (depth >= MAX_DEPTH) {
        return [[`${currentId} (Max Depth)`]];
    }

    const outgoingEdges = graph.edges.filter(e => e.from === currentId);

    // Base Case: Leaf node
    if (outgoingEdges.length === 0) {
        return [[currentId]];
    }

    const currentStack = new Set(stack);
    currentStack.add(currentId);

    const paths: string[][] = [];

    outgoingEdges.sort((a, b) => a.to.localeCompare(b.to));

    for (const edge of outgoingEdges) {
        const tailPaths = resolvePaths(edge.to, graph, depth + 1, currentStack);
        for (const tail of tailPaths) {
            paths.push([currentId, ...tail]);
        }
    }

    return paths;
}
