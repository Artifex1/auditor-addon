import { describe, it, expect } from 'vitest';
import { GoAdapter } from '../../../src/languages/goAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

describe('GoAdapter Traits', () => {
    const adapter = new GoAdapter();

    async function parseNodes(code: string, query: string) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Go);
        const parser = await service.createParser(SupportedLanguage.Go);
        const tree = parser.parse(code);
        const q = new Query(lang, query);
        return q.captures(tree!.rootNode).map(c => c.node);
    }

    describe('isFunctionDef', () => {
        it('detects function declarations', async () => {
            const nodes = await parseNodes(
                'package main\nfunc Foo() {}',
                '(function_declaration) @f'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });

        it('detects method declarations', async () => {
            const nodes = await parseNodes(
                'package main\ntype T struct{}\nfunc (t T) Method() {}',
                '(method_declaration) @m'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });
    });

    describe('isPublicFn', () => {
        it('uppercase = public', async () => {
            const nodes = await parseNodes(
                'package main\nfunc Exported() {}',
                '(function_declaration) @f'
            );
            expect(adapter.isPublicFn(nodes[0])).toBe(true);
        });

        it('lowercase = private', async () => {
            const nodes = await parseNodes(
                'package main\nfunc unexported() {}',
                '(function_declaration) @f'
            );
            expect(adapter.isPublicFn(nodes[0])).toBe(false);
        });
    });

    describe('isReturnStatement', () => {
        it('detects return statements', async () => {
            const nodes = await parseNodes(
                'package main\nfunc foo() int { return 42 }',
                '(return_statement) @r'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isReturnStatement(nodes[0])).toBe(true);
        });
    });

    describe('isStateWrite', () => {
        it('detects assignment statements', async () => {
            const nodes = await parseNodes(
                'package main\nfunc foo() { x := 1; x = 2 }',
                '(assignment_statement) @a'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isStateWrite(nodes[0])).toBe(true);
        });

        it('detects short var declarations', async () => {
            const nodes = await parseNodes(
                'package main\nfunc foo() { x := 1 }',
                '(short_var_declaration) @s'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isStateWrite(nodes[0])).toBe(true);
        });
    });

    describe('resolveCallee via generateGraph', () => {
        it('resolves calls between functions', async () => {
            const code = `package main
func Caller() { Callee() }
func Callee() {}
`;
            const files: FileContent[] = [{ path: '/test.go', content: code }];
            const graph = await adapter.generateGraph(files);

            const callerEntry = Array.from(graph.nodes()).find(e => e.label === 'Caller');
            expect(callerEntry).toBeDefined();
            const callees = graph.getOutEdges(callerEntry!.id).filter(e => e.kind === 'calls');
            expect(callees.length).toBeGreaterThan(0);
            expect(graph.getNode(callees[0].to)?.qualifiedName).toContain('Callee');
        });
    });
});
