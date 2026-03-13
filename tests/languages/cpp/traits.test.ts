import { describe, it, expect } from 'vitest';
import { CppAdapter } from '../../../src/languages/cppAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

describe('CppAdapter Traits', () => {
    const adapter = new CppAdapter();

    async function parseNodes(code: string, query: string) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Cpp);
        const parser = await service.createParser(SupportedLanguage.Cpp);
        const tree = parser.parse(code);
        const q = new Query(lang, query);
        return q.captures(tree!.rootNode).map(c => c.node);
    }

    describe('isFunctionDef', () => {
        it('detects function definitions', async () => {
            const nodes = await parseNodes(
                'void foo() {}',
                '(function_definition) @f'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });
    });

    describe('isPublicFn', () => {
        it('free functions are public', async () => {
            const nodes = await parseNodes(
                'void foo() {}',
                '(function_definition) @f'
            );
            expect(adapter.isPublicFn(nodes[0])).toBe(true);
        });
    });

    describe('isReturnStatement', () => {
        it('detects return statements', async () => {
            const nodes = await parseNodes(
                'int foo() { return 42; }',
                '(return_statement) @r'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isReturnStatement(nodes[0])).toBe(true);
        });
    });

    describe('isExternalCall', () => {
        it('detects system() calls', async () => {
            const nodes = await parseNodes(
                '#include <cstdlib>\nvoid foo() { system("ls"); }',
                '(call_expression) @c'
            );
            const hasExternal = nodes.some(n => adapter.isExternalCall(n));
            expect(hasExternal).toBe(true);
        });
    });

    describe('isStateWrite', () => {
        it('detects assignment expressions', async () => {
            const nodes = await parseNodes(
                'void foo() { int x = 0; x = 1; }',
                '(assignment_expression) @a'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isStateWrite(nodes[0])).toBe(true);
        });
    });

    describe('resolveCallee via generateSymbolMap', () => {
        it('resolves calls between free functions', async () => {
            const code = `
void callee() {}
void caller() { callee(); }
`;
            const files: FileContent[] = [{ path: '/test.cpp', content: code }];
            const symbolMap = await adapter.generateSymbolMap(files);

            const callerEntry = Array.from(symbolMap.values()).find(e => e.label === 'caller');
            expect(callerEntry).toBeDefined();
            expect(callerEntry!.callees.length).toBeGreaterThan(0);
        });
    });
});
