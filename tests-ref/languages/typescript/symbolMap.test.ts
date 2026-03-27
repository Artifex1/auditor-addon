import { describe, it, expect } from 'vitest';
import { TypeScriptAdapter } from '../../../src/languages/javascriptAdapter';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);
        const totalCallees = functions.reduce((sum, e) => sum + getCallees(graph, e).length, 0);
        expect(totalCallees).toBe(1);

        const entryA = functions.find(e => e.label === 'a');
        const entryB = functions.find(e => e.label === 'b');
        expect(entryA).toBeDefined();
        expect(entryB).toBeDefined();

        const callee = getCallees(graph, entryA!)[0];
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const start = functions.find(e => e.label === 'start');
        const initialize = functions.find(e => e.label === 'initialize');

        expect(start).toBeDefined();
        expect(initialize).toBeDefined();
        expect(start?.qualifiedName).toContain('Server.');
        expect(initialize?.qualifiedName).toContain('Server.');

        const callee = getCallees(graph, start!).find(c => c.qualifiedName === initialize?.qualifiedName);
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(4);

        const read = functions.find(e => e.label === 'read');
        const parse = functions.find(e => e.label === 'parse');
        const write = functions.find(e => e.label === 'write');
        const encode = functions.find(e => e.label === 'encode');

        expect(read?.qualifiedName).toContain('Reader.');
        expect(write?.qualifiedName).toContain('Writer.');

        // read calls parse (same class)
        const callee1 = getCallees(graph, read!).find(c => c.qualifiedName === parse?.qualifiedName);
        expect(callee1).toBeDefined();

        // write calls encode (same class)
        const callee2 = getCallees(graph, write!).find(c => c.qualifiedName === encode?.qualifiedName);
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const helperEntry = functions.find(e => e.label === 'helper');
        const run = functions.find(e => e.label === 'run');

        expect(helperEntry).toBeDefined();
        expect(run).toBeDefined();

        const callee = getCallees(graph, run!).find(c => c.qualifiedName === helperEntry?.qualifiedName);
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
        const graph = await adapter.generateGraph([file1, file2]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const main = functions.find(e => e.label === 'main');
        const helper = functions.find(e => e.label === 'helper');
        const internal = functions.find(e => e.label === 'internal');

        expect(main?.locator?.file).toBe('/main.ts');
        expect(helper?.locator?.file).toBe('/utils.ts');
        expect(helper?.visibility).toBe('public');

        const callee1 = getCallees(graph, main!).find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee1).toBeDefined();

        const callee2 = getCallees(graph, helper!).find(c => c.qualifiedName === internal?.qualifiedName);
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const fetchData = functions.find(e => e.label === 'fetchData');
        const processResponse = functions.find(e => e.label === 'processResponse');

        expect(fetchData).toBeDefined();
        expect(processResponse).toBeDefined();

        const callee = getCallees(graph, fetchData!).find(c => c.qualifiedName === processResponse?.qualifiedName);
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const create = functions.find(e => e.label === 'create');
        const validate = functions.find(e => e.label === 'validate');

        expect(create).toBeDefined();
        expect(validate).toBeDefined();
        expect(create?.qualifiedName).toContain('Factory.');
        expect(validate?.qualifiedName).toContain('Factory.');
    });
});
