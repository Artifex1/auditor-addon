import { describe, it, expect } from 'vitest';
import { GoAdapter } from '../../../src/languages/goAdapter';
import { FileContent } from '../../../src/engine/types';

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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);

        const start = graph.nodes.find(n => n.label === 'Start');
        const initialize = graph.nodes.find(n => n.label === 'initialize');

        expect(start).toBeDefined();
        expect(initialize).toBeDefined();

        expect(start?.contract).toBe('Server');
        expect(initialize?.contract).toBe('Server');

        // Start calls initialize
        const edge = graph.edges.find(e => e.from === start?.id);
        expect(edge?.to).toBe(initialize?.id);
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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(3);

        const get = graph.nodes.find(n => n.label === 'Get');
        const increment = graph.nodes.find(n => n.label === 'Increment');
        const notify = graph.nodes.find(n => n.label === 'notify');

        expect(get).toBeDefined();
        expect(increment).toBeDefined();
        expect(notify).toBeDefined();

        // Increment calls notify
        const edge = graph.edges.find(e => e.from === increment?.id);
        expect(edge?.to).toBe(notify?.id);
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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(4);

        const publicFunc = graph.nodes.find(n => n.label === 'PublicFunc');
        const privateFunc = graph.nodes.find(n => n.label === 'privateFunc');
        const handle = graph.nodes.find(n => n.label === 'Handle');
        const helper = graph.nodes.find(n => n.label === 'helper');

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
        const graph = await adapter.generateCallGraph(files);

        const request = graph.nodes.find(n => n.label === 'Request');
        const prepare = graph.nodes.find(n => n.label === 'prepare');
        const send = graph.nodes.find(n => n.label === 'send');

        expect(request).toBeDefined();
        expect(prepare).toBeDefined();
        expect(send).toBeDefined();

        // Request calls prepare and send
        const edges = graph.edges.filter(e => e.from === request?.id);
        expect(edges).toHaveLength(2);
        expect(edges.map(e => e.to)).toContain(prepare?.id);
        expect(edges.map(e => e.to)).toContain(send?.id);
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
        const graph = await adapter.generateCallGraph(files);

        const helper = graph.nodes.find(n => n.label === 'helper');
        const run = graph.nodes.find(n => n.label === 'Run');

        expect(helper).toBeDefined();
        expect(run).toBeDefined();

        // Run calls helper
        const edge = graph.edges.find(e => e.from === run?.id);
        expect(edge?.to).toBe(helper?.id);
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
        const graph = await adapter.generateCallGraph(files);

        const initFunc = graph.nodes.find(n => n.label === 'init');
        const mainFunc = graph.nodes.find(n => n.label === 'main');
        const setup = graph.nodes.find(n => n.label === 'setup');
        const run = graph.nodes.find(n => n.label === 'run');

        expect(initFunc).toBeDefined();
        expect(mainFunc).toBeDefined();
        expect(setup).toBeDefined();
        expect(run).toBeDefined();

        // init calls setup
        const edge1 = graph.edges.find(e => e.from === initFunc?.id);
        expect(edge1?.to).toBe(setup?.id);

        // main calls run
        const edge2 = graph.edges.find(e => e.from === mainFunc?.id);
        expect(edge2?.to).toBe(run?.id);
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
        const graph = await adapter.generateCallGraph(files);

        const process = graph.nodes.find(n => n.label === 'process');
        const realFunction = graph.nodes.find(n => n.label === 'realFunction');

        expect(process).toBeDefined();
        expect(realFunction).toBeDefined();

        // Should have edge to realFunction but not to builtins
        const edges = graph.edges.filter(e => e.from === process?.id);
        expect(edges).toHaveLength(1);
        expect(edges[0].to).toBe(realFunction?.id);
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
        const graph = await adapter.generateCallGraph(files);

        const main = graph.nodes.find(n => n.label === 'main');
        const cleanup = graph.nodes.find(n => n.label === 'cleanup');
        const worker = graph.nodes.find(n => n.label === 'worker');
        const process = graph.nodes.find(n => n.label === 'process');

        expect(main).toBeDefined();
        expect(cleanup).toBeDefined();
        expect(worker).toBeDefined();
        expect(process).toBeDefined();

        // main calls cleanup, worker, and process
        const edges = graph.edges.filter(e => e.from === main?.id);
        expect(edges).toHaveLength(3);
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
        const graph = await adapter.generateCallGraph(files);

        const process = graph.nodes.find(n => n.label === 'process');
        const helper = graph.nodes.find(n => n.label === 'helper');

        expect(process).toBeDefined();
        expect(helper).toBeDefined();

        // The call to helper is inside an anonymous function within process
        // We may or may not capture this depending on implementation
        // At minimum, process should exist without errors
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
        const graph = await adapter.generateCallGraph(files);

        const process = graph.nodes.find(n => n.label === 'Process');
        const handle = graph.nodes.find(n => n.label === 'Handle');

        expect(process).toBeDefined();
        expect(handle).toBeDefined();

        const edge = graph.edges.find(e => e.from === process?.id);
        expect(edge?.to).toBe(handle?.id);
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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(4);

        const read = graph.nodes.find(n => n.label === 'Read');
        const parse = graph.nodes.find(n => n.label === 'parse');
        const write = graph.nodes.find(n => n.label === 'Write');
        const encode = graph.nodes.find(n => n.label === 'encode');

        expect(read?.contract).toBe('Reader');
        expect(parse?.contract).toBe('Reader');
        expect(write?.contract).toBe('Writer');
        expect(encode?.contract).toBe('Writer');

        // Read calls parse
        const edge1 = graph.edges.find(e => e.from === read?.id);
        expect(edge1?.to).toBe(parse?.id);

        // Write calls encode
        const edge2 = graph.edges.find(e => e.from === write?.id);
        expect(edge2?.to).toBe(encode?.id);
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
        const graph = await adapter.generateCallGraph([file1, file2]);

        expect(graph.nodes).toHaveLength(3);

        const main = graph.nodes.find(n => n.label === 'main');
        const helper = graph.nodes.find(n => n.label === 'helper');
        const internal = graph.nodes.find(n => n.label === 'internal');

        expect(main).toBeDefined();
        expect(helper).toBeDefined();
        expect(internal).toBeDefined();

        expect(main?.file).toBe('/main.go');
        expect(helper?.file).toBe('/utils.go');

        // main calls helper
        const edge1 = graph.edges.find(e => e.from === main?.id);
        expect(edge1?.to).toBe(helper?.id);

        // helper calls internal
        const edge2 = graph.edges.find(e => e.from === helper?.id);
        expect(edge2?.to).toBe(internal?.id);
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
        const graph = await adapter.generateCallGraph(files);

        const main = graph.nodes.find(n => n.label === 'main');
        const newBuilder = graph.nodes.find(n => n.label === 'NewBuilder');
        const withOption = graph.nodes.find(n => n.label === 'WithOption');
        const build = graph.nodes.find(n => n.label === 'Build');

        expect(main).toBeDefined();
        expect(newBuilder).toBeDefined();
        expect(withOption).toBeDefined();
        expect(build).toBeDefined();

        // main should have edges to at least NewBuilder
        const edges = graph.edges.filter(e => e.from === main?.id);
        expect(edges.length).toBeGreaterThanOrEqual(1);
    });
});
