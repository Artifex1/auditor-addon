import { describe, it, expect } from 'vitest';
import { MoveAdapter } from '../../../src/languages/moveAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';

describe('MoveAdapter Traits', () => {
    const adapter = new MoveAdapter();

    describe('resolveCallee via generateSymbolMap', () => {
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
            const symbolMap = await adapter.generateSymbolMap(files);

            const callerEntry = Array.from(symbolMap.values()).find(e => e.label === 'caller');
            expect(callerEntry).toBeDefined();
            if (callerEntry && callerEntry.callees.length > 0) {
                expect(callerEntry.callees[0].qualifiedName).toContain('callee');
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
            const symbolMap = await adapter.generateSymbolMap(files);

            const exported = Array.from(symbolMap.values()).find(e => e.label === 'exported');
            const internal = Array.from(symbolMap.values()).find(e => e.label === 'internal');
            expect(exported?.isPublic).toBe(true);
            expect(internal?.isPublic).toBe(false);
        });
    });
});
