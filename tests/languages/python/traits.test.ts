import { describe, it, expect } from 'vitest';
import { PythonAdapter } from '../../../src/languages/pythonAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

describe('PythonAdapter Traits', () => {
    const adapter = new PythonAdapter();

    async function parseNodes(code: string, query: string) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Python);
        const parser = await service.createParser(SupportedLanguage.Python);
        const tree = parser.parse(code);
        const q = new Query(lang, query);
        return q.captures(tree!.rootNode).map(c => c.node);
    }

    describe('isFunctionDef', () => {
        it('detects function definitions', async () => {
            const nodes = await parseNodes(
                'def foo():\n    pass',
                '(function_definition) @f'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });
    });

    describe('isPublicFn', () => {
        it('public if no underscore prefix', async () => {
            const nodes = await parseNodes(
                'def foo():\n    pass',
                '(function_definition) @f'
            );
            expect(adapter.isPublicFn(nodes[0])).toBe(true);
        });

        it('private if underscore prefix', async () => {
            const nodes = await parseNodes(
                'def _private():\n    pass',
                '(function_definition) @f'
            );
            expect(adapter.isPublicFn(nodes[0])).toBe(false);
        });
    });

    describe('isReturnStatement', () => {
        it('detects return statements', async () => {
            const nodes = await parseNodes(
                'def foo():\n    return 42',
                '(return_statement) @r'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isReturnStatement(nodes[0])).toBe(true);
        });
    });

    describe('isExternalCall', () => {
        it('detects subprocess calls', async () => {
            const nodes = await parseNodes(
                'import subprocess\ndef foo():\n    subprocess.run(["ls"])',
                '(call) @c'
            );
            const hasExternal = nodes.some(n => adapter.isExternalCall(n));
            expect(hasExternal).toBe(true);
        });

        it('detects os.system calls', async () => {
            const nodes = await parseNodes(
                'import os\ndef foo():\n    os.system("ls")',
                '(call) @c'
            );
            const hasExternal = nodes.some(n => adapter.isExternalCall(n));
            expect(hasExternal).toBe(true);
        });
    });

    describe('getModifiers', () => {
        it('extracts decorators as wrapper modifiers from AST node', async () => {
            const code = `@my_decorator\ndef foo():\n    pass`;
            const nodes = await parseNodes(code, '(function_definition) @f');
            expect(nodes.length).toBeGreaterThan(0);

            const mods = adapter.getModifiers(nodes[0]);
            expect(mods.length).toBeGreaterThan(0);
            expect(mods[0].pattern).toBe('wrapper');
        });
    });

    describe('resolveCallee via generateSymbolMap', () => {
        it('resolves calls between functions', async () => {
            const code = `
def caller():
    callee()

def callee():
    pass
`;
            const files: FileContent[] = [{ path: '/test.py', content: code }];
            const symbolMap = await adapter.generateSymbolMap(files);

            const callerEntry = Array.from(symbolMap.values()).find(e => e.label === 'caller');
            expect(callerEntry).toBeDefined();
            expect(callerEntry!.callees.length).toBeGreaterThan(0);
        });
    });
});
