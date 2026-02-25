import { describe, it, expect } from 'vitest';
import { MasmAdapter } from '../../../src/languages/masmAdapter';
import { FileContent } from '../../../src/engine/types';

describe('MasmAdapter Call Graph', () => {
    const adapter = new MasmAdapter();

    it('should generate a call graph for procedures', async () => {
        const code = `proc.foo
    exec.bar
end
proc.bar
end`;
        const files: FileContent[] = [{ path: '/test.masm', content: code }];
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);

        const foo = graph.nodes.find(n => n.label === 'foo');
        const bar = graph.nodes.find(n => n.label === 'bar');
        expect(foo).toBeDefined();
        expect(bar).toBeDefined();

        expect(graph.edges).toHaveLength(1);
        expect(graph.edges[0].from).toBe(foo?.id);
        expect(graph.edges[0].to).toBe(bar?.id);
    });

    it('should treat entrypoint as external visibility', async () => {
        const code = `proc.foo
end
begin
    exec.foo
end`;
        const files: FileContent[] = [{ path: '/test.masm', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const entry = graph.nodes.find(n => n.label === 'begin');
        expect(entry?.visibility).toBe('external');
    });

    it('should detect calls from entrypoint', async () => {
        const code = `proc.foo
end
begin
    exec.foo
end`;
        const files: FileContent[] = [{ path: '/test.masm', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const entry = graph.nodes.find(n => n.label === 'begin');
        const foo = graph.nodes.find(n => n.label === 'foo');

        const edge = graph.edges.find(e => e.from === entry?.id);
        expect(edge?.to).toBe(foo?.id);
    });
});
