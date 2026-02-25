import { describe, it, expect } from 'vitest';
import { MoveAdapter } from '../../../src/languages/moveAdapter';
import { FileContent } from '../../../src/engine/types';

describe('MoveAdapter Call Graph', () => {
    const adapter = new MoveAdapter();

    it('should generate a simple call graph for module functions', async () => {
        const code = `
            module 0x1::counter {
                public fun increment() {
                    validate();
                }

                fun validate() {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.move', content: code }];
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);

        const increment = graph.nodes.find(n => n.label === 'increment');
        const validate = graph.nodes.find(n => n.label === 'validate');

        expect(increment).toBeDefined();
        expect(validate).toBeDefined();
        expect(increment?.visibility).toBe('public');
        expect(validate?.visibility).toBe('private');
    });

    it('should handle entry functions as external visibility', async () => {
        const code = `
            module 0x1::transfer {
                public entry fun transfer_coins() {
                    process();
                }

                fun process() {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.move', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const transfer = graph.nodes.find(n => n.label === 'transfer_coins');
        expect(transfer?.visibility).toBe('external');
    });

    it('should detect calls within module', async () => {
        const code = `
            module 0x1::math {
                public fun add(a: u64, b: u64): u64 {
                    check_overflow(a, b);
                    a + b
                }

                fun check_overflow(a: u64, b: u64) {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.move', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const add = graph.nodes.find(n => n.label === 'add');
        const check = graph.nodes.find(n => n.label === 'check_overflow');

        expect(add).toBeDefined();
        expect(check).toBeDefined();

        const edge = graph.edges.find(e => e.from === add?.id);
        expect(edge?.to).toBe(check?.id);
    });
});
