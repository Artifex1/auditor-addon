import { describe, it, expect } from 'vitest';
import { TolkAdapter } from '../../../src/languages/tolkAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('TolkAdapter Call Graph', () => {
    const adapter = new TolkAdapter();

    it('should generate a simple call graph for free functions', async () => {
        const code = `
fun a() {
    b();
}

fun b() {}
`;
        const files: FileContent[] = [{ path: '/test.tolk', content: code }];
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);
        expect(graph.edges).toHaveLength(1);

        const nodeA = graph.nodes.find(n => n.label === 'a');
        const nodeB = graph.nodes.find(n => n.label === 'b');
        expect(nodeA).toBeDefined();
        expect(nodeB).toBeDefined();

        expect(graph.edges[0].from).toBe(nodeA!.id);
        expect(graph.edges[0].to).toBe(nodeB!.id);
    });

    it('should mark all functions as public', async () => {
        const code = `
fun helper(): int { return 1; }
fun main() { helper(); }
`;
        const files: FileContent[] = [{ path: '/test.tolk', content: code }];
        const graph = await adapter.generateCallGraph(files);

        for (const node of graph.nodes) {
            expect(node.visibility).toBe('public');
        }
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.tolk',
            content: `
fun main() {
    util();
}
`
        };
        const file2: FileContent = {
            path: '/util.tolk',
            content: `
fun util() {
    inner();
}

fun inner() {}
`
        };
        const graph = await adapter.generateCallGraph([file1, file2]);

        expect(graph.nodes).toHaveLength(3);

        const main = graph.nodes.find(n => n.label === 'main');
        const util = graph.nodes.find(n => n.label === 'util');
        const inner = graph.nodes.find(n => n.label === 'inner');

        expect(main?.file).toBe('/main.tolk');
        expect(util?.file).toBe('/util.tolk');
        expect(inner?.file).toBe('/util.tolk');

        const edge1 = graph.edges.find(e => e.from === main?.id);
        expect(edge1?.to).toBe(util?.id);

        const edge2 = graph.edges.find(e => e.from === util?.id);
        expect(edge2?.to).toBe(inner?.id);
    });

    it('should detect direct calls within a chain', async () => {
        const code = `
fun a() { b(); }
fun b() { c(); }
fun c() {}
`;
        const files: FileContent[] = [{ path: '/test.tolk', content: code }];
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(3);
        expect(graph.edges).toHaveLength(2);

        const a = graph.nodes.find(n => n.label === 'a')!;
        const b = graph.nodes.find(n => n.label === 'b')!;
        const c = graph.nodes.find(n => n.label === 'c')!;

        expect(graph.edges.find(e => e.from === a.id && e.to === b.id)).toBeDefined();
        expect(graph.edges.find(e => e.from === b.id && e.to === c.id)).toBeDefined();
    });
});
