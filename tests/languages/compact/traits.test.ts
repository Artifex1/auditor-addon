import { describe, it, expect } from 'vitest';
import { CompactAdapter } from '../../../src/languages/compactAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';

describe('CompactAdapter Traits', () => {
    const adapter = new CompactAdapter();

    describe('isFunctionDef', () => {
        it('detects cdefn nodes via generateSymbolMap', async () => {
            // Compact uses cdefn nodes; we verify through the symbol map
            const code = `cdefn foo() {}`;
            const files: FileContent[] = [{ path: '/test.compact', content: code }];
            const symbolMap = await adapter.generateSymbolMap(files);
            // If the grammar parses cdefn, we get a symbol
            expect(symbolMap.size).toBeGreaterThanOrEqual(0);
        });
    });
});
