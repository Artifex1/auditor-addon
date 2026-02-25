import { describe, it, expect } from 'vitest';
import { CompactAdapter } from '../../../src/languages/compactAdapter';
import { FileContent } from '../../../src/engine/types';

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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);
        expect(graph.edges).toHaveLength(1);

        const add = graph.nodes.find(n => n.label === 'add');
        const check = graph.nodes.find(n => n.label === 'check');
        expect(add).toBeDefined();
        expect(check).toBeDefined();

        expect(graph.edges[0].from).toBe(add?.id);
        expect(graph.edges[0].to).toBe(check?.id);
    });

    it('should detect export visibility', async () => {
        const code = `
export circuit public_fn(x: Uint<8>): Uint<8> { return x; }
circuit private_fn(x: Uint<8>): Uint<8> { return x; }`;
        const files: FileContent[] = [{ path: '/test.compact', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const publicFn = graph.nodes.find(n => n.label === 'public_fn');
        const privateFn = graph.nodes.find(n => n.label === 'private_fn');

        expect(publicFn?.visibility).toBe('public');
        expect(privateFn?.visibility).toBe('private');
    });
});
