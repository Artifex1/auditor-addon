import { describe, it, expect } from 'vitest';
import { CairoAdapter } from '../../../src/languages/cairoAdapter';
import { FileContent } from '../../../src/engine/types';

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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);
        expect(graph.edges).toHaveLength(1);

        const nodeA = graph.nodes.find(n => n.label === 'a');
        const nodeB = graph.nodes.find(n => n.label === 'b');
        expect(nodeA).toBeDefined();
        expect(nodeB).toBeDefined();

        expect(graph.edges[0].from).toBe(nodeA?.id);
        expect(graph.edges[0].to).toBe(nodeB?.id);
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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);

        const increment = graph.nodes.find(n => n.label === 'increment');
        const validate = graph.nodes.find(n => n.label === 'validate');

        expect(increment).toBeDefined();
        expect(validate).toBeDefined();
        expect(increment?.contract).toBe('CounterImpl');
        expect(validate?.contract).toBe('CounterImpl');
    });

    it('should handle pub visibility', async () => {
        const code = `
            pub fn public_fn() {}
            fn private_fn() {}
        `;
        const files: FileContent[] = [{ path: '/test.cairo', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const publicFn = graph.nodes.find(n => n.label === 'public_fn');
        const privateFn = graph.nodes.find(n => n.label === 'private_fn');

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
        const graph = await adapter.generateCallGraph([file1, file2]);

        expect(graph.nodes).toHaveLength(3);

        const main = graph.nodes.find(n => n.label === 'main');
        const helper = graph.nodes.find(n => n.label === 'helper');

        expect(main?.file).toBe('/main.cairo');
        expect(helper?.file).toBe('/utils.cairo');

        const edge = graph.edges.find(e => e.from === main?.id);
        expect(edge?.to).toBe(helper?.id);
    });
});
