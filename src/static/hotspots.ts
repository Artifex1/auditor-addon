import { SymbolMap } from "../engine/types.js";

const DEFAULT_TOP_N = 5;

/**
 * Builds a reverse caller index: for each function, the set of callers.
 * Returns Map<qualifiedName, Set<callerQualifiedName>>.
 */
export function buildCallerIndex(symbolMap: SymbolMap): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>();
    for (const [callerId, entry] of symbolMap) {
        for (const callee of entry.callees) {
            let callers = index.get(callee.qualifiedName);
            if (!callers) {
                callers = new Set();
                index.set(callee.qualifiedName, callers);
            }
            callers.add(callerId);
        }
    }
    return index;
}

/**
 * Computes hotspot functions — those appearing across the most call chains.
 * A hotspot is a non-root function that is a callee in many different chains,
 * making it a high-impact target for review.
 *
 * @param symbolMap - The symbol map to analyze
 * @param topN - Number of hotspots to return (default 5)
 * @returns Array of formatted hotspot strings: "qualifiedName: N chains"
 */
export function computeHotspots(symbolMap: SymbolMap, topN: number = DEFAULT_TOP_N): string[] {
    // Count how many distinct callers reference each callee
    const callerCounts = new Map<string, Set<string>>();

    for (const [callerId, entry] of symbolMap) {
        for (const callee of entry.callees) {
            if (!callerCounts.has(callee.qualifiedName)) {
                callerCounts.set(callee.qualifiedName, new Set());
            }
            callerCounts.get(callee.qualifiedName)!.add(callerId);
        }
    }

    // Root nodes: IDs that never appear as a callee
    const allCalleeIds = new Set<string>();
    for (const entry of symbolMap.values()) {
        for (const callee of entry.callees) {
            allCalleeIds.add(callee.qualifiedName);
        }
    }
    const rootIds = new Set<string>();
    for (const id of symbolMap.keys()) {
        if (!allCalleeIds.has(id)) {
            rootIds.add(id);
        }
    }

    // Now do full chain-based counting (matching the original callChains algorithm)
    // For each root, DFS to find all chains, then count unique function appearances per root
    const chainCounts = new Map<string, number>();

    for (const rootId of rootIds) {
        const chains = resolvePaths(rootId, symbolMap, 0, new Set(), 10);
        const seen = new Set<string>();
        for (const chain of chains) {
            for (const step of chain) {
                if (!seen.has(step) && !rootIds.has(step)) {
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
    currentId: string,
    symbolMap: SymbolMap,
    depth: number,
    stack: Set<string>,
    maxDepth: number,
    labels = false
): string[][] {
    if (stack.has(currentId)) return [[labels ? `${currentId} (Recursive)` : currentId]];
    if (depth >= maxDepth) return [[labels ? `${currentId} (Max Depth)` : currentId]];

    const entry = symbolMap.get(currentId);
    const callees = entry?.callees ?? [];
    if (callees.length === 0) return [[currentId]];

    const currentStack = new Set(stack);
    currentStack.add(currentId);

    const paths: string[][] = [];
    const sortedCallees = [...callees].sort((a, b) =>
        a.qualifiedName.localeCompare(b.qualifiedName)
    );

    for (const callee of sortedCallees) {
        const tailPaths = resolvePaths(callee.qualifiedName, symbolMap, depth + 1, currentStack, maxDepth, labels);
        for (const tail of tailPaths) {
            paths.push([currentId, ...tail]);
        }
    }

    return paths;
}
