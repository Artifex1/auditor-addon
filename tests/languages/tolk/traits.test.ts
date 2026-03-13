import { describe, it, expect } from 'vitest';
import { TolkAdapter } from '../../../src/languages/tolkAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

describe('TolkAdapter Traits', () => {
    const adapter = new TolkAdapter();

    async function parseNodes(code: string, query: string) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Tolk);
        const parser = await service.createParser(SupportedLanguage.Tolk);
        const tree = parser.parse(code);
        const q = new Query(lang, query);
        return q.captures(tree!.rootNode).map(c => c.node);
    }

    describe('isFunctionDef', () => {
        it('detects function declarations', async () => {
            const nodes = await parseNodes(
                'fun foo(): int { return 0; }',
                '(function_declaration) @f'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });
    });

    describe('isPublicFn', () => {
        it('all Tolk functions are public', async () => {
            const nodes = await parseNodes(
                'fun foo(): int { return 0; }',
                '(function_declaration) @f'
            );
            expect(adapter.isPublicFn(nodes[0])).toBe(true);
        });
    });

    describe('resolveCallee via generateSymbolMap', () => {
        it('resolves calls between functions', async () => {
            const code = `
fun caller(): int {
    return callee();
}
fun callee(): int {
    return 42;
}
`;
            const files: FileContent[] = [{ path: '/test.tolk', content: code }];
            const symbolMap = await adapter.generateSymbolMap(files);

            const callerEntry = Array.from(symbolMap.values()).find(e => e.label === 'caller');
            expect(callerEntry).toBeDefined();
            expect(callerEntry!.callees.length).toBeGreaterThan(0);
        });
    });
});
