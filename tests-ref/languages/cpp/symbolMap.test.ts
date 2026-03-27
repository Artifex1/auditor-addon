import { describe, it, expect } from 'vitest';
import { CppAdapter } from '../../../src/languages/cppAdapter.js';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types.js';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

describe('CppAdapter Call Graph', () => {
    const adapter = new CppAdapter();

    it('should generate a call graph for free functions', async () => {
        const code = `
void helper() {}

void main() {
    helper();
}
`;
        const files: FileContent[] = [{ path: '/test.cpp', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);
        const totalCallees = functions.reduce((sum, e) => sum + getCallees(graph, e).length, 0);
        expect(totalCallees).toBe(1);

        const helperEntry = functions.find(e => e.label === 'helper');
        const mainEntry = functions.find(e => e.label === 'main');
        expect(helperEntry).toBeDefined();
        expect(mainEntry).toBeDefined();

        expect(getCallees(graph, mainEntry!)[0].qualifiedName).toBe(helperEntry!.qualifiedName);
    });

    it('should handle class methods with access specifiers', async () => {
        const code = `
class Calculator {
public:
    int add(int a, int b) {
        return helper(a, b);
    }

private:
    int helper(int a, int b) {
        return a + b;
    }
};
`;
        const files: FileContent[] = [{ path: '/test.cpp', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const addEntry = functions.find(e => e.label === 'add');
        const helperEntry = functions.find(e => e.label === 'helper');

        expect(addEntry).toBeDefined();
        expect(helperEntry).toBeDefined();
        expect(addEntry?.visibility).toBe('public');
        expect(helperEntry?.visibility).toBe('private');
        expect(graph.getContainerOf(addEntry!.id)?.label).toBe('Calculator');
        expect(graph.getContainerOf(helperEntry!.id)?.label).toBe('Calculator');

        const callee = getCallees(graph, addEntry!).find(c => c.qualifiedName === helperEntry!.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('cross-class instance method calls produce a gap (type inference not available)', async () => {
        // p.print() where p is a Printer instance — static analysis cannot resolve the
        // receiver type without type inference, so the call becomes a gap edge.
        // This is consistent with how Go (s.Method()), Java (obj.method()), and Rust
        // (val.method()) all behave for cross-container instance calls.
        const code = `
class Printer {
public:
    void print() {}
};

void run() {
    Printer p;
    p.print();
}
`;
        const files: FileContent[] = [{ path: '/test.cpp', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const printEntry = functions.find(e => e.label === 'print');
        const runEntry = functions.find(e => e.label === 'run');
        expect(printEntry).toBeDefined();
        expect(runEntry).toBeDefined();

        // The call resolves to a gap node, not the concrete Printer::print
        const callees = getCallees(graph, runEntry!);
        expect(callees).toHaveLength(1);
        const gapCallee = graph.getNode(graph.getOutEdges(runEntry!.id).find(e => e.kind === 'calls')!.to);
        expect(gapCallee?.status).toBe('gap');
        expect(gapCallee?.qualifiedName).toContain('print');
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/main.cpp',
            content: `
void process();

void main() {
    process();
}
`
        };
        const file2: FileContent = {
            path: '/utils.cpp',
            content: `
void inner() {}

void process() {
    inner();
}
`
        };
        const graph = await adapter.generateGraph([file1, file2]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const mainEntry = functions.find(e => e.label === 'main');
        const processEntry = functions.find(e => e.label === 'process');
        const innerEntry = functions.find(e => e.label === 'inner');

        expect(mainEntry?.locator?.file).toBe('/main.cpp');
        expect(processEntry?.locator?.file).toBe('/utils.cpp');
        expect(innerEntry?.locator?.file).toBe('/utils.cpp');

        const callee1 = getCallees(graph, mainEntry!).find(c => c.qualifiedName === processEntry!.qualifiedName);
        expect(callee1).toBeDefined();

        const callee2 = getCallees(graph, processEntry!).find(c => c.qualifiedName === innerEntry!.qualifiedName);
        expect(callee2).toBeDefined();
    });

    it('should handle out-of-line method definitions', async () => {
        const code = `
class Calculator {
public:
    int add(int a, int b);
private:
    int helper(int a, int b);
};

int Calculator::add(int a, int b) {
    return helper(a, b);
}

int Calculator::helper(int a, int b) {
    return a + b;
}
`;
        const files: FileContent[] = [{ path: '/test.cpp', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        // Only 2 nodes — out-of-line definitions don't duplicate in-class declarations
        expect(functions).toHaveLength(2);

        const addEntry = functions.find(e => e.label === 'add');
        const helperEntry = functions.find(e => e.label === 'helper');

        expect(graph.getContainerOf(addEntry!.id)?.label).toBe('Calculator');
        expect(graph.getContainerOf(helperEntry!.id)?.label).toBe('Calculator');
        // Visibility inherited from in-class declaration
        expect(addEntry?.visibility).toBe('public');
        expect(helperEntry?.visibility).toBe('private');

        const callee = getCallees(graph, addEntry!).find(c => c.qualifiedName === helperEntry!.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should default class visibility to private for unspecified methods', async () => {
        const code = `
class Foo {
    void secret() {}
};
`;
        const files: FileContent[] = [{ path: '/test.cpp', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const secret = functions.find(e => e.label === 'secret');
        expect(secret?.visibility).toBe('private');
    });

    it('should treat free functions as public', async () => {
        const code = `
void publicFn() {}
`;
        const files: FileContent[] = [{ path: '/test.cpp', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const fn = functions.find(e => e.label === 'publicFn');
        expect(fn?.visibility).toBe('public');
    });
});
