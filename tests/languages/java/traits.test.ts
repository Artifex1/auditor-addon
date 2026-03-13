import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../../../src/languages/javaAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

describe('JavaAdapter Traits', () => {
    const adapter = new JavaAdapter();

    async function parseNodes(code: string, query: string) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Java);
        const parser = await service.createParser(SupportedLanguage.Java);
        const tree = parser.parse(code);
        const q = new Query(lang, query);
        return q.captures(tree!.rootNode).map(c => c.node);
    }

    describe('isFunctionDef', () => {
        it('detects method declarations', async () => {
            const nodes = await parseNodes(
                'class T { void foo() {} }',
                '(method_declaration) @m'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });

        it('detects constructor declarations', async () => {
            const nodes = await parseNodes(
                'class T { T() {} }',
                '(constructor_declaration) @c'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });
    });

    describe('isPublicFn', () => {
        it('detects public methods', async () => {
            const nodes = await parseNodes(
                'class T { public void foo() {} }',
                '(method_declaration) @m'
            );
            expect(adapter.isPublicFn(nodes[0])).toBe(true);
        });

        it('rejects private methods', async () => {
            const nodes = await parseNodes(
                'class T { private void foo() {} }',
                '(method_declaration) @m'
            );
            expect(adapter.isPublicFn(nodes[0])).toBe(false);
        });
    });

    describe('isReturnStatement', () => {
        it('detects return statements', async () => {
            const nodes = await parseNodes(
                'class T { int foo() { return 42; } }',
                '(return_statement) @r'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isReturnStatement(nodes[0])).toBe(true);
        });
    });

    describe('isStateWrite', () => {
        it('detects assignment expressions', async () => {
            const nodes = await parseNodes(
                'class T { int x; void foo() { x = 1; } }',
                '(assignment_expression) @a'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isStateWrite(nodes[0])).toBe(true);
        });
    });

    describe('getModifiers', () => {
        it('extracts annotations as wrapper modifiers from AST node', async () => {
            const code = `class T {\n    @Override\n    public void foo() {}\n}`;
            const nodes = await parseNodes(code, '(method_declaration) @m');
            expect(nodes.length).toBeGreaterThan(0);

            const mods = adapter.getModifiers(nodes[0]);
            expect(mods.length).toBeGreaterThan(0);
            expect(mods[0].pattern).toBe('wrapper');
            expect(mods[0].name).toBe('Override');
        });
    });

    describe('resolveCallee via generateSymbolMap', () => {
        it('resolves calls within the same class', async () => {
            const code = `
class T {
    void caller() { callee(); }
    void callee() {}
}
`;
            const files: FileContent[] = [{ path: '/test.java', content: code }];
            const symbolMap = await adapter.generateSymbolMap(files);

            const callerEntry = Array.from(symbolMap.values()).find(e => e.label === 'caller');
            expect(callerEntry).toBeDefined();
            expect(callerEntry!.callees.length).toBeGreaterThan(0);
        });
    });
});
