import { describe, it, expect } from 'vitest';
import { NoirAdapter } from '../../../src/languages/noirAdapter';
import { FileContent } from '../../../src/engine/types';

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

    it('should detect pub visibility', async () => {
        const code = `
            pub fn public_fn() {}
            fn private_fn() {}
        `;
        const files: FileContent[] = [{ path: '/test.nr', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const publicFn = graph.nodes.find(n => n.label === 'public_fn');
        const privateFn = graph.nodes.find(n => n.label === 'private_fn');

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
        const graph = await adapter.generateCallGraph([file1, file2]);

        expect(graph.nodes).toHaveLength(3);

        const main = graph.nodes.find(n => n.label === 'main');
        const helper = graph.nodes.find(n => n.label === 'helper');

        expect(main?.file).toBe('/main.nr');
        expect(helper?.file).toBe('/utils.nr');

        const edge = graph.edges.find(e => e.from === main?.id);
        expect(edge?.to).toBe(helper?.id);
    });
});
