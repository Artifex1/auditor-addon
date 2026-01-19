import { describe, it, expect } from 'vitest';
import { SolidityAdapter } from '../../src/languages/solidityAdapter.js';
import { RustAdapter } from '../../src/languages/rustAdapter.js';
import { GoAdapter } from '../../src/languages/goAdapter.js';
import { FileContent } from '../../src/engine/types.js';

describe('Diff Metrics - Solidity', () => {
    const adapter = new SolidityAdapter();

    it('should calculate metrics for added lines in a simple function', async () => {
        const file: FileContent = {
            path: 'test.sol',
            content: `contract Test {
    function simple() public {
        uint x = 1;
        uint y = 2;
    }
}`
        };

        // Simulate adding lines 3-4 (the function body)
        const addedLines = [3, 4];
        const removedLines: number[] = [];

        const metrics = await adapter.calculateDiffMetrics(file, addedLines, removedLines, 'modified');

        expect(metrics.file).toBe('test.sol');
        expect(metrics.status).toBe('modified');
        expect(metrics.addedLines).toBe(2);
        expect(metrics.removedLines).toBe(0);
        expect(metrics.diffNloc).toBe(2);
        expect(metrics.diffComplexity).toBe(0); // No nesting
        expect(metrics.estimatedHours).toBeGreaterThan(0);
    });

    it('should calculate higher complexity for nested changes', async () => {
        const file: FileContent = {
            path: 'test.sol',
            content: `contract Test {
    function complex(uint n) public {
        if (n > 0) {
            for (uint i = 0; i < n; i++) {
                uint x = i;
            }
        }
    }
}`
        };

        // Adding line inside the for loop (nesting depth = 2)
        const addedLinesDeep = [5]; // "uint x = i;"
        const metrics1 = await adapter.calculateDiffMetrics(file, addedLinesDeep, [], 'modified');

        // Adding line at function level (nesting depth = 0)
        const fileSimple: FileContent = {
            path: 'test2.sol',
            content: `contract Test {
    function simple() public {
        uint x = 1;
    }
}`
        };
        const addedLinesShallow = [3]; // "uint x = 1;"
        const metrics2 = await adapter.calculateDiffMetrics(fileSimple, addedLinesShallow, [], 'modified');

        // Deep nesting should have higher complexity
        expect(metrics1.diffComplexity).toBeGreaterThan(metrics2.diffComplexity);
    });

    it('should return zero metrics for deleted files', async () => {
        const file: FileContent = {
            path: 'deleted.sol',
            content: ''
        };

        const removedLines = [1, 2, 3, 4, 5];
        const metrics = await adapter.calculateDiffMetrics(file, [], removedLines, 'deleted');

        expect(metrics.status).toBe('deleted');
        expect(metrics.diffNloc).toBe(0);
        expect(metrics.diffComplexity).toBe(0);
        expect(metrics.estimatedHours).toBe(0);
        expect(metrics.removedLines).toBe(5);
    });

    it('should handle added files', async () => {
        const file: FileContent = {
            path: 'new.sol',
            content: `contract New {
    function foo() public {
        uint x = 1;
    }
}`
        };

        const addedLines = [1, 2, 3, 4, 5];
        const metrics = await adapter.calculateDiffMetrics(file, addedLines, [], 'added');

        expect(metrics.status).toBe('added');
        expect(metrics.addedLines).toBe(5);
        expect(metrics.diffNloc).toBeGreaterThan(0);
    });

    it('should exclude comment-only lines from diffNloc', async () => {
        const file: FileContent = {
            path: 'test.sol',
            content: `contract Test {
    function foo() public {
        // This is a comment
        uint x = 1;
    }
}`
        };

        // Adding comment and code
        const addedLines = [3, 4]; // comment and code
        const metrics = await adapter.calculateDiffMetrics(file, addedLines, [], 'modified');

        // Comment should be excluded from NLoC
        expect(metrics.diffNloc).toBe(1);
        expect(metrics.addedLines).toBe(2);
    });

    it('should exclude blank lines from diffNloc', async () => {
        const file: FileContent = {
            path: 'test.sol',
            content: `contract Test {
    function foo() public {

        uint x = 1;
    }
}`
        };

        // Adding blank line and code
        const addedLines = [3, 4]; // blank and code
        const metrics = await adapter.calculateDiffMetrics(file, addedLines, [], 'modified');

        // Blank line should be excluded from NLoC
        expect(metrics.diffNloc).toBe(1);
    });
});

describe('Diff Metrics - Rust', () => {
    const adapter = new RustAdapter();

    it('should calculate complexity for nested match arms', async () => {
        const file: FileContent = {
            path: 'test.rs',
            content: `fn process(x: Option<i32>) -> i32 {
    match x {
        Some(v) => {
            if v > 0 {
                v * 2
            } else {
                0
            }
        }
        None => 0,
    }
}`
        };

        // Adding line inside nested if (depth = 2: match + if)
        const addedLines = [5]; // "v * 2"
        const metrics = await adapter.calculateDiffMetrics(file, addedLines, [], 'modified');

        expect(metrics.diffComplexity).toBeGreaterThan(0);
    });

    it('should handle function additions', async () => {
        const file: FileContent = {
            path: 'lib.rs',
            content: `pub fn helper() {
    println!("helper");
}

fn internal() {
    helper();
}`
        };

        const addedLines = [1, 2, 3, 4, 5, 6];
        const metrics = await adapter.calculateDiffMetrics(file, addedLines, [], 'added');

        expect(metrics.status).toBe('added');
        expect(metrics.diffNloc).toBeGreaterThan(0);
    });
});

describe('Diff Metrics - Go', () => {
    const adapter = new GoAdapter();

    it('should calculate complexity for nested control structures', async () => {
        const file: FileContent = {
            path: 'main.go',
            content: `package main

func process(items []int) {
    for _, item := range items {
        if item > 0 {
            fmt.Println(item)
        }
    }
}`
        };

        // Adding line inside for+if (depth = 2)
        const addedLines = [6]; // "fmt.Println(item)"
        const metrics = await adapter.calculateDiffMetrics(file, addedLines, [], 'modified');

        expect(metrics.diffComplexity).toBeGreaterThan(0);
    });

    it('should handle switch statement nesting', async () => {
        const file: FileContent = {
            path: 'main.go',
            content: `package main

func handle(x int) {
    switch x {
    case 1:
        fmt.Println("one")
    case 2:
        fmt.Println("two")
    }
}`
        };

        // Adding line inside switch case (depth = 1)
        const addedLines = [6]; // "fmt.Println("one")"
        const metrics = await adapter.calculateDiffMetrics(file, addedLines, [], 'modified');

        expect(metrics.diffComplexity).toBeGreaterThan(0);
    });
});

describe('Diff Metrics - Estimation', () => {
    const adapter = new SolidityAdapter();

    it('should estimate more hours for more complex diffs', async () => {
        // Simple diff - few lines, no nesting
        const simpleFile: FileContent = {
            path: 'simple.sol',
            content: `contract Simple {
    function foo() public {
        uint x = 1;
        uint y = 2;
        uint z = 3;
    }
}`
        };
        const simpleMetrics = await adapter.calculateDiffMetrics(
            simpleFile,
            [3, 4, 5],
            [],
            'modified'
        );

        // Complex diff - deeply nested
        const complexFile: FileContent = {
            path: 'complex.sol',
            content: `contract Complex {
    function bar(uint n) public {
        if (n > 0) {
            for (uint i = 0; i < n; i++) {
                if (i % 2 == 0) {
                    uint x = i;
                    uint y = i * 2;
                    uint z = i * 3;
                }
            }
        }
    }
}`
        };
        const complexMetrics = await adapter.calculateDiffMetrics(
            complexFile,
            [6, 7, 8], // Lines deep in nesting
            [],
            'modified'
        );

        // Same number of lines, but complex should take more time due to nesting
        expect(complexMetrics.diffComplexity).toBeGreaterThan(simpleMetrics.diffComplexity);
    });
});
