import { describe, it, expect } from 'vitest';
import { MoveAdapter } from '../../../src/languages/moveAdapter';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const increment = functions.find(e => e.label === 'increment');
        const validate = functions.find(e => e.label === 'validate');

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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const transfer = functions.find(e => e.label === 'transfer_coins');
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const add = functions.find(e => e.label === 'add');
        const check = functions.find(e => e.label === 'check_overflow');

        expect(add).toBeDefined();
        expect(check).toBeDefined();

        const callees = getCallees(graph, add!);
        const callee = callees.find(c => c.qualifiedName === check?.qualifiedName);
        expect(callee).toBeDefined();
    });
});
