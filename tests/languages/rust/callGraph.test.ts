import { describe, it, expect } from 'vitest';
import { RustAdapter } from '../../../src/languages/rustAdapter';
import { FileContent } from '../../../src/engine/types';

describe('RustAdapter Call Graph', () => {
    const adapter = new RustAdapter();

    it('should generate a simple call graph for free functions', async () => {
        const code = `
            fn a() {
                b();
            }
            fn b() {}
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
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

    it('should handle impl block methods', async () => {
        const code = `
            struct MyStruct;

            impl MyStruct {
                pub fn new() -> Self {
                    Self
                }

                pub fn do_something(&self) {
                    self.helper();
                }

                fn helper(&self) {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(3);

        const newFunc = graph.nodes.find(n => n.label === 'new');
        const doSomething = graph.nodes.find(n => n.label === 'do_something');
        const helper = graph.nodes.find(n => n.label === 'helper');

        expect(newFunc).toBeDefined();
        expect(doSomething).toBeDefined();
        expect(helper).toBeDefined();

        expect(newFunc?.visibility).toBe('public');
        expect(doSomething?.visibility).toBe('public');
        expect(helper?.visibility).toBe('private');

        // do_something calls helper
        const edge = graph.edges.find(e => e.from === doSomething?.id);
        expect(edge?.to).toBe(helper?.id);
    });

    it('should handle multiple impl blocks for same type', async () => {
        const code = `
            struct Counter {
                value: i32,
            }

            impl Counter {
                pub fn new() -> Self {
                    Counter { value: 0 }
                }
            }

            impl Counter {
                pub fn increment(&mut self) {
                    self.add(1);
                }

                fn add(&mut self, n: i32) {
                    self.value += n;
                }
            }
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(3);

        const newFunc = graph.nodes.find(n => n.label === 'new');
        const increment = graph.nodes.find(n => n.label === 'increment');
        const add = graph.nodes.find(n => n.label === 'add');

        expect(newFunc).toBeDefined();
        expect(increment).toBeDefined();
        expect(add).toBeDefined();

        // increment calls add
        const edge = graph.edges.find(e => e.from === increment?.id);
        expect(edge?.to).toBe(add?.id);
    });

    it('should handle trait impl methods', async () => {
        const code = `
            trait Display {
                fn display(&self);
            }

            struct Point {
                x: i32,
                y: i32,
            }

            impl Display for Point {
                fn display(&self) {
                    self.format_output();
                }
            }

            impl Point {
                fn format_output(&self) {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const display = graph.nodes.find(n => n.label === 'display');
        const formatOutput = graph.nodes.find(n => n.label === 'format_output');

        expect(display).toBeDefined();
        expect(formatOutput).toBeDefined();

        // display calls format_output
        const edge = graph.edges.find(e => e.from === display?.id);
        expect(edge?.to).toBe(formatOutput?.id);
    });

    it('should handle pub visibility', async () => {
        const code = `
            pub fn public_func() {}
            fn private_func() {}
            pub(crate) fn crate_func() {}
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(3);

        const publicFunc = graph.nodes.find(n => n.label === 'public_func');
        const privateFunc = graph.nodes.find(n => n.label === 'private_func');
        const crateFunc = graph.nodes.find(n => n.label === 'crate_func');

        expect(publicFunc?.visibility).toBe('public');
        expect(privateFunc?.visibility).toBe('private');
        expect(crateFunc?.visibility).toBe('internal');
    });

    it('should handle qualified function calls', async () => {
        const code = `
            mod utils {
                pub fn helper() {}
            }

            fn main() {
                utils::helper();
            }
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const main = graph.nodes.find(n => n.label === 'main');
        const helper = graph.nodes.find(n => n.label === 'helper');

        expect(main).toBeDefined();
        expect(helper).toBeDefined();

        // main calls utils::helper
        const edge = graph.edges.find(e => e.from === main?.id);
        expect(edge?.to).toBe(helper?.id);
    });

    it('should handle associated function calls', async () => {
        const code = `
            struct Config;

            impl Config {
                pub fn default() -> Self {
                    Config
                }

                pub fn load() -> Self {
                    Config::default()
                }
            }
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const defaultFunc = graph.nodes.find(n => n.label === 'default');
        const load = graph.nodes.find(n => n.label === 'load');

        expect(defaultFunc).toBeDefined();
        expect(load).toBeDefined();

        // load calls Config::default
        const edge = graph.edges.find(e => e.from === load?.id);
        expect(edge?.to).toBe(defaultFunc?.id);
    });

    it('should handle chained method calls', async () => {
        const code = `
            struct Builder;

            impl Builder {
                pub fn new() -> Self {
                    Builder
                }

                pub fn with_option(self) -> Self {
                    self
                }

                pub fn build(self) {}
            }

            fn main() {
                Builder::new().with_option().build();
            }
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const main = graph.nodes.find(n => n.label === 'main');
        const newFunc = graph.nodes.find(n => n.label === 'new');
        const withOption = graph.nodes.find(n => n.label === 'with_option');
        const build = graph.nodes.find(n => n.label === 'build');

        expect(main).toBeDefined();
        expect(newFunc).toBeDefined();
        expect(withOption).toBeDefined();
        expect(build).toBeDefined();

        // main should have edges to new, with_option, and build
        const edges = graph.edges.filter(e => e.from === main?.id);
        expect(edges.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle closure-containing functions', async () => {
        const code = `
            fn process() {
                let items = vec![1, 2, 3];
                items.iter().map(|x| helper(*x)).collect::<Vec<_>>();
            }

            fn helper(x: i32) -> i32 {
                x * 2
            }
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const process = graph.nodes.find(n => n.label === 'process');
        const helper = graph.nodes.find(n => n.label === 'helper');

        expect(process).toBeDefined();
        expect(helper).toBeDefined();

        // process should call helper (inside the closure)
        const edge = graph.edges.find(e => e.from === process?.id && e.to === helper?.id);
        expect(edge).toBeDefined();
    });

    it('should skip macro calls', async () => {
        const code = `
            fn main() {
                println!("Hello");
                vec![1, 2, 3];
                real_function();
            }

            fn real_function() {}
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const main = graph.nodes.find(n => n.label === 'main');
        const realFunction = graph.nodes.find(n => n.label === 'real_function');

        expect(main).toBeDefined();
        expect(realFunction).toBeDefined();

        // Should have edge to real_function but not to macros
        const edges = graph.edges.filter(e => e.from === main?.id);
        expect(edges).toHaveLength(1);
        expect(edges[0].to).toBe(realFunction?.id);
    });

    it('should handle generic functions', async () => {
        const code = `
            fn process<T>(item: T) {
                helper(item);
            }

            fn helper<T>(item: T) {}
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const process = graph.nodes.find(n => n.label === 'process');
        const helper = graph.nodes.find(n => n.label === 'helper');

        expect(process).toBeDefined();
        expect(helper).toBeDefined();

        const edge = graph.edges.find(e => e.from === process?.id);
        expect(edge?.to).toBe(helper?.id);
    });

    it('should handle async functions', async () => {
        const code = `
            async fn fetch_data() {
                process_data().await;
            }

            async fn process_data() {}
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const fetchData = graph.nodes.find(n => n.label === 'fetch_data');
        const processData = graph.nodes.find(n => n.label === 'process_data');

        expect(fetchData).toBeDefined();
        expect(processData).toBeDefined();

        const edge = graph.edges.find(e => e.from === fetchData?.id);
        expect(edge?.to).toBe(processData?.id);
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.rs',
            content: `
                fn main() {
                    helper();
                }
            `
        };
        const file2: FileContent = {
            path: '/utils.rs',
            content: `
                pub fn helper() {
                    internal();
                }

                fn internal() {}
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

        expect(main?.file).toBe('/main.rs');
        expect(helper?.file).toBe('/utils.rs');

        // main calls helper
        const edge1 = graph.edges.find(e => e.from === main?.id);
        expect(edge1?.to).toBe(helper?.id);

        // helper calls internal
        const edge2 = graph.edges.find(e => e.from === helper?.id);
        expect(edge2?.to).toBe(internal?.id);
    });
});
