import { SymbolGraph } from "../engine/types.js";

const DEFAULT_TOP_N = 5;

/**
 * Computes hotspot functions — those appearing across the most call chains.
 * A hotspot is a non-root function that is a callee in many different chains,
 * making it a high-impact target for review.
 *
 * @param graph - The symbol graph to analyze
 * @param topN - Number of hotspots to return (default 5)
 * @returns Array of formatted hotspot strings: "qualifiedName: N chains"
 */
export function computeHotspots(
    graph: SymbolGraph,
    topN: number = DEFAULT_TOP_N,
    calleesByCallerId?: Map<string, string[]>,
): string[] {
    if (!calleesByCallerId) calleesByCallerId = buildCalleeIndex(graph);

    const allCalleeIds = new Set<string>();
    for (const list of calleesByCallerId.values()) {
        for (const qn of list) allCalleeIds.add(qn);
    }

    // Root nodes: concrete nodes that never appear as a callee
    const rootQns = new Set<string>();
    for (const node of graph.nodes()) {
        if (node.status !== 'concrete') continue;
        if (!allCalleeIds.has(node.qualifiedName)) {
            rootQns.add(node.qualifiedName);
        }
    }

    // Chain-based counting: for each root, DFS to find all chains
    const chainCounts = new Map<string, number>();

    for (const rootQn of rootQns) {
        const chains = resolvePaths(rootQn, calleesByCallerId, 0, new Set(), 10);
        const seen = new Set<string>();
        for (const chain of chains) {
            for (const step of chain) {
                if (!seen.has(step) && !rootQns.has(step)) {
                    seen.add(step);
                    chainCounts.set(step, (chainCounts.get(step) ?? 0) + 1);
                }
            }
        }
    }

    return [...chainCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([id, count]) => `${id}: ${count} chain${count === 1 ? '' : 's'}`);
}

export function resolvePaths(
    currentQn: string,
    calleesByCallerId: Map<string, string[]>,
    depth: number,
    stack: Set<string>,
    maxDepth: number,
    labels = false
): string[][] {
    if (stack.has(currentQn)) return [[labels ? `${currentQn} (Recursive)` : currentQn]];
    if (depth >= maxDepth) return [[labels ? `${currentQn} (Max Depth)` : currentQn]];

    const callees = calleesByCallerId.get(currentQn) ?? [];
    if (callees.length === 0) return [[currentQn]];

    const currentStack = new Set(stack);
    currentStack.add(currentQn);

    const paths: string[][] = [];
    const sortedCallees = [...callees].sort((a, b) => a.localeCompare(b));

    for (const calleeQn of sortedCallees) {
        const tailPaths = resolvePaths(calleeQn, calleesByCallerId, depth + 1, currentStack, maxDepth, labels);
        for (const tail of tailPaths) {
            paths.push([currentQn, ...tail]);
        }
    }

    return paths;
}

/**
 * Builds a calleesByCallerId map from the graph.
 * Used by callChains tool to resolve execution paths.
 */
export function buildCalleeIndex(graph: SymbolGraph): Map<string, string[]> {
    const calleesByCallerId = new Map<string, string[]>();
    for (const node of graph.nodes()) {
        if (node.status !== 'concrete') continue;
        const callEdges = graph.getOutEdgesOfKind(node.id, 'calls');
        if (callEdges.length === 0) continue;
        const callees: string[] = [];
        for (const edge of callEdges) {
            const calleeNode = graph.getNode(edge.to);
            if (calleeNode?.status === 'concrete') {
                callees.push(calleeNode.qualifiedName);
            }
        }
        if (callees.length > 0) {
            calleesByCallerId.set(node.qualifiedName, callees);
        }
    }
    return calleesByCallerId;
}
