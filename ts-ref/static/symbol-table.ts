import crypto from "crypto";
import {
    SymbolGraph, GraphNode, GraphEdge, CallEdgeAttrs,
    GapType, GapPriority
} from "../engine/types.js";

export interface SymbolGap {
    id: string;
    type: GapType;
    qualifiedName: string;
    callSite: { file: string; line: number; col: number };
    codeSnippet: string;
    relevantFiles: string[];
    priority: GapPriority;
}

function gapId(qualifiedName: string, file: string, line: number, col: number): string {
    const raw = `${qualifiedName}:${file}:${line}:${col}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

function gapTypeFromEdge(edge: GraphEdge): GapType {
    const attrs = edge.attrs as CallEdgeAttrs | undefined;
    const targetKind = attrs?.targetKind;
    if (targetKind === 'external_unknown') return 'unresolved_callee';
    if (targetKind === 'interface_dispatch') return 'interface_impl';
    return 'external_library';
}

/**
 * Detects gaps in a SymbolGraph — callees that cannot be fully resolved.
 * A gap is emitted when:
 *  - targetKind is 'external_unknown' or 'interface_dispatch'
 *  - The callee node has status === 'gap' or 'external'
 *
 * @param graph - The symbol graph to analyze
 * @param hotspots - Hotspot qualified names (used for priority assignment)
 * @param sourceFiles - Optional map of file path → content (for code snippets)
 */
export function detectGaps(
    graph: SymbolGraph,
    hotspots: string[] = [],
    sourceFiles?: Map<string, string>
): SymbolGap[] {
    const gaps: SymbolGap[] = [];
    const hotspotSet = new Set(hotspots.map(h => h.split(':')[0]));

    for (const callerNode of graph.nodes()) {
        if (callerNode.status !== 'concrete') continue;
        for (const edge of graph.getOutEdgesOfKind(callerNode.id, 'calls')) {
            const calleeNode = graph.getNode(edge.to);
            const isGap = !calleeNode || calleeNode.status === 'gap' || calleeNode.status === 'external';
            const attrs = edge.attrs as CallEdgeAttrs | undefined;
            const isUnresolvedKind = attrs?.targetKind === 'external_unknown'
                || attrs?.targetKind === 'interface_dispatch';

            if (!isGap && !isUnresolvedKind) continue;

            const relevantFiles = new Set<string>();
            if (callerNode.locator) relevantFiles.add(callerNode.locator.file);
            if (calleeNode?.locator) relevantFiles.add(calleeNode.locator.file);

            const priority = classifyGapPriority(callerNode, hotspotSet);
            const type = gapTypeFromEdge(edge);

            const calleeName = calleeNode?.qualifiedName ?? 'unknown';
            const file = callerNode.locator?.file ?? '';
            const edgeCallSite = attrs?.callSite;
            const line = edgeCallSite?.line ?? callerNode.locator?.line ?? 0;
            const col = callerNode.locator?.column ?? 0;

            const snippet = extractSnippet(callerNode, sourceFiles);

            gaps.push({
                id: gapId(calleeName, file, line, col),
                type,
                qualifiedName: calleeName,
                callSite: { file, line, col },
                codeSnippet: snippet,
                relevantFiles: [...relevantFiles],
                priority,
            });
        }
    }

    return gaps;
}

function classifyGapPriority(
    caller: GraphNode,
    hotspotSet: Set<string>
): GapPriority {
    if (hotspotSet.has(caller.qualifiedName)) return 'high';
    if (caller.visibility === 'public' || caller.visibility === 'external') return 'medium';
    return 'low';
}

function extractSnippet(
    caller: GraphNode,
    sourceFiles?: Map<string, string>
): string {
    if (!sourceFiles || !caller.locator) return '';
    const source = sourceFiles.get(caller.locator.file);
    if (!source) return '';
    const lines = source.split('\n');
    const line = caller.locator.line;
    const start = Math.max(0, line - 3);
    const end = Math.min(lines.length, line + 2);
    return lines.slice(start, end).join('\n');
}
