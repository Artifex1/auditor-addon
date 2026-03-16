import { describe, it, expect } from 'vitest';
import { CairoAdapter } from '../../../src/languages/cairoAdapter';
import { FileContent } from '../../../src/engine/types';

describe('CairoAdapter Call Graph', () => {
    const adapter = new CairoAdapter();

    it('should generate a simple call graph for free functions', async () => {
        const code = `
            fn a() {
                b();
            }
            fn b() {}
        `;
        const files: FileContent[] = [{ path: '/test.cairo', content: code }];
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

    it('should handle impl block methods', async () => {
        const code = `
            impl CounterImpl of ICounter {
                fn increment(ref self: Counter) {
                    self.validate();
                }

                fn validate(ref self: Counter) {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.cairo', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const increment = functions.find(e => e.label === 'increment');
        const validate = functions.find(e => e.label === 'validate');

        expect(increment).toBeDefined();
        expect(validate).toBeDefined();
        expect(increment?.contract).toBe('CounterImpl');
        expect(validate?.contract).toBe('CounterImpl');
    });

    it('should handle pub visibility', async () => {
        const code = `
            pub fn public_fn() {}
            fn private_fn() {}
        `;
        const files: FileContent[] = [{ path: '/test.cairo', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        const publicFn = functions.find(e => e.label === 'public_fn');
        const privateFn = functions.find(e => e.label === 'private_fn');

        expect(publicFn?.visibility).toBe('public');
        expect(privateFn?.visibility).toBe('private');
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.cairo',
            content: `
                fn main() {
                    helper();
                }
            `
        };
        const file2: FileContent = {
            path: '/utils.cairo',
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

        expect(main?.file).toBe('/main.cairo');
        expect(helper?.file).toBe('/utils.cairo');

        const callee = main!.callees.find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee).toBeDefined();
    });
});
