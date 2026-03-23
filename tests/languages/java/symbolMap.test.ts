import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../../../src/languages/javaAdapter.js';
import { FileContent, SymbolGraph, GraphNode } from '../../../src/engine/types.js';

function getCallees(graph: SymbolGraph, node: GraphNode) {
    return graph.getOutEdges(node.id)
        .filter(e => e.kind === 'calls')
        .map(e => ({ qualifiedName: graph.getNode(e.to)?.qualifiedName ?? 'unknown', targetKind: (e.attrs as any)?.targetKind }));
}

describe('JavaAdapter Call Graph', () => {
    const adapter = new JavaAdapter();

    it('should generate a call graph for class methods', async () => {
        const code = `
public class Calculator {
    public int add(int a, int b) {
        return helper(a, b);
    }

    private int helper(int a, int b) {
        return a + b;
    }
}
`;
        const files: FileContent[] = [{ path: '/Calculator.java', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const addEntry = functions.find(e => e.label === 'add');
        const helperEntry = functions.find(e => e.label === 'helper');

        expect(addEntry).toBeDefined();
        expect(helperEntry).toBeDefined();
        expect(graph.getContainerOf(addEntry!.id)?.label).toBe('Calculator');
        expect(graph.getContainerOf(helperEntry!.id)?.label).toBe('Calculator');
        expect(addEntry?.visibility).toBe('public');
        expect(helperEntry?.visibility).toBe('private');

        const callee = getCallees(graph, addEntry!).find(c => c.qualifiedName === helperEntry!.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should handle multiple classes', async () => {
        const code = `
public class Reader {
    public void read() { parse(); }
    private void parse() {}
}

public class Writer {
    public void write() { encode(); }
    private void encode() {}
}
`;
        const files: FileContent[] = [{ path: '/test.java', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(4);

        const read = functions.find(e => e.label === 'read');
        const parse = functions.find(e => e.label === 'parse');
        const write = functions.find(e => e.label === 'write');
        const encode = functions.find(e => e.label === 'encode');

        expect(graph.getContainerOf(read!.id)?.label).toBe('Reader');
        expect(graph.getContainerOf(write!.id)?.label).toBe('Writer');

        expect(getCallees(graph, read!).find(c => c.qualifiedName === parse!.qualifiedName)).toBeDefined();
        expect(getCallees(graph, write!).find(c => c.qualifiedName === encode!.qualifiedName)).toBeDefined();
    });

    it('should handle visibility modifiers', async () => {
        const code = `
public class Service {
    public void publicMethod() {}
    private void privateMethod() {}
    protected void protectedMethod() {}
    void packageMethod() {}
}
`;
        const files: FileContent[] = [{ path: '/Service.java', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const pub = functions.find(e => e.label === 'publicMethod');
        const priv = functions.find(e => e.label === 'privateMethod');
        const prot = functions.find(e => e.label === 'protectedMethod');
        const pkg = functions.find(e => e.label === 'packageMethod');

        expect(pub?.visibility).toBe('public');
        expect(priv?.visibility).toBe('private');
        expect(prot?.visibility).toBe('internal');
        expect(pkg?.visibility).toBe('internal'); // package-private -> internal
    });

    it('should handle multiple files', async () => {
        const file1: FileContent = {
            path: '/Main.java',
            content: `
public class Main {
    public void run() { helper(); }
    private void helper() {}
}
`
        };
        const file2: FileContent = {
            path: '/Util.java',
            content: `
public class Util {
    public void process() { validate(); }
    private void validate() {}
}
`
        };
        const graph = await adapter.generateGraph([file1, file2]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(4);

        const run = functions.find(e => e.label === 'run');
        const helper = functions.find(e => e.label === 'helper' && e.locator?.file === '/Main.java');
        const process = functions.find(e => e.label === 'process');
        const validate = functions.find(e => e.label === 'validate');

        expect(run?.locator?.file).toBe('/Main.java');
        expect(process?.locator?.file).toBe('/Util.java');

        expect(getCallees(graph, run!).find(c => c.qualifiedName === helper!.qualifiedName)).toBeDefined();
        expect(getCallees(graph, process!).find(c => c.qualifiedName === validate!.qualifiedName)).toBeDefined();
    });

    it('should handle constructor declarations', async () => {
        const code = `
public class Widget {
    private int value;

    public Widget(int v) {
        init(v);
    }

    private void init(int v) {
        this.value = v;
    }
}
`;
        const files: FileContent[] = [{ path: '/Widget.java', content: code }];
        const graph = await adapter.generateGraph(files);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');

        const ctor = functions.find(e => e.label === 'Widget');
        const init = functions.find(e => e.label === 'init');

        expect(ctor).toBeDefined();
        expect(init).toBeDefined();
        expect(graph.getContainerOf(ctor!.id)?.label).toBe('Widget');

        const callee = getCallees(graph, ctor!).find(c => c.qualifiedName === init!.qualifiedName);
        expect(callee).toBeDefined();
    });
});
