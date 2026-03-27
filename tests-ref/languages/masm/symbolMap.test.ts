import { describe, it, expect } from 'vitest';
import { MasmAdapter } from '../../../src/languages/masmAdapter';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

describe('MasmAdapter Call Graph', () => {
    const adapter = new MasmAdapter();

    it('should generate a call graph for procedures', async () => {
        const code = `proc.foo
    exec.bar
end
proc.bar
end`;
        const files: FileContent[] = [{ path: '/test.masm', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const foo = functions.find(e => e.label === 'foo');
        const bar = functions.find(e => e.label === 'bar');
        expect(foo).toBeDefined();
        expect(bar).toBeDefined();

        const totalCallees = functions.reduce((sum, e) => sum + getCallees(graph, e).length, 0);
        expect(totalCallees).toBe(1);
        expect(getCallees(graph, foo!)[0].qualifiedName).toBe(bar?.qualifiedName);
    });

    it('should treat entrypoint as external visibility', async () => {
        const code = `proc.foo
end
begin
    exec.foo
end`;
        const files: FileContent[] = [{ path: '/test.masm', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const entry = functions.find(e => e.label === 'begin');
        expect(entry?.visibility).toBe('external');
    });

    it('should detect calls from entrypoint', async () => {
        const code = `proc.foo
end
begin
    exec.foo
end`;
        const files: FileContent[] = [{ path: '/test.masm', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const entry = functions.find(e => e.label === 'begin');
        const foo = functions.find(e => e.label === 'foo');

        const callees = getCallees(graph, entry!);
        const callee = callees.find(c => c.qualifiedName === foo?.qualifiedName);
        expect(callee).toBeDefined();
    });
});
