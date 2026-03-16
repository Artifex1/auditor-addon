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
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);
        const totalCallees = functions.reduce((sum, e) => sum + e.callees.length, 0);
        expect(totalCallees).toBe(1);

        const helperEntry = functions.find(e => e.label === 'helper');
        const mainEntry = functions.find(e => e.label === 'main');
        expect(helperEntry).toBeDefined();
        expect(mainEntry).toBeDefined();

        expect(mainEntry!.callees[0].qualifiedName).toBe(helperEntry!.qualifiedName);
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
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(2);

        const addEntry = functions.find(e => e.label === 'add');
        const helperEntry = functions.find(e => e.label === 'helper');

        expect(addEntry).toBeDefined();
        expect(helperEntry).toBeDefined();
        expect(addEntry?.visibility).toBe('public');
        expect(helperEntry?.visibility).toBe('private');
        expect(addEntry?.contract).toBe('Calculator');
        expect(helperEntry?.contract).toBe('Calculator');

        const callee = addEntry!.callees.find(c => c.qualifiedName === helperEntry!.qualifiedName);
        expect(callee).toBeDefined();
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
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        const printEntry = functions.find(e => e.label === 'print');
        const runEntry = functions.find(e => e.label === 'run');
        expect(printEntry).toBeDefined();
        expect(runEntry).toBeDefined();

        const callee = runEntry!.callees.find(c => c.qualifiedName === printEntry!.qualifiedName);
        expect(callee).toBeDefined();
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
        const symbolMap = await adapter.generateSymbolMap([file1, file2]);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        expect(functions).toHaveLength(3);

        const mainEntry = functions.find(e => e.label === 'main');
        const processEntry = functions.find(e => e.label === 'process');
        const innerEntry = functions.find(e => e.label === 'inner');

        expect(mainEntry?.file).toBe('/main.cpp');
        expect(processEntry?.file).toBe('/utils.cpp');
        expect(innerEntry?.file).toBe('/utils.cpp');

        const callee1 = mainEntry!.callees.find(c => c.qualifiedName === processEntry!.qualifiedName);
        expect(callee1).toBeDefined();

        const callee2 = processEntry!.callees.find(c => c.qualifiedName === innerEntry!.qualifiedName);
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
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        // Only 2 nodes — out-of-line definitions don't duplicate in-class declarations
        expect(functions).toHaveLength(2);

        const addEntry = functions.find(e => e.label === 'add');
        const helperEntry = functions.find(e => e.label === 'helper');

        expect(addEntry?.contract).toBe('Calculator');
        expect(helperEntry?.contract).toBe('Calculator');
        // Visibility inherited from in-class declaration
        expect(addEntry?.visibility).toBe('public');
        expect(helperEntry?.visibility).toBe('private');

        const callee = addEntry!.callees.find(c => c.qualifiedName === helperEntry!.qualifiedName);
        expect(callee).toBeDefined();
    });

    it('should default class visibility to private for unspecified methods', async () => {
        const code = `
class Foo {
    void secret() {}
};
`;
        const files: FileContent[] = [{ path: '/test.cpp', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        const secret = functions.find(e => e.label === 'secret');
        expect(secret?.visibility).toBe('private');
    });

    it('should treat free functions as public', async () => {
        const code = `
void publicFn() {}
`;
        const files: FileContent[] = [{ path: '/test.cpp', content: code }];
        const symbolMap = await adapter.generateSymbolMap(files);
        const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

        const fn = functions.find(e => e.label === 'publicFn');
        expect(fn?.visibility).toBe('public');
    });
});
