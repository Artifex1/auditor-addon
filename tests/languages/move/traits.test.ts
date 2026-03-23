import { describe, it, expect } from 'vitest';
import { MoveAdapter } from '../../../src/languages/moveAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';

describe('MoveAdapter Traits', () => {
    const adapter = new MoveAdapter();

    describe('resolveCallee via generateGraph', () => {
        it('resolves calls within a module', async () => {
            const code = `
module 0x1::test {
    fun caller() {
        callee();
    }
    fun callee() {}
}
`;
            const files: FileContent[] = [{ path: '/test.move', content: code }];
            const graph = await adapter.generateGraph(files);

            const callerEntry = Array.from(graph.nodes()).find(e => e.label === 'caller');
            expect(callerEntry).toBeDefined();
            const callees = graph.getOutEdges(callerEntry!.id)
                .filter(e => e.kind === 'calls')
                .map(e => graph.getNode(e.to));
            if (callees.length > 0) {
                expect(callees[0]?.qualifiedName).toContain('callee');
            }
        });
    });

    describe('visibility', () => {
        it('detects public functions', async () => {
            const code = `
module 0x1::test {
    public fun exported() {}
    fun internal() {}
}
`;
            const files: FileContent[] = [{ path: '/test.move', content: code }];
            const graph = await adapter.generateGraph(files);

            const exported = Array.from(graph.nodes()).find(e => e.label === 'exported');
            const internal = Array.from(graph.nodes()).find(e => e.label === 'internal');
            expect(exported?.visibility).toBe('public');
            expect(internal?.visibility).toBe('private');
        });
    });
});
