import { describe, it, expect } from 'vitest';
import { TolkAdapter } from '../../../src/languages/tolkAdapter.js';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types.js';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);
        const totalCallees = functions.reduce((sum, e) => sum + getCallees(graph, e).length, 0);
        expect(totalCallees).toBe(1);

        const entryA = functions.find(e => e.label === 'a');
        const entryB = functions.find(e => e.label === 'b');
        expect(entryA).toBeDefined();
        expect(entryB).toBeDefined();

        expect(getCallees(graph, entryA!)[0].qualifiedName).toBe(entryB!.qualifiedName);
    });

    it('should mark all functions as public', async () => {
        const code = `
fun helper(): int { return 1; }
fun main() { helper(); }
`;
        const files: FileContent[] = [{ path: '/test.tolk', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        for (const entry of functions) {
            expect(entry.visibility).toBe('public');
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
        const graph = await adapter.generateGraph([file1, file2]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const main = functions.find(e => e.label === 'main');
        const util = functions.find(e => e.label === 'util');
        const inner = functions.find(e => e.label === 'inner');

        expect(main?.locator?.file).toBe('/main.tolk');
        expect(util?.locator?.file).toBe('/util.tolk');
        expect(inner?.locator?.file).toBe('/util.tolk');

        const callee1 = getCallees(graph, main!).find(c => c.qualifiedName === util?.qualifiedName);
        expect(callee1).toBeDefined();

        const callee2 = getCallees(graph, util!).find(c => c.qualifiedName === inner?.qualifiedName);
        expect(callee2).toBeDefined();
    });

    it('should detect direct calls within a chain', async () => {
        const code = `
fun a() { b(); }
fun b() { c(); }
fun c() {}
`;
        const files: FileContent[] = [{ path: '/test.tolk', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);
        const totalCallees = functions.reduce((sum, e) => sum + getCallees(graph, e).length, 0);
        expect(totalCallees).toBe(2);

        const a = functions.find(e => e.label === 'a')!;
        const b = functions.find(e => e.label === 'b')!;
        const c = functions.find(e => e.label === 'c')!;

        expect(getCallees(graph, a).find(cl => cl.qualifiedName === b.qualifiedName)).toBeDefined();
        expect(getCallees(graph, b).find(cl => cl.qualifiedName === c.qualifiedName)).toBeDefined();
    });
});
