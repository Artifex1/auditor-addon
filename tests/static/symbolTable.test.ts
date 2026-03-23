import { describe, it, expect } from 'vitest';
import { detectGaps, SymbolGap } from '../../src/static/symbol-table.js';
import { SymbolGraph, GraphNode, SupportedLanguage, CallTargetKind } from '../../src/engine/types.js';

let _counter = 0;
function makeId() { return `n${++_counter}`; }

function makeConcreteNode(qn: string, opts?: { isPublic?: boolean; file?: string; line?: number }): GraphNode {
    return {
        id: makeId(),
        kind: 'function',
        qualifiedName: qn,
        status: 'concrete',
        language: SupportedLanguage.Solidity,
        label: qn.split('.').pop() ?? qn,
        locator: {
            file: opts?.file ?? '/a.sol',
            startIndex: 0,
            endIndex: 0,
            line: opts?.line ?? 1,
            column: 0,
        },
        visibility: opts?.isPublic ? 'public' : 'private',
        resolvedBy: 'static',
        confidence: 'high',
    };
}

function makeGapNode(qn: string): GraphNode {
    return {
        id: makeId(),
        kind: 'function',
        qualifiedName: qn,
        status: 'gap',
        language: SupportedLanguage.Solidity,
        label: qn.split('.').pop() ?? qn,
        visibility: 'external',
        resolvedBy: 'static',
        confidence: 'low',
    };
}

/** Build a graph with a caller → callee edge. If calleeNode is null, no callee node is added. */
function buildGraph(
    callerNode: GraphNode,
    calleeQn: string,
    targetKind: CallTargetKind,
    calleeStatus: 'concrete' | 'gap' | 'external' | null = 'gap',
): SymbolGraph {
    const graph = new SymbolGraph();
    graph.addNode(callerNode);

    let calleeNode: GraphNode | null = null;
    if (calleeStatus !== null) {
        calleeNode = {
            id: makeId(),
            kind: 'function',
            qualifiedName: calleeQn,
            status: calleeStatus,
            language: SupportedLanguage.Solidity,
            label: calleeQn,
            visibility: 'external',
            resolvedBy: 'static',
            confidence: 'low',
        };
        graph.addNode(calleeNode);
    }

    graph.addEdge({
        from: callerNode.id,
        to: calleeNode?.id ?? makeId(), // dangling edge if no callee
        kind: 'calls',
        attrs: { targetKind },
    });

    return graph;
}

describe('detectGaps', () => {
    it('returns no gaps when all callees are internal and resolved', () => {
        const graph = new SymbolGraph();
        const callerNode = makeConcreteNode('A', { file: '/a.sol' });
        const calleeNode = makeConcreteNode('B', { file: '/a.sol' });
        graph.addNode(callerNode);
        graph.addNode(calleeNode);
        graph.addEdge({ from: callerNode.id, to: calleeNode.id, kind: 'calls', attrs: { targetKind: 'internal' } });

        const gaps = detectGaps(graph);
        expect(gaps).toHaveLength(0);
    });

    it('creates a gap for external_unknown callee', () => {
        const callerNode = makeConcreteNode('A', { file: '/a.sol' });
        const graph = buildGraph(callerNode, 'ext.foo', 'external_unknown', 'gap');

        const gaps = detectGaps(graph);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].type).toBe('unresolved_callee');
        expect(gaps[0].qualifiedName).toBe('ext.foo');
    });

    it('creates a gap for interface_dispatch callee', () => {
        const callerNode = makeConcreteNode('A', { file: '/a.sol' });
        const graph = buildGraph(callerNode, 'IFoo.bar', 'interface_dispatch', 'gap');

        const gaps = detectGaps(graph);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].type).toBe('interface_impl');
    });

    it('creates a gap when callee does not exist in map', () => {
        const callerNode = makeConcreteNode('A', { file: '/a.sol' });
        const graph = buildGraph(callerNode, 'missing', 'internal', 'gap');

        const gaps = detectGaps(graph);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].type).toBe('external_library');
        expect(gaps[0].qualifiedName).toBe('missing');
    });

    it('assigns high priority when caller is in hotspot set', () => {
        const callerNode = makeConcreteNode('A', { file: '/a.sol' });
        const graph = buildGraph(callerNode, 'ext', 'external_unknown', 'gap');

        const gaps = detectGaps(graph, ['A: 5 chains']);
        expect(gaps[0].priority).toBe('high');
    });

    it('assigns medium priority for public caller not in hotspots', () => {
        const callerNode = makeConcreteNode('A', { file: '/a.sol', isPublic: true });
        const graph = buildGraph(callerNode, 'ext', 'external_unknown', 'gap');

        const gaps = detectGaps(graph, []);
        expect(gaps[0].priority).toBe('medium');
    });

    it('assigns low priority for private caller not in hotspots', () => {
        const callerNode = makeConcreteNode('A', { file: '/a.sol' });
        const graph = buildGraph(callerNode, 'ext', 'external_unknown', 'gap');

        const gaps = detectGaps(graph, []);
        expect(gaps[0].priority).toBe('low');
    });

    it('generates stable deterministic gap IDs', () => {
        const callerNode = makeConcreteNode('A', { file: '/a.sol', line: 10 });
        const graph1 = buildGraph(callerNode, 'ext', 'external_unknown', 'gap');
        const graph2 = buildGraph(callerNode, 'ext', 'external_unknown', 'gap');

        const gaps1 = detectGaps(graph1);
        const gaps2 = detectGaps(graph2);
        expect(gaps1[0].id).toBe(gaps2[0].id);
        expect(gaps1[0].id).toMatch(/^[0-9a-f]{12}$/);
    });

    it('includes caller file in relevantFiles', () => {
        const callerNode = makeConcreteNode('A', { file: '/a.sol' });
        const graph = buildGraph(callerNode, 'ext', 'external_unknown', 'gap');

        const gaps = detectGaps(graph);
        expect(gaps[0].relevantFiles).toContain('/a.sol');
        expect(gaps[0].callSite.file).toBe('/a.sol');
    });

    it('extracts code snippet when sourceFiles provided', () => {
        const callerNode = makeConcreteNode('A', { file: '/a.sol', line: 3 });
        const graph = buildGraph(callerNode, 'ext', 'external_unknown', 'gap');

        const sourceFiles = new Map([
            ['/a.sol', 'line1\nline2\nline3\nline4\nline5'],
        ]);

        const gaps = detectGaps(graph, [], sourceFiles);
        expect(gaps[0].codeSnippet).toContain('line1');
        expect(gaps[0].codeSnippet).toContain('line3');
    });

    it('returns empty snippet when no sourceFiles', () => {
        const callerNode = makeConcreteNode('A', { file: '/a.sol' });
        const graph = buildGraph(callerNode, 'ext', 'external_unknown', 'gap');

        const gaps = detectGaps(graph);
        expect(gaps[0].codeSnippet).toBe('');
    });

    it('detects multiple gaps from one caller', () => {
        const graph = new SymbolGraph();
        const callerNode = makeConcreteNode('A', { file: '/a.sol' });
        graph.addNode(callerNode);

        const gap1 = makeGapNode('ext1');
        const gap2 = makeGapNode('ext2');
        graph.addNode(gap1);
        graph.addNode(gap2);

        graph.addEdge({ from: callerNode.id, to: gap1.id, kind: 'calls', attrs: { targetKind: 'external_unknown' } });
        graph.addEdge({ from: callerNode.id, to: gap2.id, kind: 'calls', attrs: { targetKind: 'interface_dispatch' } });

        const gaps = detectGaps(graph);
        expect(gaps).toHaveLength(2);
        expect(gaps.map(g => g.qualifiedName)).toEqual(['ext1', 'ext2']);
    });
});
