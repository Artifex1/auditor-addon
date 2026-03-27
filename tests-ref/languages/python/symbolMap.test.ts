import { describe, it, expect } from 'vitest';
import { PythonAdapter } from '../../../src/languages/pythonAdapter';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

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

    it('should handle class methods with self calls', async () => {
        const code = `
            class Server:
                def start(self):
                    self.initialize()

                def initialize(self):
                    pass
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const start = functions.find(e => e.label === 'start');
        const initialize = functions.find(e => e.label === 'initialize');

        expect(start).toBeDefined();
        expect(initialize).toBeDefined();

        expect(start?.qualifiedName).toContain('Server.');
        expect(initialize?.qualifiedName).toContain('Server.');

        // start calls initialize
        const callee = getCallees(graph, start!).find(c => c.qualifiedName === initialize?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(6);

        const publicFunc = functions.find(e => e.label === 'public_func');
        const privateFunc = functions.find(e => e.label === '_private_func');
        const handle = functions.find(e => e.label === 'handle');
        const helper = functions.find(e => e.label === '_helper');
        const init = functions.find(e => e.label === '__init__');
        const str = functions.find(e => e.label === '__str__');

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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const helperEntry = functions.find(e => e.label === 'helper');
        const run = functions.find(e => e.label === 'run');

        expect(helperEntry).toBeDefined();
        expect(run).toBeDefined();

        // run calls helper
        const callee = getCallees(graph, run!).find(c => c.qualifiedName === helperEntry?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const request = functions.find(e => e.label === 'request');
        const prepare = functions.find(e => e.label === 'prepare');
        const send = functions.find(e => e.label === 'send');

        expect(request).toBeDefined();
        expect(prepare).toBeDefined();
        expect(send).toBeDefined();

        // request calls prepare and send
        const callees = getCallees(graph, request!);
        expect(callees).toHaveLength(2);
        expect(callees.map(c => c.qualifiedName)).toContain(prepare?.qualifiedName);
        expect(callees.map(c => c.qualifiedName)).toContain(send?.qualifiedName);
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const process = functions.find(e => e.label === 'process');
        const realFunction = functions.find(e => e.label === 'real_function');

        expect(process).toBeDefined();
        expect(realFunction).toBeDefined();

        // Should have edge to real_function but not to builtins
        const callees = getCallees(graph, process!);
        expect(callees).toHaveLength(1);
        expect(callees[0].qualifiedName).toBe(realFunction?.qualifiedName);
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const baseProcess = functions.find(e => e.qualifiedName === 'Base.process');
        const childHandle = functions.find(e => e.qualifiedName === 'Child.handle');

        expect(baseProcess).toBeDefined();
        expect(childHandle).toBeDefined();

        // handle calls Base.process via super()
        const callee = getCallees(graph, childHandle!).find(c => c.qualifiedName === baseProcess?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const baseValidate = functions.find(e => e.qualifiedName === 'Base.validate');
        const childProcess = functions.find(e => e.qualifiedName === 'Child.process');

        expect(baseValidate).toBeDefined();
        expect(childProcess).toBeDefined();

        // process calls Base.validate via self (inherited)
        const callee = getCallees(graph, childProcess!).find(c => c.qualifiedName === baseValidate?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const mixinLog = functions.find(e => e.qualifiedName === 'Mixin.log');
        const baseProcess = functions.find(e => e.qualifiedName === 'Base.process');
        const childHandle = functions.find(e => e.qualifiedName === 'Child.handle');

        expect(mixinLog).toBeDefined();
        expect(baseProcess).toBeDefined();
        expect(childHandle).toBeDefined();

        // handle calls process (inherited from Base) and log (inherited from Mixin)
        const callees = getCallees(graph, childHandle!);
        expect(callees).toHaveLength(2);
        expect(callees.map(c => c.qualifiedName)).toContain(baseProcess?.qualifiedName);
        expect(callees.map(c => c.qualifiedName)).toContain(mixinLog?.qualifiedName);
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(4);

        const read = functions.find(e => e.label === 'read');
        const parse = functions.find(e => e.label === 'parse');
        const write = functions.find(e => e.label === 'write');
        const encode = functions.find(e => e.label === 'encode');

        expect(read?.qualifiedName).toContain('Reader.');
        expect(parse?.qualifiedName).toContain('Reader.');
        expect(write?.qualifiedName).toContain('Writer.');
        expect(encode?.qualifiedName).toContain('Writer.');

        // read calls parse
        const callee1 = getCallees(graph, read!).find(c => c.qualifiedName === parse?.qualifiedName);
        expect(callee1).toBeDefined();

        // write calls encode
        const callee2 = getCallees(graph, write!).find(c => c.qualifiedName === encode?.qualifiedName);
        expect(callee2).toBeDefined();
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
        const graph = await adapter.generateGraph([file1, file2]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const main = functions.find(e => e.label === 'main');
        const helper = functions.find(e => e.label === 'helper');
        const internal = functions.find(e => e.label === 'internal');

        expect(main).toBeDefined();
        expect(helper).toBeDefined();
        expect(internal).toBeDefined();

        expect(main?.locator?.file).toBe('/main.py');
        expect(helper?.locator?.file).toBe('/utils.py');

        // main calls helper
        const callee1 = getCallees(graph, main!).find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee1).toBeDefined();

        // helper calls internal
        const callee2 = getCallees(graph, helper!).find(c => c.qualifiedName === internal?.qualifiedName);
        expect(callee2).toBeDefined();
    });

    it('should attribute nested function calls to the enclosing function', async () => {
        const code = `
            def outer():
                def inner():
                    target()
                inner()

            def target():
                pass
        `;
        const files: FileContent[] = [{ path: '/test.py', content: code }];
        const graph = await adapter.generateGraph(files);
        // Only count concrete (source-defined) function nodes — gap nodes are created for unresolved callees
        const functions = [...graph.nodes()].filter(e => e.kind === 'function' && e.status === 'concrete');

        // inner is not a concrete node — nested functions are not indexed as separate symbols
        expect(functions).toHaveLength(2);
        expect(functions.find(e => e.label === 'outer')).toBeDefined();
        expect(functions.find(e => e.label === 'target')).toBeDefined();
        expect(functions.find(e => e.label === 'inner')).toBeUndefined();

        // the call to target() inside inner is attributed to outer
        const outer = functions.find(e => e.label === 'outer');
        const target = functions.find(e => e.label === 'target');
        const callee = getCallees(graph, outer!).find(c => c.qualifiedName === target?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const common = functions.find(e => e.qualifiedName === 'GrandParent.common');
        const middle = functions.find(e => e.qualifiedName === 'Parent.middle');
        const handle = functions.find(e => e.qualifiedName === 'Child.handle');

        expect(common).toBeDefined();
        expect(middle).toBeDefined();
        expect(handle).toBeDefined();

        const callees = getCallees(graph, handle!);
        expect(callees).toHaveLength(2);
        // super().middle() resolves to Parent.middle
        expect(callees.map(c => c.qualifiedName)).toContain(middle?.qualifiedName);
        // self.common() resolves to GrandParent.common (inherited through Parent -> GrandParent)
        expect(callees.map(c => c.qualifiedName)).toContain(common?.qualifiedName);
    });
});
