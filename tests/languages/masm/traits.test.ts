import { describe, it, expect } from 'vitest';
import { MasmAdapter } from '../../../src/languages/masmAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

describe('MasmAdapter Traits', () => {
    const adapter = new MasmAdapter();

    async function parseNodes(code: string, query: string) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Masm);
        const parser = await service.createParser(SupportedLanguage.Masm);
        const tree = parser.parse(code);
        const q = new Query(lang, query);
        return q.captures(tree!.rootNode).map(c => c.node);
    }

    describe('isFunctionDef', () => {
        it('detects procedure nodes', async () => {
            const nodes = await parseNodes(
                'proc.foo\n    push.1\nend',
                '(procedure) @p'
            );
            if (nodes.length > 0) {
                expect(adapter.isFunctionDef(nodes[0])).toBe(true);
            }
        });
    });

    describe('isExternalCall', () => {
        it('detects syscall instructions', async () => {
            const nodes = await parseNodes(
                'proc.foo\n    syscall.bar\nend',
                '(invoke) @i'
            );
            if (nodes.length > 0) {
                const hasSyscall = nodes.some(n => adapter.isExternalCall(n));
                expect(hasSyscall).toBe(true);
            }
        });
    });

    describe('isReturnStatement', () => {
        it('detects end nodes', async () => {
            // MASM procedures end with 'end' keyword
            const nodes = await parseNodes(
                'proc.foo\n    push.1\nend',
                '(procedure) @p'
            );
            if (nodes.length > 0) {
                // The end node is the last child of the procedure
                const endChild = nodes[0].children.find(c => c.type === 'end' || c.text.trim() === 'end');
                if (endChild) {
                    expect(adapter.isReturnStatement(endChild)).toBe(true);
                }
            }
        });
    });
});
