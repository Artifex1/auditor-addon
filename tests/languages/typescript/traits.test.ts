import { describe, it, expect } from 'vitest';
import { TypeScriptAdapter } from '../../../src/languages/javascriptAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

describe('TypeScriptAdapter Traits', () => {
    const adapter = new TypeScriptAdapter();

    async function parseNodes(code: string, query: string) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.TypeScript);
        const parser = await service.createParser(SupportedLanguage.TypeScript);
        const tree = parser.parse(code);
        const q = new Query(lang, query);
        return q.captures(tree!.rootNode).map(c => c.node);
    }

    describe('isFunctionDef', () => {
        it('detects function declarations', async () => {
            const nodes = await parseNodes(
                'function foo() {}',
                '(function_declaration) @f'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });

        it('detects arrow functions', async () => {
            const nodes = await parseNodes(
                'const foo = () => {};',
                '(arrow_function) @f'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });
    });

    describe('isReturnStatement', () => {
        it('detects return statements', async () => {
            const nodes = await parseNodes(
                'function foo() { return 42; }',
                '(return_statement) @r'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isReturnStatement(nodes[0])).toBe(true);
        });
    });

    describe('isExternalCall', () => {
        it('detects fetch calls', async () => {
            const nodes = await parseNodes(
                'function foo() { fetch("https://example.com"); }',
                '(call_expression) @c'
            );
            const hasExternal = nodes.some(n => adapter.isExternalCall(n));
            expect(hasExternal).toBe(true);
        });
    });

    describe('isStateWrite', () => {
        it('detects assignment expressions', async () => {
            const nodes = await parseNodes(
                'let x = 0; x = 1;',
                '(assignment_expression) @a'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isStateWrite(nodes[0])).toBe(true);
        });
    });

    describe('resolveCallee via generateSymbolMap', () => {
        it('resolves calls between functions', async () => {
            const code = `
function caller() { callee(); }
function callee() {}
`;
            const files: FileContent[] = [{ path: '/test.ts', content: code }];
            const symbolMap = await adapter.generateSymbolMap(files);

            const callerEntry = Array.from(symbolMap.values()).find(e => e.label === 'caller');
            expect(callerEntry).toBeDefined();
            expect(callerEntry!.callees.length).toBeGreaterThan(0);
        });
    });
});
