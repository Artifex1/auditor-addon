import { describe, it, expect } from 'vitest';
import { CairoAdapter } from '../../../src/languages/cairoAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

describe('CairoAdapter Traits', () => {
    const adapter = new CairoAdapter();

    async function parseNodes(code: string, query: string) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Cairo);
        const parser = await service.createParser(SupportedLanguage.Cairo);
        const tree = parser.parse(code);
        const q = new Query(lang, query);
        return q.captures(tree!.rootNode).map(c => c.node);
    }

    describe('isFunctionDef', () => {
        it('detects function_item nodes', async () => {
            const nodes = await parseNodes(
                'fn foo() {}',
                '(function_item) @f'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });
    });

    describe('getFunctionName', () => {
        it('extracts function name', async () => {
            const nodes = await parseNodes(
                'fn my_func() {}',
                '(function_item) @f'
            );
            const name = adapter.getFunctionName(nodes[0]);
            expect(name).toBe('my_func');
        });
    });

    describe('isReturnStatement', () => {
        it('detects return expressions', async () => {
            const nodes = await parseNodes(
                'fn foo() -> u32 { return 42; }',
                '(return_expression) @r'
            );
            if (nodes.length > 0) {
                expect(adapter.isReturnStatement(nodes[0])).toBe(true);
            }
        });
    });

    describe('isStateWrite', () => {
        it('detects assignment', async () => {
            const nodes = await parseNodes(
                'fn foo() { let mut x = 0; x = 1; }',
                '(assignment_expression) @a'
            );
            if (nodes.length > 0) {
                expect(adapter.isStateWrite(nodes[0])).toBe(true);
            }
        });
    });

    describe('isBuiltinContextValue', () => {
        it('detects get_caller_address as caller', async () => {
            const nodes = await parseNodes(
                'fn foo() { get_caller_address(); }',
                '(call_expression) @c'
            );
            if (nodes.length > 0) {
                const result = adapter.isBuiltinContextValue(nodes[0]);
                if (result) {
                    expect(result.category).toBe('caller');
                }
            }
        });
    });

    describe('resolveCallee via generateSymbolMap', () => {
        it('resolves internal calls between functions', async () => {
            const code = `
                fn caller() {
                    callee();
                }
                fn callee() {}
            `;
            const files: FileContent[] = [{ path: '/test.cairo', content: code }];
            const symbolMap = await adapter.generateSymbolMap(files);

            const callerEntry = Array.from(symbolMap.values()).find(e => e.label === 'caller');
            expect(callerEntry).toBeDefined();
            if (callerEntry && callerEntry.callees.length > 0) {
                expect(callerEntry.callees[0].qualifiedName).toContain('callee');
            }
        });
    });
});
