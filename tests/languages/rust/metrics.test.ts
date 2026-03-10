import { describe, it, expect } from 'vitest';
import { RustAdapter } from '../../../src/languages/rustAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('RustAdapter Metrics', () => {
    const adapter = new RustAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'main.rs',
            content: `
                fn main() {
                    // Comment
                    if true {
                        println!("Hello");
                    }
                }
            `
        };
        const metrics = await adapter.calculateMetrics([file]);
        expect(metrics[0].nloc).toBeGreaterThan(0);
        expect(metrics[0].linesWithComments).toBe(1);
        expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
    });

    it('should extract signatures from Rust code', async () => {
        const content = `
            pub fn public_function() {}
            fn private_function(x: i32) -> i32 { x }
            pub(crate) fn crate_visible() {}
        `;

        const signaturesByFile = await adapter.extractSignatures([{ path: 'test.rs', content }]);
        const allSignatures = Object.values(signaturesByFile).flat();
        expect(allSignatures.length).toBe(3);
        expect(allSignatures.some(s => s.includes('public_function'))).toBe(true);
        expect(allSignatures.some(s => s.includes('private_function'))).toBe(true);
        expect(allSignatures.some(s => s.includes('crate_visible'))).toBe(true);
    });

    it('should calculate metrics with nested complexity', async () => {
        const content = `fn complex(n: i32) {
    if n > 0 {
        for i in 0..n {
            // comment
        }
    }
}`;
        // Analysis:
        // Total lines: 7
        // Blank lines: 0
        // Comment-only lines: 1 (line 4: "// comment")
        // NLoC = 7 - 0 - 1 = 6
        // Cognitive complexity: if (level 0) = 1, for (level 1) = 1 + 1 = 2, total = 3

        const metrics = await adapter.calculateMetrics([{ path: 'complex.rs', content }]);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].nloc).toBe(6);
        expect(metrics[0].cognitiveComplexity).toBe(3);
        expect(metrics[0].linesWithComments).toBe(1);
    });

    it('should calculate metrics with match expressions', async () => {
        const content = `fn with_match(x: Option<i32>) -> i32 {
    match x {
        Some(v) => v,
        None => 0,
    }
}`;
        // match adds complexity
        const metrics = await adapter.calculateMetrics([{ path: 'match.rs', content }]);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
    });

    it('should produce higher estimated hours for complex undocumented code than simple documented code', async () => {
        const simple = `/// Well documented function
fn simple() -> i32 {
    // just returns a constant
    1
}
`;
        const complex = `fn complex(a: i32, b: i32, c: i32) -> i32 {
    if a > 0 {
        for i in 0..a {
            if b > c {
                if b > a {
                    return i;
                }
            }
        }
    }
    0
}
`;
        const [simpleMetrics, complexMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'simple.rs', content: simple }]),
            adapter.calculateMetrics([{ path: 'complex.rs', content: complex }]),
        ]);

        // Hours must be positive and complex > simple (more code + higher CC + no docs)
        expect(simpleMetrics[0].estimatedHours).toBeGreaterThan(0);
        expect(complexMetrics[0].estimatedHours).toBeGreaterThan(simpleMetrics[0].estimatedHours);
    });

    it('should produce higher estimated hours for larger files, all else equal', async () => {
        const small = `fn foo() -> i32 {
    1
}
`;
        const large = `fn foo() -> i32 {
    1
}

fn bar() -> i32 {
    2
}

fn baz() -> i32 {
    3
}

fn qux() -> i32 {
    4
}

fn quux() -> i32 {
    5
}
`;
        const [smallMetrics, largeMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'small.rs', content: small }]),
            adapter.calculateMetrics([{ path: 'large.rs', content: large }]),
        ]);

        expect(largeMetrics[0].nloc).toBeGreaterThan(smallMetrics[0].nloc);
        expect(largeMetrics[0].estimatedHours).toBeGreaterThan(smallMetrics[0].estimatedHours);
    });
});
