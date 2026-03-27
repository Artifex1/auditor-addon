import { describe, it, expect } from 'vitest';
import { NoirAdapter } from '../../../src/languages/noirAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

describe('NoirAdapter Traits', () => {
    const adapter = new NoirAdapter();

    async function parseNodes(code: string, query: string) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Noir);
        const parser = await service.createParser(SupportedLanguage.Noir);
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

    describe('isPublicFn', () => {
        it('detects pub functions', async () => {
            const nodes = await parseNodes(
                'pub fn foo() {}',
                '(function_item) @f'
            );
            expect(adapter.isPublicFn(nodes[0])).toBe(true);
        });

        it('rejects non-pub functions', async () => {
            const nodes = await parseNodes(
                'fn foo() {}',
                '(function_item) @f'
            );
            expect(adapter.isPublicFn(nodes[0])).toBe(false);
        });
    });

    describe('resolveCallee via generateGraph', () => {
        it('resolves internal function calls', async () => {
            const code = `
fn caller() { callee(); }
fn callee() {}
`;
            const files: FileContent[] = [{ path: '/test.nr', content: code }];
            const graph = await adapter.generateGraph(files);

            const callerEntry = Array.from(graph.nodes()).find(e => e.label === 'caller');
            expect(callerEntry).toBeDefined();
            const callees = graph.getOutEdges(callerEntry!.id).filter(e => e.kind === 'calls');
            expect(callees.length).toBeGreaterThan(0);
        });
    });
});
