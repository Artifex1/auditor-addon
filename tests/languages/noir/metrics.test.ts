import { describe, it, expect } from 'vitest';
import { NoirAdapter } from '../../../src/languages/noirAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('NoirAdapter Metrics', () => {
    const adapter = new NoirAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'main.nr',
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
fn simple() -> Field {
    // just returns a constant
    1
}
`;
        const complex = `fn complex(a: Field, b: Field, c: Field) -> Field {
    if a as u64 > 0 {
        for i in 0..10 {
            if b as u64 > c as u64 {
                if b as u64 > a as u64 {
                    return i as Field;
                }
            }
        }
    }
    0
}
`;
        const [simpleMetrics, complexMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'simple.nr', content: simple }]),
            adapter.calculateMetrics([{ path: 'complex.nr', content: complex }]),
        ]);

        // Hours must be positive and complex > simple (more code + higher CC + no docs)
        expect(simpleMetrics[0].estimatedHours).toBeGreaterThan(0);
        expect(complexMetrics[0].estimatedHours).toBeGreaterThan(simpleMetrics[0].estimatedHours);
    });

    it('should produce higher estimated hours for larger files, all else equal', async () => {
        const small = `fn foo() -> Field {
    1
}
`;
        const large = `fn foo() -> Field {
    1
}

fn bar() -> Field {
    2
}

fn baz() -> Field {
    3
}

fn qux() -> Field {
    4
}

fn quux() -> Field {
    5
}
`;
        const [smallMetrics, largeMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'small.nr', content: small }]),
            adapter.calculateMetrics([{ path: 'large.nr', content: large }]),
        ]);

        expect(largeMetrics[0].nloc).toBeGreaterThan(smallMetrics[0].nloc);
        expect(largeMetrics[0].estimatedHours).toBeGreaterThan(smallMetrics[0].estimatedHours);
    });
});
