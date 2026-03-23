import { describe, it, expect } from 'vitest';
import { RustAdapter } from '../../../src/languages/rustAdapter';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const newFunc = functions.find(e => e.label === 'new');
        const doSomething = functions.find(e => e.label === 'do_something');
        const helper = functions.find(e => e.label === 'helper');

        expect(newFunc).toBeDefined();
        expect(doSomething).toBeDefined();
        expect(helper).toBeDefined();

        expect(newFunc?.visibility).toBe('public');
        expect(doSomething?.visibility).toBe('public');
        expect(helper?.visibility).toBe('private');

        // do_something calls helper
        const callee = getCallees(graph, doSomething!).find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const newFunc = functions.find(e => e.label === 'new');
        const increment = functions.find(e => e.label === 'increment');
        const add = functions.find(e => e.label === 'add');

        expect(newFunc).toBeDefined();
        expect(increment).toBeDefined();
        expect(add).toBeDefined();

        // increment calls add
        const callee = getCallees(graph, increment!).find(c => c.qualifiedName === add?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const display = functions.find(e => e.label === 'display');
        const formatOutput = functions.find(e => e.label === 'format_output');

        expect(display).toBeDefined();
        expect(formatOutput).toBeDefined();

        // display calls format_output
        const callee = getCallees(graph, display!).find(c => c.qualifiedName === formatOutput?.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle pub visibility', async () => {
        const code = `
            pub fn public_func() {}
            fn private_func() {}
            pub(crate) fn crate_func() {}
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const publicFunc = functions.find(e => e.label === 'public_func');
        const privateFunc = functions.find(e => e.label === 'private_func');
        const crateFunc = functions.find(e => e.label === 'crate_func');

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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const main = functions.find(e => e.label === 'main');
        const helper = functions.find(e => e.label === 'helper');

        expect(main).toBeDefined();
        expect(helper).toBeDefined();

        // main calls utils::helper
        const callee = getCallees(graph, main!).find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const defaultFunc = functions.find(e => e.label === 'default');
        const load = functions.find(e => e.label === 'load');

        expect(defaultFunc).toBeDefined();
        expect(load).toBeDefined();

        // load calls Config::default
        const callee = getCallees(graph, load!).find(c => c.qualifiedName === defaultFunc?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const main = functions.find(e => e.label === 'main');
        const newFunc = functions.find(e => e.label === 'new');
        const withOption = functions.find(e => e.label === 'with_option');
        const build = functions.find(e => e.label === 'build');

        expect(main).toBeDefined();
        expect(newFunc).toBeDefined();
        expect(withOption).toBeDefined();
        expect(build).toBeDefined();

        // main should have edges to new, with_option, and build
        expect(getCallees(graph, main!).length).toBeGreaterThanOrEqual(1);
    });

    it('should attribute nested fn calls to the enclosing method', async () => {
        const code = `
            fn free_func() {}

            struct MyStruct;

            impl MyStruct {
                fn process(&self) {
                    fn helper() {
                        free_func();
                    }
                    self.target();
                }

                fn target(&self) {}
            }
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        // helper is not a node — nested fns are not indexed as struct methods
        expect(functions.find(e => e.label === 'helper')).toBeUndefined();
        expect(functions).toHaveLength(3); // free_func, process, target

        const process = functions.find(e => e.label === 'process');
        const target = functions.find(e => e.label === 'target');
        const freeFunc = functions.find(e => e.label === 'free_func');

        // free_func() call inside helper is attributed to process
        expect(getCallees(graph, process!).find(c => c.qualifiedName === freeFunc?.qualifiedName)).toBeDefined();
        // self.target() call in process is also present
        expect(getCallees(graph, process!).find(c => c.qualifiedName === target?.qualifiedName)).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const process = functions.find(e => e.label === 'process');
        const helper = functions.find(e => e.label === 'helper');

        expect(process).toBeDefined();
        expect(helper).toBeDefined();

        // process should call helper (inside the closure)
        const callee = getCallees(graph, process!).find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const main = functions.find(e => e.label === 'main');
        const realFunction = functions.find(e => e.label === 'real_function');

        expect(main).toBeDefined();
        expect(realFunction).toBeDefined();

        // Should have edge to real_function but not to macros
        const callees = getCallees(graph, main!);
        expect(callees).toHaveLength(1);
        expect(callees[0].qualifiedName).toBe(realFunction?.qualifiedName);
    });

    it('should handle generic functions', async () => {
        const code = `
            fn process<T>(item: T) {
                helper(item);
            }

            fn helper<T>(item: T) {}
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const process = functions.find(e => e.label === 'process');
        const helper = functions.find(e => e.label === 'helper');

        expect(process).toBeDefined();
        expect(helper).toBeDefined();

        const callee = getCallees(graph, process!).find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle async functions', async () => {
        const code = `
            async fn fetch_data() {
                process_data().await;
            }

            async fn process_data() {}
        `;
        const files: FileContent[] = [{ path: '/test.rs', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const fetchData = functions.find(e => e.label === 'fetch_data');
        const processData = functions.find(e => e.label === 'process_data');

        expect(fetchData).toBeDefined();
        expect(processData).toBeDefined();

        const callee = getCallees(graph, fetchData!).find(c => c.qualifiedName === processData?.qualifiedName);
        expect(callee).toBeDefined();
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
        const graph = await adapter.generateGraph([file1, file2]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const main = functions.find(e => e.label === 'main');
        const helper = functions.find(e => e.label === 'helper');
        const internal = functions.find(e => e.label === 'internal');

        expect(main).toBeDefined();
        expect(helper).toBeDefined();
        expect(internal).toBeDefined();

        expect(main?.locator?.file).toBe('/main.rs');
        expect(helper?.locator?.file).toBe('/utils.rs');

        // main calls helper
        const callee1 = getCallees(graph, main!).find(c => c.qualifiedName === helper?.qualifiedName);
        expect(callee1).toBeDefined();

        // helper calls internal
        const callee2 = getCallees(graph, helper!).find(c => c.qualifiedName === internal?.qualifiedName);
        expect(callee2).toBeDefined();
    });
});
