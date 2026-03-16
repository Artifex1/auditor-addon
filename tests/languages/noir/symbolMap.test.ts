import { describe, it, expect } from 'vitest';
import { NoirAdapter } from '../../../src/languages/noirAdapter';
import { FileContent } from '../../../src/engine/types';

describe('NoirAdapter Call Graph', () => {
    const adapter = new NoirAdapter();

    it('should generate a call graph for free functions', async () => {
        const code = `
            pub fn a() {
                b();
            }
            fn b() {}
        `;
        const files: FileContent[] = [{ path: '/test.nr', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);
        const totalCallees = functions.reduce((sum, e) => sum + e.callees.length, 0);
        expect(totalCallees).toBe(1);

        const entryA = functions.find(e => e.label === 'a');
        const entryB = functions.find(e => e.label === 'b');
        expect(entryA).toBeDefined();
        expect(entryB).toBeDefined();

        expect(entryA!.callees[0].qualifiedName).toBe(entryB?.qualifiedName);
    });

    it('should detect pub visibility', async () => {
        const code = `
            pub fn public_fn() {}
            fn private_fn() {}
        `;
        const files: FileContent[] = [{ path: '/test.nr', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        const publicFn = functions.find(e => e.label === 'public_fn');
        const privateFn = functions.find(e => e.label === 'private_fn');

        expect(publicFn?.visibility).toBe('public');
        expect(privateFn?.visibility).toBe('private');
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.nr',
            content: `
                pub fn main() {
                    helper();
                }
            `
        };
        const file2: FileContent = {
            path: '/utils.nr',
            content: `
                fn helper() {
                    internal();
                }
                fn internal() {}
            `
        };
        const symbolMap = await adapter.generateSymbolMap([file1, file2]);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const main = functions.find(e => e.label === 'main');
        const helper = functions.find(e => e.label === 'helper');

        expect(main?.file).toBe('/main.nr');
        expect(helper?.file).toBe('/utils.nr');

        const callee = main!.callees.find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee).toBeDefined();
    });
});
