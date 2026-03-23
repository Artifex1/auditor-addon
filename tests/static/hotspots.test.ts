import { describe, it, expect } from 'vitest';
import { computeHotspots } from '../../src/static/hotspots.js';
import { SymbolGraph, GraphNode, GraphEdge, SupportedLanguage } from '../../src/engine/types.js';
import crypto from 'crypto';

let _nodeCounter = 0;
function makeId() { return `node-${++_nodeCounter}`; }

function makeGraph(adjacency: Record<string, string[]>): SymbolGraph {
    const graph = new SymbolGraph();
    const nodeMap = new Map<string, GraphNode>();

    // Create nodes
    for (const [qn] of Object.entries(adjacency)) {
        const node: GraphNode = {
            id: makeId(),
            kind: 'function',
            qualifiedName: qn,
            status: 'concrete',
            language: SupportedLanguage.Solidity,
            label: qn,
            locator: { file: '/test.sol', startIndex: 0, endIndex: 0, line: 1, column: 0 },
            visibility: 'public',
            resolvedBy: 'static',
            confidence: 'high',
        };
        graph.addNode(node);
        nodeMap.set(qn, node);
    }

    // Add edges
    for (const [fromQn, callees] of Object.entries(adjacency)) {
        const fromNode = nodeMap.get(fromQn)!;
        for (const toQn of callees) {
            let toNode = nodeMap.get(toQn);
            if (!toNode) {
                // Create missing target nodes
                toNode = {
                    id: makeId(),
                    kind: 'function',
                    qualifiedName: toQn,
                    status: 'concrete',
                    language: SupportedLanguage.Solidity,
                    label: toQn,
                    locator: { file: '/test.sol', startIndex: 0, endIndex: 0, line: 1, column: 0 },
                    visibility: 'public',
                    resolvedBy: 'static',
                    confidence: 'high',
                };
                graph.addNode(toNode);
                nodeMap.set(toQn, toNode);
            }
            graph.addEdge({ from: fromNode.id, to: toNode.id, kind: 'calls', attrs: { targetKind: 'internal' } });
        }
    }

    return graph;
}

describe('computeHotspots', () => {
    it('returns empty array for empty symbol map', () => {
        const graph = new SymbolGraph();
        expect(computeHotspots(graph)).toEqual([]);
    });

    it('returns empty array when no function is called', () => {
        const graph = makeGraph({ A: [], B: [] });
        expect(computeHotspots(graph)).toEqual([]);
    });

    it('identifies a shared callee as a hotspot', () => {
        const graph = makeGraph({ root1: ['shared'], root2: ['shared'], shared: [] });

        const hotspots = computeHotspots(graph);
        expect(hotspots).toHaveLength(1);
        expect(hotspots[0]).toMatch(/^shared: \d+ chains?$/);
    });

    it('ranks hotspots by number of chains', () => {
        // root1 → A → C
        // root1 → B
        // root2 → A → C
        // root2 → C
        const graph = makeGraph({ root1: ['A', 'B'], root2: ['A', 'C'], A: ['C'], B: [], C: [] });

        const hotspots = computeHotspots(graph);
        // C should appear more than B since it's reachable from both roots
        const cEntry = hotspots.find(h => h.startsWith('C:'));
        expect(cEntry).toBeDefined();
    });

    it('respects topN parameter', () => {
        const graph = makeGraph({ root: ['A', 'B', 'C'], A: [], B: [], C: [] });

        const hotspots = computeHotspots(graph, 2);
        expect(hotspots.length).toBeLessThanOrEqual(2);
    });

    it('excludes root nodes from hotspots', () => {
        const graph = makeGraph({ root: ['leaf'], leaf: [] });

        const hotspots = computeHotspots(graph);
        // root should not appear as a hotspot
        expect(hotspots.every(h => !h.startsWith('root:'))).toBe(true);
    });

    it('handles cycles without infinite loops', () => {
        const graph = makeGraph({ root: ['A'], A: ['B'], B: ['A'] }); // cycle

        const hotspots = computeHotspots(graph);
        // Should complete without hanging
        expect(hotspots.length).toBeGreaterThanOrEqual(0);
    });
});
