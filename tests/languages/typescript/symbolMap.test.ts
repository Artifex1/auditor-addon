import { describe, it, expect } from 'vitest';
import { TypeScriptAdapter } from '../../../src/languages/javascriptAdapter';
import { FileContent } from '../../../src/engine/types';

describe('TypeScriptAdapter Call Graph', () => {
    const adapter = new TypeScriptAdapter();

    it('should generate a simple call graph for free functions', async () => {
        const code = `
            function a() {
                b();
            }
            function b() {}
        `;
        const files: FileContent[] = [{ path: '/test.ts', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);
        const totalCallees = functions.reduce((sum, e) => sum + e.callees.length, 0);
        expect(totalCallees).toBe(1);

        const entryA = functions.find(e => e.label === 'a');
        const entryB = functions.find(e => e.label === 'b');
        expect(entryA).toBeDefined();
        expect(entryB).toBeDefined();

        const callee = entryA!.callees[0];
        expect(callee.qualifiedName).toBe(entryB?.qualifiedName);
    });

    it('should handle class methods with this calls', async () => {
        const code = `
            class Server {
                start() {
                    this.initialize();
                }

                initialize() {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.ts', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const start = functions.find(e => e.label === 'start');
        const initialize = functions.find(e => e.label === 'initialize');

        expect(start).toBeDefined();
        expect(initialize).toBeDefined();
        expect(start?.contract).toBe('Server');
        expect(initialize?.contract).toBe('Server');

        const callee = start!.callees.find(c => c.qualifiedName === initialize?.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle TypeScript accessibility modifiers', async () => {
        const code = `
            class Handler {
                public handle() {}
                private helper() {}
                protected internal() {}
                process() {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.ts', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(4);

        const handle = functions.find(e => e.label === 'handle');
        const helper = functions.find(e => e.label === 'helper');
        const internal = functions.find(e => e.label === 'internal');
        const process = functions.find(e => e.label === 'process');

        expect(handle?.visibility).toBe('public');
        expect(helper?.visibility).toBe('private');
        expect(internal?.visibility).toBe('internal');
        expect(process?.visibility).toBe('public');
    });

    it('should mark exported functions as public', async () => {
        const code = `
            export function publicFn() {}
            function privateFn() {}
        `;
        const files: FileContent[] = [{ path: '/test.ts', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const publicFn = functions.find(e => e.label === 'publicFn');
        const privateFn = functions.find(e => e.label === 'privateFn');

        expect(publicFn?.visibility).toBe('public');
        expect(privateFn?.visibility).toBe('private');
    });

    it('should handle multiple classes with methods', async () => {
        const code = `
            class Reader {
                read() { this.parse(); }
                parse() {}
            }

            class Writer {
                write() { this.encode(); }
                encode() {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.ts', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(4);

        const read = functions.find(e => e.label === 'read');
        const parse = functions.find(e => e.label === 'parse');
        const write = functions.find(e => e.label === 'write');
        const encode = functions.find(e => e.label === 'encode');

        expect(read?.contract).toBe('Reader');
        expect(write?.contract).toBe('Writer');

        // read calls parse (same class)
        const callee1 = read!.callees.find(c => c.qualifiedName === parse?.qualifiedName);
        expect(callee1).toBeDefined();

        // write calls encode (same class)
        const callee2 = write!.callees.find(c => c.qualifiedName === encode?.qualifiedName);
        expect(callee2).toBeDefined();
    });

    it('should handle cross-function calls between free functions and methods', async () => {
        const code = `
            function helper() {}

            class Service {
                run() {
                    helper();
                }
            }
        `;
        const files: FileContent[] = [{ path: '/test.ts', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        const helperEntry = functions.find(e => e.label === 'helper');
        const run = functions.find(e => e.label === 'run');

        expect(helperEntry).toBeDefined();
        expect(run).toBeDefined();

        const callee = run!.callees.find(c => c.qualifiedName === helperEntry?.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.ts',
            content: `
                function main() {
                    helper();
                }
            `
        };
        const file2: FileContent = {
            path: '/utils.ts',
            content: `
                export function helper() {
                    internal();
                }

                function internal() {}
            `
        };
        const symbolMap = await adapter.generateSymbolMap([file1, file2]);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const main = functions.find(e => e.label === 'main');
        const helper = functions.find(e => e.label === 'helper');
        const internal = functions.find(e => e.label === 'internal');

        expect(main?.file).toBe('/main.ts');
        expect(helper?.file).toBe('/utils.ts');
        expect(helper?.visibility).toBe('public');

        const callee1 = main!.callees.find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee1).toBeDefined();

        const callee2 = helper!.callees.find(c => c.qualifiedName === internal?.qualifiedName);
        expect(callee2).toBeDefined();
    });

    it('should handle async methods', async () => {
        const code = `
            class ApiClient {
                async fetchData() {
                    this.processResponse();
                }

                processResponse() {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.ts', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        const fetchData = functions.find(e => e.label === 'fetchData');
        const processResponse = functions.find(e => e.label === 'processResponse');

        expect(fetchData).toBeDefined();
        expect(processResponse).toBeDefined();

        const callee = fetchData!.callees.find(c => c.qualifiedName === processResponse?.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle static methods', async () => {
        const code = `
            class Factory {
                static create() {
                    return new Factory();
                }

                static validate() {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.ts', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        const create = functions.find(e => e.label === 'create');
        const validate = functions.find(e => e.label === 'validate');

        expect(create).toBeDefined();
        expect(validate).toBeDefined();
        expect(create?.contract).toBe('Factory');
        expect(validate?.contract).toBe('Factory');
    });
});
