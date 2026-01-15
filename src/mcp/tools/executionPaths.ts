import { z } from "zod";
import { encode } from "@toon-format/toon";
import { Engine } from "../../engine/index.js";
import { CallGraph } from "../../engine/types.js";

// ==========================================
// Configuration
// ==========================================
const MAX_PATHS_PER_ENTRYPOINT = 5;
const MAX_DEPTH = 10;

// ==========================================
// Schema
// ==========================================
export const executionPathsSchema = {
    description: "Generate linear execution paths (call chains) from public entrypoints. Useful for understanding control flow and identifying high-risk paths.",
    inputSchema: {
        paths: z.array(z.string()).describe("File paths or glob patterns to analyze")
    }
};

// ==========================================
// Implementation
// ==========================================
export function createExecutionPathsHandler(engine: Engine) {
    return async ({ paths }: { paths: string[] }) => {
        try {
            const graph = await engine.processCallGraph(paths);

            // 1. Identify Entrypoints
            const entrypoints = graph.nodes.filter(n =>
                n.visibility === 'public' || n.visibility === 'external'
            );

            // 2. Generate Paths
            const allPaths: string[] = [];

            for (const entrypoint of entrypoints) {
                const rawPaths = resolvePaths(entrypoint.id, graph, 0, new Set());

                // convert string[][] to string[]
                const stringPaths = rawPaths.map(p => p.join(' -> '));

                // 3. Select Best Paths representing this entrypoint
                // Heuristic: Longest paths often show the most interesting logic/depth
                stringPaths.sort((a, b) => {
                    const lenA = a.split(' -> ').length;
                    const lenB = b.split(' -> ').length;
                    return lenB - lenA;
                });

                allPaths.push(...stringPaths.slice(0, MAX_PATHS_PER_ENTRYPOINT));
            }

            return {
                content: [{
                    type: "text" as const,
                    text: encode({ execution_paths: allPaths })
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: "text" as const,
                    text: `Error generating execution paths: ${error instanceof Error ? error.message : String(error)}`
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

    // Check edges
    const outgoingEdges = graph.edges.filter(e => e.from === currentId);

    // Base Case: Leaf Node
    if (outgoingEdges.length === 0) {
        return [[currentId]];
    }

    // Recursive Step
    const currentStack = new Set(stack);
    currentStack.add(currentId);

    const paths: string[][] = [];

    // Sort edges to ensure deterministic output? Maybe by target ID.
    outgoingEdges.sort((a, b) => a.to.localeCompare(b.to));

    for (const edge of outgoingEdges) {
        const tailPaths = resolvePaths(edge.to, graph, depth + 1, currentStack);
        for (const tail of tailPaths) {
            paths.push([currentId, ...tail]);
        }
    }

    return paths;
}
