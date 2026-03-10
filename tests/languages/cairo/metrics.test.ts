import { describe, it, expect } from 'vitest';
import { CairoAdapter } from '../../../src/languages/cairoAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('CairoAdapter Metrics', () => {
    const adapter = new CairoAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'main.cairo',
            content: `
                fn main() {
                    // comment
                    if true {
                        let x = 1;
                    }
                }
            `
        };
        const metrics = await adapter.calculateMetrics([file]);
        expect(metrics[0].nloc).toBeGreaterThan(0);
        expect(metrics[0].linesWithComments).toBe(1);
        expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
    });

    it('should produce higher estimated hours for complex undocumented code than simple documented code', async () => {
        const simple = `/// Well documented function
fn simple() -> u32 {
    // just returns a constant
    1
}
`;
        const complex = `fn complex(a: u32, b: u32, c: u32) -> u32 {
    if a > 0 {
        let mut i: u32 = 0;
        loop {
            if i >= a {
                break;
            }
            if b > c {
                if b > a {
                    return i;
                }
            }
            i += 1;
        }
    }
    0
}
`;
        const [simpleMetrics, complexMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'simple.cairo', content: simple }]),
            adapter.calculateMetrics([{ path: 'complex.cairo', content: complex }]),
        ]);

        // Hours must be positive and complex > simple (more code + higher CC + no docs)
        expect(simpleMetrics[0].estimatedHours).toBeGreaterThan(0);
        expect(complexMetrics[0].estimatedHours).toBeGreaterThan(simpleMetrics[0].estimatedHours);
    });

    it('should produce higher estimated hours for larger files, all else equal', async () => {
        const small = `fn foo() -> u32 {
    1
}
`;
        const large = `fn foo() -> u32 {
    1
}

fn bar() -> u32 {
    2
}

fn baz() -> u32 {
    3
}

fn qux() -> u32 {
    4
}

fn quux() -> u32 {
    5
}
`;
        const [smallMetrics, largeMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'small.cairo', content: small }]),
            adapter.calculateMetrics([{ path: 'large.cairo', content: large }]),
        ]);

        expect(largeMetrics[0].nloc).toBeGreaterThan(smallMetrics[0].nloc);
        expect(largeMetrics[0].estimatedHours).toBeGreaterThan(smallMetrics[0].estimatedHours);
    });
});
