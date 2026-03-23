import { describe, it, expect } from 'vitest';
import { CompactAdapter } from '../../../src/languages/compactAdapter';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

describe('CompactAdapter Call Graph', () => {
    const adapter = new CompactAdapter();

    it('should generate a call graph for circuits', async () => {
        const code = `
export circuit add(x: Uint<8>, y: Uint<8>): Uint<8> {
    return check(x, y);
}
circuit check(x: Uint<8>, y: Uint<8>): Uint<8> {
    return x;
}`;
        const files: FileContent[] = [{ path: '/test.compact', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);
        const totalCallees = functions.reduce((sum, e) => sum + getCallees(graph, e).length, 0);
        expect(totalCallees).toBe(1);

        const add = functions.find(e => e.label === 'add');
        const check = functions.find(e => e.label === 'check');
        expect(add).toBeDefined();
        expect(check).toBeDefined();

        expect(getCallees(graph, add!)[0].qualifiedName).toBe(check?.qualifiedName);
    });

    it('should detect export visibility', async () => {
        const code = `
export circuit public_fn(x: Uint<8>): Uint<8> { return x; }
circuit private_fn(x: Uint<8>): Uint<8> { return x; }`;
        const files: FileContent[] = [{ path: '/test.compact', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const publicFn = functions.find(e => e.label === 'public_fn');
        const privateFn = functions.find(e => e.label === 'private_fn');

        expect(publicFn?.visibility).toBe('public');
        expect(privateFn?.visibility).toBe('private');
    });
});
