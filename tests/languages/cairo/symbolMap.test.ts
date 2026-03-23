import { describe, it, expect } from 'vitest';
import { CairoAdapter } from '../../../src/languages/cairoAdapter';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind, node: graph.getNode(e.to) }));
}

describe('CairoAdapter Call Graph', () => {
    const adapter = new CairoAdapter();

    it('should generate a simple call graph for free functions', async () => {
        const code = `
            fn a() {
                b();
            }
            fn b() {}
        `;
        const files: FileContent[] = [{ path: '/test.cairo', content: code }];
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

    it('should handle impl block methods', async () => {
        const code = `
            impl CounterImpl of ICounter {
                fn increment(ref self: Counter) {
                    self.validate();
                }

                fn validate(ref self: Counter) {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.cairo', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const increment = functions.find(e => e.label === 'increment');
        const validate = functions.find(e => e.label === 'validate');

        expect(increment).toBeDefined();
        expect(validate).toBeDefined();
        expect(increment?.qualifiedName).toContain('CounterImpl::');
        expect(validate?.qualifiedName).toContain('CounterImpl::');
    });

    it('should handle pub visibility', async () => {
        const code = `
            pub fn public_fn() {}
            fn private_fn() {}
        `;
        const files: FileContent[] = [{ path: '/test.cairo', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const publicFn = functions.find(e => e.label === 'public_fn');
        const privateFn = functions.find(e => e.label === 'private_fn');

        expect(publicFn?.visibility).toBe('public');
        expect(privateFn?.visibility).toBe('private');
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.cairo',
            content: `
                fn main() {
                    helper();
                }
            `
        };
        const file2: FileContent = {
            path: '/utils.cairo',
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

        expect(main?.locator?.file).toBe('/main.cairo');
        expect(helper?.locator?.file).toBe('/utils.cairo');

        const callees = getCallees(graph, main!);
        const callee = callees.find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee).toBeDefined();
    });
});
