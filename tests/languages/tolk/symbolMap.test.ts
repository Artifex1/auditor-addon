import { describe, it, expect } from 'vitest';
import { TolkAdapter } from '../../../src/languages/tolkAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('TolkAdapter Call Graph', () => {
    const adapter = new TolkAdapter();

    it('should generate a simple call graph for free functions', async () => {
        const code = `
fun a() {
    b();
}

fun b() {}
`;
        const files: FileContent[] = [{ path: '/test.tolk', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);
        const totalCallees = functions.reduce((sum, e) => sum + e.callees.length, 0);
        expect(totalCallees).toBe(1);

        const entryA = functions.find(e => e.label === 'a');
        const entryB = functions.find(e => e.label === 'b');
        expect(entryA).toBeDefined();
        expect(entryB).toBeDefined();

        expect(entryA!.callees[0].qualifiedName).toBe(entryB!.qualifiedName);
    });

    it('should mark all functions as public', async () => {
        const code = `
fun helper(): int { return 1; }
fun main() { helper(); }
`;
        const files: FileContent[] = [{ path: '/test.tolk', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        for (const entry of functions) {
            expect(entry.visibility).toBe('public');
        }
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.tolk',
            content: `
fun main() {
    util();
}
`
        };
        const file2: FileContent = {
            path: '/util.tolk',
            content: `
fun util() {
    inner();
}

fun inner() {}
`
        };
        const symbolMap = await adapter.generateSymbolMap([file1, file2]);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const main = functions.find(e => e.label === 'main');
        const util = functions.find(e => e.label === 'util');
        const inner = functions.find(e => e.label === 'inner');

        expect(main?.file).toBe('/main.tolk');
        expect(util?.file).toBe('/util.tolk');
        expect(inner?.file).toBe('/util.tolk');

        const callee1 = main!.callees.find(c => c.qualifiedName === util?.qualifiedName);
        expect(callee1).toBeDefined();

        const callee2 = util!.callees.find(c => c.qualifiedName === inner?.qualifiedName);
        expect(callee2).toBeDefined();
    });

    it('should detect direct calls within a chain', async () => {
        const code = `
fun a() { b(); }
fun b() { c(); }
fun c() {}
`;
        const files: FileContent[] = [{ path: '/test.tolk', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);
        const totalCallees = functions.reduce((sum, e) => sum + e.callees.length, 0);
        expect(totalCallees).toBe(2);

        const a = functions.find(e => e.label === 'a')!;
        const b = functions.find(e => e.label === 'b')!;
        const c = functions.find(e => e.label === 'c')!;

        expect(a.callees.find(cl => cl.qualifiedName === b.qualifiedName)).toBeDefined();
        expect(b.callees.find(cl => cl.qualifiedName === c.qualifiedName)).toBeDefined();
    });
});
