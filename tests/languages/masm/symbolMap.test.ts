import { describe, it, expect } from 'vitest';
import { MasmAdapter } from '../../../src/languages/masmAdapter';
import { FileContent } from '../../../src/engine/types';

describe('MasmAdapter Call Graph', () => {
    const adapter = new MasmAdapter();

    it('should generate a call graph for procedures', async () => {
        const code = `proc.foo
    exec.bar
end
proc.bar
end`;
        const files: FileContent[] = [{ path: '/test.masm', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const foo = functions.find(e => e.label === 'foo');
        const bar = functions.find(e => e.label === 'bar');
        expect(foo).toBeDefined();
        expect(bar).toBeDefined();

        const totalCallees = functions.reduce((sum, e) => sum + e.callees.length, 0);
        expect(totalCallees).toBe(1);
        expect(foo!.callees[0].qualifiedName).toBe(bar?.qualifiedName);
    });

    it('should treat entrypoint as external visibility', async () => {
        const code = `proc.foo
end
begin
    exec.foo
end`;
        const files: FileContent[] = [{ path: '/test.masm', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        const entry = functions.find(e => e.label === 'begin');
        expect(entry?.visibility).toBe('external');
    });

    it('should detect calls from entrypoint', async () => {
        const code = `proc.foo
end
begin
    exec.foo
end`;
        const files: FileContent[] = [{ path: '/test.masm', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        const entry = functions.find(e => e.label === 'begin');
        const foo = functions.find(e => e.label === 'foo');

        const callee = entry!.callees.find(c => c.qualifiedName === foo?.qualifiedName);
        expect(callee).toBeDefined();
    });
});
