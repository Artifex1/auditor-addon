import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../../../src/languages/javaAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(2);

        const addNode = graph.nodes.find(n => n.label === 'add');
        const helperNode = graph.nodes.find(n => n.label === 'helper');

        expect(addNode).toBeDefined();
        expect(helperNode).toBeDefined();
        expect(addNode?.contract).toBe('Calculator');
        expect(helperNode?.contract).toBe('Calculator');
        expect(addNode?.visibility).toBe('public');
        expect(helperNode?.visibility).toBe('private');

        const edge = graph.edges.find(e => e.from === addNode!.id);
        expect(edge?.to).toBe(helperNode!.id);
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
        const graph = await adapter.generateCallGraph(files);

        expect(graph.nodes).toHaveLength(4);

        const read = graph.nodes.find(n => n.label === 'read');
        const parse = graph.nodes.find(n => n.label === 'parse');
        const write = graph.nodes.find(n => n.label === 'write');
        const encode = graph.nodes.find(n => n.label === 'encode');

        expect(read?.contract).toBe('Reader');
        expect(write?.contract).toBe('Writer');

        expect(graph.edges.find(e => e.from === read!.id && e.to === parse!.id)).toBeDefined();
        expect(graph.edges.find(e => e.from === write!.id && e.to === encode!.id)).toBeDefined();
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
        const graph = await adapter.generateCallGraph(files);

        const pub = graph.nodes.find(n => n.label === 'publicMethod');
        const priv = graph.nodes.find(n => n.label === 'privateMethod');
        const prot = graph.nodes.find(n => n.label === 'protectedMethod');
        const pkg = graph.nodes.find(n => n.label === 'packageMethod');

        expect(pub?.visibility).toBe('public');
        expect(priv?.visibility).toBe('private');
        expect(prot?.visibility).toBe('internal');
        expect(pkg?.visibility).toBe('internal'); // package-private → internal
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
        const graph = await adapter.generateCallGraph([file1, file2]);

        expect(graph.nodes).toHaveLength(4);

        const run = graph.nodes.find(n => n.label === 'run');
        const helper = graph.nodes.find(n => n.label === 'helper' && n.file === '/Main.java');
        const process = graph.nodes.find(n => n.label === 'process');
        const validate = graph.nodes.find(n => n.label === 'validate');

        expect(run?.file).toBe('/Main.java');
        expect(process?.file).toBe('/Util.java');

        expect(graph.edges.find(e => e.from === run!.id && e.to === helper!.id)).toBeDefined();
        expect(graph.edges.find(e => e.from === process!.id && e.to === validate!.id)).toBeDefined();
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
        const graph = await adapter.generateCallGraph(files);

        const ctor = graph.nodes.find(n => n.label === 'Widget');
        const init = graph.nodes.find(n => n.label === 'init');

        expect(ctor).toBeDefined();
        expect(init).toBeDefined();
        expect(ctor?.contract).toBe('Widget');

        const edge = graph.edges.find(e => e.from === ctor!.id);
        expect(edge?.to).toBe(init!.id);
    });
});
