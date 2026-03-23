import { describe, it, expect } from 'vitest';
import { GoAdapter } from '../../../src/languages/goAdapter';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

describe('GoAdapter Call Graph', () => {
    const adapter = new GoAdapter();

    it('should generate a simple call graph for package functions', async () => {
        const code = `
            package main

            func a() {
                b()
            }
            func b() {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
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

    it('should handle method declarations with pointer receiver', async () => {
        const code = `
            package main

            type Server struct{}

            func (s *Server) Start() {
                s.initialize()
            }

            func (s *Server) initialize() {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const start = functions.find(e => e.label === 'Start');
        const initialize = functions.find(e => e.label === 'initialize');

        expect(start).toBeDefined();
        expect(initialize).toBeDefined();

        expect(start?.qualifiedName).toContain('Server.');
        expect(initialize?.qualifiedName).toContain('Server.');

        // Start calls initialize
        const callee = getCallees(graph, start!).find(c => c.qualifiedName === initialize?.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle method declarations with value receiver', async () => {
        const code = `
            package main

            type Counter struct {
                value int
            }

            func (c Counter) Get() int {
                return c.value
            }

            func (c *Counter) Increment() {
                c.value++
                c.notify()
            }

            func (c *Counter) notify() {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const get = functions.find(e => e.label === 'Get');
        const increment = functions.find(e => e.label === 'Increment');
        const notify = functions.find(e => e.label === 'notify');

        expect(get).toBeDefined();
        expect(increment).toBeDefined();
        expect(notify).toBeDefined();

        // Increment calls notify
        const callee = getCallees(graph, increment!).find(c => c.qualifiedName === notify?.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle visibility based on capitalization', async () => {
        const code = `
            package main

            func PublicFunc() {}
            func privateFunc() {}

            type Handler struct{}

            func (h *Handler) Handle() {}
            func (h *Handler) helper() {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(4);

        const publicFunc = functions.find(e => e.label === 'PublicFunc');
        const privateFunc = functions.find(e => e.label === 'privateFunc');
        const handle = functions.find(e => e.label === 'Handle');
        const helper = functions.find(e => e.label === 'helper');

        expect(publicFunc?.visibility).toBe('public');
        expect(privateFunc?.visibility).toBe('private');
        expect(handle?.visibility).toBe('public');
        expect(helper?.visibility).toBe('private');
    });

    it('should handle selector expression calls (method calls)', async () => {
        const code = `
            package main

            type Client struct{}

            func (c *Client) Request() {
                c.prepare()
                c.send()
            }

            func (c *Client) prepare() {}
            func (c *Client) send() {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const request = functions.find(e => e.label === 'Request');
        const prepare = functions.find(e => e.label === 'prepare');
        const send = functions.find(e => e.label === 'send');

        expect(request).toBeDefined();
        expect(prepare).toBeDefined();
        expect(send).toBeDefined();

        // Request calls prepare and send
        const callees = getCallees(graph, request!);
        expect(callees).toHaveLength(2);
        expect(callees.map(c => c.qualifiedName)).toContain(prepare?.qualifiedName);
        expect(callees.map(c => c.qualifiedName)).toContain(send?.qualifiedName);
    });

    it('should handle package-level function calls from methods', async () => {
        const code = `
            package main

            func helper() {}

            type Service struct{}

            func (s *Service) Run() {
                helper()
            }
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const helper = functions.find(e => e.label === 'helper');
        const run = functions.find(e => e.label === 'Run');

        expect(helper).toBeDefined();
        expect(run).toBeDefined();

        // Run calls helper
        const callee = getCallees(graph, run!).find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle init and main functions', async () => {
        const code = `
            package main

            func init() {
                setup()
            }

            func main() {
                run()
            }

            func setup() {}
            func run() {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const initFunc = functions.find(e => e.label === 'init');
        const mainFunc = functions.find(e => e.label === 'main');
        const setup = functions.find(e => e.label === 'setup');
        const run = functions.find(e => e.label === 'run');

        expect(initFunc).toBeDefined();
        expect(mainFunc).toBeDefined();
        expect(setup).toBeDefined();
        expect(run).toBeDefined();

        // init calls setup
        const callee1 = getCallees(graph, initFunc!).find(c => c.qualifiedName === setup?.qualifiedName);
        expect(callee1).toBeDefined();

        // main calls run
        const callee2 = getCallees(graph, mainFunc!).find(c => c.qualifiedName === run?.qualifiedName);
        expect(callee2).toBeDefined();
    });

    it('should skip builtin function calls', async () => {
        const code = `
            package main

            func process() {
                data := make([]int, 10)
                length := len(data)
                newData := append(data, 1)
                copy(newData, data)
                realFunction()
            }

            func realFunction() {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const process = functions.find(e => e.label === 'process');
        const realFunction = functions.find(e => e.label === 'realFunction');

        expect(process).toBeDefined();
        expect(realFunction).toBeDefined();

        // Should have edge to realFunction but not to builtins
        const callees = getCallees(graph, process!);
        expect(callees).toHaveLength(1);
        expect(callees[0].qualifiedName).toBe(realFunction?.qualifiedName);
    });

    it('should handle defer and go statements', async () => {
        const code = `
            package main

            func main() {
                defer cleanup()
                go worker()
                process()
            }

            func cleanup() {}
            func worker() {}
            func process() {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const main = functions.find(e => e.label === 'main');
        const cleanup = functions.find(e => e.label === 'cleanup');
        const worker = functions.find(e => e.label === 'worker');
        const process = functions.find(e => e.label === 'process');

        expect(main).toBeDefined();
        expect(cleanup).toBeDefined();
        expect(worker).toBeDefined();
        expect(process).toBeDefined();

        // main calls cleanup, worker, and process
        expect(getCallees(graph, main!)).toHaveLength(3);
    });

    it('should handle anonymous function calls', async () => {
        const code = `
            package main

            func process() {
                handler := func() {
                    helper()
                }
                handler()
            }

            func helper() {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const process = functions.find(e => e.label === 'process');
        const helper = functions.find(e => e.label === 'helper');

        expect(process).toBeDefined();
        expect(helper).toBeDefined();

        // the call to helper inside the anonymous function is attributed to process
        const callee = getCallees(graph, process!).find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle generic functions', async () => {
        const code = `
            package main

            func Process[T any](item T) {
                Handle(item)
            }

            func Handle[T any](item T) {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const process = functions.find(e => e.label === 'Process');
        const handle = functions.find(e => e.label === 'Handle');

        expect(process).toBeDefined();
        expect(handle).toBeDefined();

        const callee = getCallees(graph, process!).find(c => c.qualifiedName === handle?.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle multiple types with methods', async () => {
        const code = `
            package main

            type Reader struct{}
            type Writer struct{}

            func (r *Reader) Read() {
                r.parse()
            }

            func (r *Reader) parse() {}

            func (w *Writer) Write() {
                w.encode()
            }

            func (w *Writer) encode() {}
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(4);

        const read = functions.find(e => e.label === 'Read');
        const parse = functions.find(e => e.label === 'parse');
        const write = functions.find(e => e.label === 'Write');
        const encode = functions.find(e => e.label === 'encode');

        expect(read?.qualifiedName).toContain('Reader.');
        expect(parse?.qualifiedName).toContain('Reader.');
        expect(write?.qualifiedName).toContain('Writer.');
        expect(encode?.qualifiedName).toContain('Writer.');

        // Read calls parse
        const callee1 = getCallees(graph, read!).find(c => c.qualifiedName === parse?.qualifiedName);
        expect(callee1).toBeDefined();

        // Write calls encode
        const callee2 = getCallees(graph, write!).find(c => c.qualifiedName === encode?.qualifiedName);
        expect(callee2).toBeDefined();
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.go',
            content: `
                package main

                func main() {
                    helper()
                }
            `
        };
        const file2: FileContent = {
            path: '/utils.go',
            content: `
                package main

                func helper() {
                    internal()
                }

                func internal() {}
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

        expect(main?.locator?.file).toBe('/main.go');
        expect(helper?.locator?.file).toBe('/utils.go');

        // main calls helper
        const callee1 = getCallees(graph, main!).find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee1).toBeDefined();

        // helper calls internal
        const callee2 = getCallees(graph, helper!).find(c => c.qualifiedName === internal?.qualifiedName);
        expect(callee2).toBeDefined();
    });

    it('should handle chained method calls', async () => {
        const code = `
            package main

            type Builder struct{}

            func NewBuilder() *Builder {
                return &Builder{}
            }

            func (b *Builder) WithOption() *Builder {
                return b
            }

            func (b *Builder) Build() {}

            func main() {
                NewBuilder().WithOption().Build()
            }
        `;
        const files: FileContent[] = [{ path: '/test.go', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const main = functions.find(e => e.label === 'main');
        const newBuilder = functions.find(e => e.label === 'NewBuilder');
        const withOption = functions.find(e => e.label === 'WithOption');
        const build = functions.find(e => e.label === 'Build');

        expect(main).toBeDefined();
        expect(newBuilder).toBeDefined();
        expect(withOption).toBeDefined();
        expect(build).toBeDefined();

        // main should have edges to at least NewBuilder
        expect(getCallees(graph, main!).length).toBeGreaterThanOrEqual(1);
    });
});
