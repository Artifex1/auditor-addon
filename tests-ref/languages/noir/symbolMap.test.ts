import { describe, it, expect } from 'vitest';
import { NoirAdapter } from '../../../src/languages/noirAdapter';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

describe('NoirAdapter Call Graph', () => {
    const adapter = new NoirAdapter();

    it('should generate a call graph for free functions', async () => {
        const code = `
            pub fn a() {
                b();
            }
            fn b() {}
        `;
        const files: FileContent[] = [{ path: '/test.nr', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);
        const totalCallees = functions.reduce((sum, e) => sum + getCallees(graph, e).length, 0);
        expect(totalCallees).toBe(1);

        const entryA = functions.find(e => e.label === 'a');
        const entryB = functions.find(e => e.label === 'b');
        expect(entryA).toBeDefined();
        expect(entryB).toBeDefined();

        expect(getCallees(graph, entryA!)[0].qualifiedName).toBe(entryB?.qualifiedName);
    });

    it('should detect pub visibility', async () => {
        const code = `
            pub fn public_fn() {}
            fn private_fn() {}
        `;
        const files: FileContent[] = [{ path: '/test.nr', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const publicFn = functions.find(e => e.label === 'public_fn');
        const privateFn = functions.find(e => e.label === 'private_fn');

        expect(publicFn?.visibility).toBe('public');
        expect(privateFn?.visibility).toBe('private');
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.nr',
            content: `
                pub fn main() {
                    helper();
                }
            `
        };
        const file2: FileContent = {
            path: '/utils.nr',
            content: `
                fn helper() {
                    internal();
                }
                fn internal() {}
            `
        };
        const graph = await adapter.generateGraph([file1, file2]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const main = functions.find(e => e.label === 'main');
        const helper = functions.find(e => e.label === 'helper');

        expect(main?.locator?.file).toBe('/main.nr');
        expect(helper?.locator?.file).toBe('/utils.nr');

        const callees = getCallees(graph, main!);
        const callee = callees.find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee).toBeDefined();
    });
});
