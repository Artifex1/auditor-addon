import { describe, it, expect } from 'vitest';
import { PythonAdapter } from '../../../src/languages/pythonAdapter';
import { FileContent } from '../../../src/engine/types';

describe('PythonAdapter Call Graph', () => {
    const adapter = new PythonAdapter();

    it('should generate a simple call graph for free functions', async () => {
        const code = `
            def a():
                b()

            def b():
                pass
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
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

    it('should handle class methods with self calls', async () => {
        const code = `
            class Server:
                def start(self):
                    self.initialize()

                def initialize(self):
                    pass
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);

        const start = graph.nodes.find(n => n.label === 'start');
        const initialize = graph.nodes.find(n => n.label === 'initialize');

        expect(start).toBeDefined();
        expect(initialize).toBeDefined();

        expect(start?.contract).toBe('Server');
        expect(initialize?.contract).toBe('Server');

        // start calls initialize
        const edge = graph.edges.find(e => e.from === start?.id);
        expect(edge?.to).toBe(initialize?.id);
    });

    it('should handle visibility based on underscore convention', async () => {
        const code = `
            def public_func():
                pass

            def _private_func():
                pass

            class Handler:
                def handle(self):
                    pass

                def _helper(self):
                    pass

                def __init__(self):
                    pass

                def __str__(self):
                    pass
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(6);

        const publicFunc = graph.nodes.find(n => n.label === 'public_func');
        const privateFunc = graph.nodes.find(n => n.label === '_private_func');
        const handle = graph.nodes.find(n => n.label === 'handle');
        const helper = graph.nodes.find(n => n.label === '_helper');
        const init = graph.nodes.find(n => n.label === '__init__');
        const str = graph.nodes.find(n => n.label === '__str__');

        expect(publicFunc?.visibility).toBe('public');
        expect(privateFunc?.visibility).toBe('private');
        expect(handle?.visibility).toBe('public');
        expect(helper?.visibility).toBe('private');
        // Dunder methods are public
        expect(init?.visibility).toBe('public');
        expect(str?.visibility).toBe('public');
    });

    it('should handle cross-function calls between free functions and methods', async () => {
        const code = `
            def helper():
                pass

            class Service:
                def run(self):
                    helper()
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const helperNode = graph.nodes.find(n => n.label === 'helper');
        const run = graph.nodes.find(n => n.label === 'run');

        expect(helperNode).toBeDefined();
        expect(run).toBeDefined();

        // run calls helper
        const edge = graph.edges.find(e => e.from === run?.id);
        expect(edge?.to).toBe(helperNode?.id);
    });

    it('should handle multiple self.method() calls', async () => {
        const code = `
            class Client:
                def request(self):
                    self.prepare()
                    self.send()

                def prepare(self):
                    pass

                def send(self):
                    pass
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const request = graph.nodes.find(n => n.label === 'request');
        const prepare = graph.nodes.find(n => n.label === 'prepare');
        const send = graph.nodes.find(n => n.label === 'send');

        expect(request).toBeDefined();
        expect(prepare).toBeDefined();
        expect(send).toBeDefined();

        // request calls prepare and send
        const edges = graph.edges.filter(e => e.from === request?.id);
        expect(edges).toHaveLength(2);
        expect(edges.map(e => e.to)).toContain(prepare?.id);
        expect(edges.map(e => e.to)).toContain(send?.id);
    });

    it('should skip builtin function calls', async () => {
        const code = `
            def process():
                data = list(range(10))
                length = len(data)
                print(length)
                real_function()

            def real_function():
                pass
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const process = graph.nodes.find(n => n.label === 'process');
        const realFunction = graph.nodes.find(n => n.label === 'real_function');

        expect(process).toBeDefined();
        expect(realFunction).toBeDefined();

        // Should have edge to real_function but not to builtins
        const edges = graph.edges.filter(e => e.from === process?.id);
        expect(edges).toHaveLength(1);
        expect(edges[0].to).toBe(realFunction?.id);
    });

    it('should handle inheritance and super() calls', async () => {
        const code = `
            class Base:
                def process(self):
                    pass

            class Child(Base):
                def handle(self):
                    super().process()
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const baseProcess = graph.nodes.find(n => n.id === 'Base.process');
        const childHandle = graph.nodes.find(n => n.id === 'Child.handle');

        expect(baseProcess).toBeDefined();
        expect(childHandle).toBeDefined();

        // handle calls Base.process via super()
        const edge = graph.edges.find(e => e.from === childHandle?.id);
        expect(edge?.to).toBe(baseProcess?.id);
    });

    it('should resolve self.method() calls to inherited methods', async () => {
        const code = `
            class Base:
                def validate(self):
                    pass

            class Child(Base):
                def process(self):
                    self.validate()
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const baseValidate = graph.nodes.find(n => n.id === 'Base.validate');
        const childProcess = graph.nodes.find(n => n.id === 'Child.process');

        expect(baseValidate).toBeDefined();
        expect(childProcess).toBeDefined();

        // process calls Base.validate via self (inherited)
        const edge = graph.edges.find(e => e.from === childProcess?.id);
        expect(edge?.to).toBe(baseValidate?.id);
    });

    it('should handle multiple inheritance (MRO)', async () => {
        const code = `
            class Mixin:
                def log(self):
                    pass

            class Base:
                def process(self):
                    pass

            class Child(Base, Mixin):
                def handle(self):
                    self.process()
                    self.log()
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const mixinLog = graph.nodes.find(n => n.id === 'Mixin.log');
        const baseProcess = graph.nodes.find(n => n.id === 'Base.process');
        const childHandle = graph.nodes.find(n => n.id === 'Child.handle');

        expect(mixinLog).toBeDefined();
        expect(baseProcess).toBeDefined();
        expect(childHandle).toBeDefined();

        // handle calls process (inherited from Base) and log (inherited from Mixin)
        const edges = graph.edges.filter(e => e.from === childHandle?.id);
        expect(edges).toHaveLength(2);
        expect(edges.map(e => e.to)).toContain(baseProcess?.id);
        expect(edges.map(e => e.to)).toContain(mixinLog?.id);
    });

    it('should handle multiple classes with methods in same file', async () => {
        const code = `
            class Reader:
                def read(self):
                    self.parse()

                def parse(self):
                    pass

            class Writer:
                def write(self):
                    self.encode()

                def encode(self):
                    pass
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(4);

        const read = graph.nodes.find(n => n.label === 'read');
        const parse = graph.nodes.find(n => n.label === 'parse');
        const write = graph.nodes.find(n => n.label === 'write');
        const encode = graph.nodes.find(n => n.label === 'encode');

        expect(read?.contract).toBe('Reader');
        expect(parse?.contract).toBe('Reader');
        expect(write?.contract).toBe('Writer');
        expect(encode?.contract).toBe('Writer');

        // read calls parse
        const edge1 = graph.edges.find(e => e.from === read?.id);
        expect(edge1?.to).toBe(parse?.id);

        // write calls encode
        const edge2 = graph.edges.find(e => e.from === write?.id);
        expect(edge2?.to).toBe(encode?.id);
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.py',
            content: `
                def main():
                    helper()
            `
        };
        const file2: FileContent = {
            path: '/utils.py',
            content: `
                def helper():
                    internal()

                def internal():
                    pass
            `
        };
        const graph = await adapter.generateCallGraph([file1, file2]);

        expect(graph.nodes).toHaveLength(3);

        const main = graph.nodes.find(n => n.label === 'main');
        const helper = graph.nodes.find(n => n.label === 'helper');
        const internal = graph.nodes.find(n => n.label === 'internal');

        expect(main).toBeDefined();
        expect(helper).toBeDefined();
        expect(internal).toBeDefined();

        expect(main?.file).toBe('/main.py');
        expect(helper?.file).toBe('/utils.py');

        // main calls helper
        const edge1 = graph.edges.find(e => e.from === main?.id);
        expect(edge1?.to).toBe(helper?.id);

        // helper calls internal
        const edge2 = graph.edges.find(e => e.from === helper?.id);
        expect(edge2?.to).toBe(internal?.id);
    });

    it('should skip nested functions (closures)', async () => {
        const code = `
            def outer():
                def inner():
                    pass
                inner()

            def standalone():
                pass
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        // TODOD - Add tests and logic for inner functions as well
        // Only outer and standalone should be in the symbol table, not inner
        expect(graph.nodes).toHaveLength(2);
        expect(graph.nodes.find(n => n.label === 'outer')).toBeDefined();
        expect(graph.nodes.find(n => n.label === 'standalone')).toBeDefined();
        expect(graph.nodes.find(n => n.label === 'inner')).toBeUndefined();
    });

    it('should handle deep inheritance chains', async () => {
        const code = `
            class GrandParent:
                def common(self):
                    pass

            class Parent(GrandParent):
                def middle(self):
                    pass

            class Child(Parent):
                def handle(self):
                    super().middle()
                    self.common()
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const common = graph.nodes.find(n => n.id === 'GrandParent.common');
        const middle = graph.nodes.find(n => n.id === 'Parent.middle');
        const handle = graph.nodes.find(n => n.id === 'Child.handle');

        expect(common).toBeDefined();
        expect(middle).toBeDefined();
        expect(handle).toBeDefined();

        const edges = graph.edges.filter(e => e.from === handle?.id);
        expect(edges).toHaveLength(2);
        // super().middle() resolves to Parent.middle
        expect(edges.map(e => e.to)).toContain(middle?.id);
        // self.common() resolves to GrandParent.common (inherited through Parent -> GrandParent)
        expect(edges.map(e => e.to)).toContain(common?.id);
    });
});
