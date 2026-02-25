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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);
        expect(graph.edges).toHaveLength(1);

        const nodeA = graph.nodes.find(n => n.label === 'a');
        const nodeB = graph.nodes.find(n => n.label === 'b');
        expect(nodeA).toBeDefined();
        expect(nodeB).toBeDefined();

        const edge = graph.edges[0];
        expect(edge.from).toBe(nodeA?.id);
        expect(edge.to).toBe(nodeB?.id);
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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);

        const start = graph.nodes.find(n => n.label === 'start');
        const initialize = graph.nodes.find(n => n.label === 'initialize');

        expect(start).toBeDefined();
        expect(initialize).toBeDefined();
        expect(start?.contract).toBe('Server');
        expect(initialize?.contract).toBe('Server');

        const edge = graph.edges.find(e => e.from === start?.id);
        expect(edge?.to).toBe(initialize?.id);
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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(4);

        const handle = graph.nodes.find(n => n.label === 'handle');
        const helper = graph.nodes.find(n => n.label === 'helper');
        const internal = graph.nodes.find(n => n.label === 'internal');
        const process = graph.nodes.find(n => n.label === 'process');

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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);

        const publicFn = graph.nodes.find(n => n.label === 'publicFn');
        const privateFn = graph.nodes.find(n => n.label === 'privateFn');

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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(4);

        const read = graph.nodes.find(n => n.label === 'read');
        const parse = graph.nodes.find(n => n.label === 'parse');
        const write = graph.nodes.find(n => n.label === 'write');
        const encode = graph.nodes.find(n => n.label === 'encode');

        expect(read?.contract).toBe('Reader');
        expect(write?.contract).toBe('Writer');

        // read calls parse (same class)
        const edge1 = graph.edges.find(e => e.from === read?.id);
        expect(edge1?.to).toBe(parse?.id);

        // write calls encode (same class)
        const edge2 = graph.edges.find(e => e.from === write?.id);
        expect(edge2?.to).toBe(encode?.id);
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
        const graph = await adapter.generateCallGraph(files);

        const helperNode = graph.nodes.find(n => n.label === 'helper');
        const run = graph.nodes.find(n => n.label === 'run');

        expect(helperNode).toBeDefined();
        expect(run).toBeDefined();

        const edge = graph.edges.find(e => e.from === run?.id);
        expect(edge?.to).toBe(helperNode?.id);
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
        const graph = await adapter.generateCallGraph([file1, file2]);

        expect(graph.nodes).toHaveLength(3);

        const main = graph.nodes.find(n => n.label === 'main');
        const helper = graph.nodes.find(n => n.label === 'helper');
        const internal = graph.nodes.find(n => n.label === 'internal');

        expect(main?.file).toBe('/main.ts');
        expect(helper?.file).toBe('/utils.ts');
        expect(helper?.visibility).toBe('public');

        const edge1 = graph.edges.find(e => e.from === main?.id);
        expect(edge1?.to).toBe(helper?.id);

        const edge2 = graph.edges.find(e => e.from === helper?.id);
        expect(edge2?.to).toBe(internal?.id);
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
        const graph = await adapter.generateCallGraph(files);

        const fetchData = graph.nodes.find(n => n.label === 'fetchData');
        const processResponse = graph.nodes.find(n => n.label === 'processResponse');

        expect(fetchData).toBeDefined();
        expect(processResponse).toBeDefined();

        const edge = graph.edges.find(e => e.from === fetchData?.id);
        expect(edge?.to).toBe(processResponse?.id);
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
        const graph = await adapter.generateCallGraph(files);

        const create = graph.nodes.find(n => n.label === 'create');
        const validate = graph.nodes.find(n => n.label === 'validate');

        expect(create).toBeDefined();
        expect(validate).toBeDefined();
        expect(create?.contract).toBe('Factory');
        expect(validate?.contract).toBe('Factory');
    });
});
