import { describe, it, expect } from 'vitest';
import { SolidityAdapter } from '../../src/languages/solidityAdapter.js';
import { RustAdapter } from '../../src/languages/rustAdapter.js';
import { GoAdapter } from '../../src/languages/goAdapter.js';
import { FileContent } from '../../src/engine/types.js';

describe('Extract Signatures With Ranges - Solidity', () => {
    const adapter = new SolidityAdapter();

    it('should extract function signatures with line ranges', async () => {
        const file: FileContent = {
            path: 'test.sol',
            content: `contract Test {
    function foo() public {
        uint x = 1;
    }

    function bar(uint n) external returns (uint) {
        return n * 2;
    }
}`
        };

        const signatures = await adapter.extractSignaturesWithRanges(file);

        expect(signatures).toHaveLength(2);

        expect(signatures[0].signature).toContain('function foo()');
        expect(signatures[0].startLine).toBe(2);
        expect(signatures[0].endLine).toBe(4);

        expect(signatures[1].signature).toContain('function bar(uint n)');
        expect(signatures[1].startLine).toBe(6);
        expect(signatures[1].endLine).toBe(8);
    });

    it('should handle multiple contracts', async () => {
        const file: FileContent = {
            path: 'multi.sol',
            content: `contract A {
    function aFunc() public {}
}

contract B {
    function bFunc() external {}
}`
        };

        const signatures = await adapter.extractSignaturesWithRanges(file);

        expect(signatures).toHaveLength(2);
        expect(signatures[0].signature).toContain('aFunc');
        expect(signatures[1].signature).toContain('bFunc');
    });

    it('should return empty array for files without functions', async () => {
        const file: FileContent = {
            path: 'empty.sol',
            content: `contract Empty {
    uint public value;
}`
        };

        const signatures = await adapter.extractSignaturesWithRanges(file);
        expect(signatures).toHaveLength(0);
    });
});

describe('Extract Signatures With Ranges - Rust', () => {
    const adapter = new RustAdapter();

    it('should extract function signatures with line ranges', async () => {
        const file: FileContent = {
            path: 'lib.rs',
            content: `pub fn hello() {
    println!("hello");
}

fn internal(x: i32) -> i32 {
    x * 2
}`
        };

        const signatures = await adapter.extractSignaturesWithRanges(file);

        expect(signatures).toHaveLength(2);

        expect(signatures[0].signature).toContain('pub fn hello()');
        expect(signatures[0].startLine).toBe(1);
        expect(signatures[0].endLine).toBe(3);

        expect(signatures[1].signature).toContain('fn internal(x: i32)');
        expect(signatures[1].startLine).toBe(5);
        expect(signatures[1].endLine).toBe(7);
    });

    it('should handle impl blocks', async () => {
        const file: FileContent = {
            path: 'struct.rs',
            content: `struct Counter {
    value: i32
}

impl Counter {
    fn new() -> Self {
        Self { value: 0 }
    }

    fn increment(&mut self) {
        self.value += 1;
    }
}`
        };

        const signatures = await adapter.extractSignaturesWithRanges(file);

        expect(signatures.length).toBeGreaterThanOrEqual(2);
        expect(signatures.some(s => s.signature.includes('fn new()'))).toBe(true);
        expect(signatures.some(s => s.signature.includes('fn increment'))).toBe(true);
    });
});

describe('Extract Signatures With Ranges - Go', () => {
    const adapter = new GoAdapter();

    it('should extract function signatures with line ranges', async () => {
        const file: FileContent = {
            path: 'main.go',
            content: `package main

func hello() {
    fmt.Println("hello")
}

func add(a, b int) int {
    return a + b
}`
        };

        const signatures = await adapter.extractSignaturesWithRanges(file);

        expect(signatures).toHaveLength(2);

        expect(signatures[0].signature).toContain('func hello()');
        expect(signatures[0].startLine).toBe(3);
        expect(signatures[0].endLine).toBe(5);

        expect(signatures[1].signature).toContain('func add(a, b int)');
        expect(signatures[1].startLine).toBe(7);
        expect(signatures[1].endLine).toBe(9);
    });

    it('should handle method receivers', async () => {
        const file: FileContent = {
            path: 'counter.go',
            content: `package main

type Counter struct {
    value int
}

func (c *Counter) Increment() {
    c.value++
}

func (c Counter) Value() int {
    return c.value
}`
        };

        const signatures = await adapter.extractSignaturesWithRanges(file);

        expect(signatures.length).toBeGreaterThanOrEqual(2);
        expect(signatures.some(s => s.signature.includes('Increment'))).toBe(true);
        expect(signatures.some(s => s.signature.includes('Value'))).toBe(true);
    });
});

describe('Signature Change Detection Logic', () => {
    const adapter = new SolidityAdapter();

    it('should detect modified function when change falls within range', async () => {
        const file: FileContent = {
            path: 'test.sol',
            content: `contract Test {
    function foo() public {
        uint x = 1;
        uint y = 2;
    }
}`
        };

        const signatures = await adapter.extractSignaturesWithRanges(file);
        const changedLines = [3, 4]; // Lines inside foo()

        // Check if any changed line falls within a function's range
        const modifiedFunctions = signatures.filter(f =>
            changedLines.some(line => line >= f.startLine && line <= f.endLine)
        );

        expect(modifiedFunctions).toHaveLength(1);
        expect(modifiedFunctions[0].signature).toContain('foo');
    });

    it('should not mark function as modified when change is outside its range', async () => {
        const file: FileContent = {
            path: 'test.sol',
            content: `contract Test {
    uint public constant VALUE = 100;

    function foo() public {
        uint x = 1;
    }
}`
        };

        const signatures = await adapter.extractSignaturesWithRanges(file);
        const changedLines = [2]; // Line outside any function

        const modifiedFunctions = signatures.filter(f =>
            changedLines.some(line => line >= f.startLine && line <= f.endLine)
        );

        expect(modifiedFunctions).toHaveLength(0);
    });

    it('should detect signature changes for added/removed functions', async () => {
        // Simulate base version
        const baseFile: FileContent = {
            path: 'test.sol',
            content: `contract Test {
    function foo() public {}
    function bar() public {}
}`
        };

        // Simulate head version (bar removed, baz added)
        const headFile: FileContent = {
            path: 'test.sol',
            content: `contract Test {
    function foo() public {}
    function baz() external {}
}`
        };

        const baseSignatures = await adapter.extractSignaturesWithRanges(baseFile);
        const headSignatures = await adapter.extractSignaturesWithRanges(headFile);

        const baseSet = new Set(baseSignatures.map(f => f.signature));
        const headSet = new Set(headSignatures.map(f => f.signature));

        // Functions only in head = added
        const added = headSignatures.filter(f => !baseSet.has(f.signature));
        // Functions only in base = removed
        const removed = baseSignatures.filter(f => !headSet.has(f.signature));

        expect(added).toHaveLength(1);
        expect(added[0].signature).toContain('baz');

        expect(removed).toHaveLength(1);
        expect(removed[0].signature).toContain('bar');
    });
});
