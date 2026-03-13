import { describe, it, expect } from 'vitest';
import { RustAdapter } from '../../../src/languages/rustAdapter.js';
import { FileContent, SupportedLanguage } from '../../../src/engine/types.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

describe('RustAdapter Traits', () => {
    const adapter = new RustAdapter();

    async function parseNodes(code: string, query: string) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Rust);
        const parser = await service.createParser(SupportedLanguage.Rust);
        const tree = parser.parse(code);
        const q = new Query(lang, query);
        return q.captures(tree!.rootNode).map(c => c.node);
    }

    describe('isFunctionDef', () => {
        it('returns true for function_item', async () => {
            const nodes = await parseNodes('fn foo() {}', '(function_item) @f');
            expect(adapter.isFunctionDef(nodes[0])).toBe(true);
        });
    });

    describe('isPublicFn', () => {
        it('detects pub functions', async () => {
            const nodes = await parseNodes('pub fn foo() {}', '(function_item) @f');
            expect(adapter.isPublicFn(nodes[0])).toBe(true);
        });

        it('rejects non-pub functions', async () => {
            const nodes = await parseNodes('fn foo() {}', '(function_item) @f');
            expect(adapter.isPublicFn(nodes[0])).toBe(false);
        });
    });

    describe('getFunctionName', () => {
        it('extracts function name', async () => {
            const nodes = await parseNodes('fn my_func() {}', '(function_item) @f');
            expect(adapter.getFunctionName(nodes[0])).toBe('my_func');
        });
    });

    describe('isReturnStatement', () => {
        it('detects return expressions', async () => {
            const nodes = await parseNodes(
                'fn foo() -> i32 { return 42; }',
                '(return_expression) @r'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isReturnStatement(nodes[0])).toBe(true);
        });
    });

    describe('isExternalCall', () => {
        it('detects call expressions inside unsafe blocks', async () => {
            // isExternalCall checks call_expression nodes that have an unsafe_block ancestor
            const nodes = await parseNodes(
                'fn foo() { unsafe { libc::malloc(8); } }',
                '(call_expression) @c'
            );
            expect(nodes.length).toBeGreaterThan(0);
            const hasExternal = nodes.some(n => adapter.isExternalCall(n));
            expect(hasExternal).toBe(true);
        });
    });

    describe('isStateWrite', () => {
        it('detects assignment', async () => {
            const nodes = await parseNodes(
                'fn foo() { let mut x = 0; x = 1; }',
                '(assignment_expression) @a'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isStateWrite(nodes[0])).toBe(true);
        });

        it('detects compound assignment', async () => {
            const nodes = await parseNodes(
                'fn foo() { let mut x = 0; x += 1; }',
                '(compound_assignment_expr) @a'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isStateWrite(nodes[0])).toBe(true);
        });
    });

    describe('isStateRead', () => {
        it('detects field expressions as reads', async () => {
            const nodes = await parseNodes(
                'struct S { x: i32 } fn foo(s: S) { let _ = s.x; }',
                '(field_expression) @f'
            );
            expect(nodes.length).toBeGreaterThan(0);
            expect(adapter.isStateRead(nodes[0])).toBe(true);
        });
    });

    describe('getModifiers', () => {
        it('extracts attributes as declarative modifiers from AST node', async () => {
            const code = `#[inline]\n#[must_use]\npub fn foo() -> i32 { 42 }`;
            const nodes = await parseNodes(code, '(function_item) @f');
            expect(nodes.length).toBeGreaterThan(0);

            const mods = adapter.getModifiers(nodes[0]);
            expect(mods.length).toBeGreaterThan(0);
            expect(mods.every(m => m.pattern === 'declarative')).toBe(true);
        });
    });

    describe('getCallTarget', () => {
        it('extracts call target from call expression', async () => {
            const nodes = await parseNodes(
                'fn foo() { bar(); }',
                '(call_expression) @c'
            );
            expect(nodes.length).toBeGreaterThan(0);
            const target = adapter.getCallTarget(nodes[0]);
            expect(target).toBe('bar');
        });
    });

    describe('resolveCallee via generateSymbolMap', () => {
        it('resolves internal function calls', async () => {
            const code = `
                fn caller() { callee(); }
                fn callee() {}
            `;
            const files: FileContent[] = [{ path: '/test.rs', content: code }];
            const symbolMap = await adapter.generateSymbolMap(files);

            const callerEntry = Array.from(symbolMap.values()).find(e => e.label === 'caller');
            expect(callerEntry).toBeDefined();
            expect(callerEntry!.callees.length).toBeGreaterThan(0);
            expect(callerEntry!.callees[0].qualifiedName).toContain('callee');
            expect(callerEntry!.callees[0].targetKind).toBe('internal');
        });
    });
});
