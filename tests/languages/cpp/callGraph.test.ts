import { describe, it, expect } from 'vitest';
import { CppAdapter } from '../../../src/languages/cppAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);
        expect(graph.edges).toHaveLength(1);

        const helperNode = graph.nodes.find(n => n.label === 'helper');
        const mainNode = graph.nodes.find(n => n.label === 'main');
        expect(helperNode).toBeDefined();
        expect(mainNode).toBeDefined();

        expect(graph.edges[0].from).toBe(mainNode!.id);
        expect(graph.edges[0].to).toBe(helperNode!.id);
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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);

        const addNode = graph.nodes.find(n => n.label === 'add');
        const helperNode = graph.nodes.find(n => n.label === 'helper');

        expect(addNode).toBeDefined();
        expect(helperNode).toBeDefined();
        expect(addNode?.visibility).toBe('public');
        expect(helperNode?.visibility).toBe('private');
        expect(addNode?.contract).toBe('Calculator');
        expect(helperNode?.contract).toBe('Calculator');

        const edge = graph.edges.find(e => e.from === addNode!.id);
        expect(edge?.to).toBe(helperNode!.id);
    });

    it('should detect calls from free functions to class methods', async () => {
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
        const graph = await adapter.generateCallGraph(files);

        const printNode = graph.nodes.find(n => n.label === 'print');
        const runNode = graph.nodes.find(n => n.label === 'run');
        expect(printNode).toBeDefined();
        expect(runNode).toBeDefined();

        const edge = graph.edges.find(e => e.from === runNode!.id);
        expect(edge?.to).toBe(printNode!.id);
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
        const graph = await adapter.generateCallGraph([file1, file2]);

        expect(graph.nodes).toHaveLength(3);

        const mainNode = graph.nodes.find(n => n.label === 'main');
        const processNode = graph.nodes.find(n => n.label === 'process');
        const innerNode = graph.nodes.find(n => n.label === 'inner');

        expect(mainNode?.file).toBe('/main.cpp');
        expect(processNode?.file).toBe('/utils.cpp');
        expect(innerNode?.file).toBe('/utils.cpp');

        const edge1 = graph.edges.find(e => e.from === mainNode!.id);
        expect(edge1?.to).toBe(processNode!.id);

        const edge2 = graph.edges.find(e => e.from === processNode!.id);
        expect(edge2?.to).toBe(innerNode!.id);
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
        const graph = await adapter.generateCallGraph(files);

        // Only 2 nodes — out-of-line definitions don't duplicate in-class declarations
        expect(graph.nodes).toHaveLength(2);

        const addNode = graph.nodes.find(n => n.label === 'add');
        const helperNode = graph.nodes.find(n => n.label === 'helper');

        expect(addNode?.contract).toBe('Calculator');
        expect(helperNode?.contract).toBe('Calculator');
        // Visibility inherited from in-class declaration
        expect(addNode?.visibility).toBe('public');
        expect(helperNode?.visibility).toBe('private');

        const edge = graph.edges.find(e => e.from === addNode!.id);
        expect(edge?.to).toBe(helperNode!.id);
    });

    it('should default class visibility to private for unspecified methods', async () => {
        const code = `
class Foo {
    void secret() {}
};
`;
        const files: FileContent[] = [{ path: '/test.cpp', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const secret = graph.nodes.find(n => n.label === 'secret');
        expect(secret?.visibility).toBe('private');
    });

    it('should treat free functions as public', async () => {
        const code = `
void publicFn() {}
`;
        const files: FileContent[] = [{ path: '/test.cpp', content: code }];
        const graph = await adapter.generateCallGraph(files);

        const fn = graph.nodes.find(n => n.label === 'publicFn');
        expect(fn?.visibility).toBe('public');
    });
});
