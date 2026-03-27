import { describe, it, expect } from 'vitest';
import { CompactAdapter } from '../../../src/languages/compactAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('CompactAdapter Metrics', () => {
    const adapter = new CompactAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'main.compact',
            content: `
                pragma compact ^0.1.0;
                import "std";

                circuit main() : Uint<32> {
                    // comment
                    if (true) {
                        return 1;
                    } else {
                        return 0;
                    }
                }

                circuit helper() : Boolean {
                    return true;
                }
            `
        };
        const metrics = await adapter.calculateMetrics([file]);
        expect(metrics[0].nloc).toBeGreaterThan(0);
        expect(metrics[0].linesWithComments).toBe(1);
        expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
    });

    it('should produce higher estimated hours for complex undocumented code than simple documented code', async () => {
        const simple = `// Well documented circuit
// This circuit simply returns a constant value
// No branching or looping logic involved
export circuit simple() : Uint<32> {
    // compute a trivial result
    const a: Uint<32> = 1;
    const b: Uint<32> = 2;
    const c: Uint<32> = 3;
    return a + b + c;
}
`;
        const complex = `export circuit complex(a: Uint<32>, b: Uint<32>, c: Uint<32>) : Uint<32> {
    if (a > 0) {
        if (b > c) {
            if (b > a) {
                if (c > 0) {
                    return a;
                }
            }
        }
    }
    return 0;
}
`;
        const [simpleMetrics, complexMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'simple.compact', content: simple }]),
            adapter.calculateMetrics([{ path: 'complex.compact', content: complex }]),
        ]);

        // Hours must be positive and complex > simple (more code + higher CC + no docs)
        expect(simpleMetrics[0].estimatedHours).toBeGreaterThan(0);
        expect(complexMetrics[0].estimatedHours).toBeGreaterThan(simpleMetrics[0].estimatedHours);
    });

    it('should produce higher estimated hours for larger files, all else equal', async () => {
        const small = `export circuit foo() : Uint<32> {
    return 1;
}
`;
        const large = `export circuit foo() : Uint<32> {
    return 1;
}

export circuit bar() : Uint<32> {
    return 2;
}

export circuit baz() : Uint<32> {
    return 3;
}

export circuit qux() : Uint<32> {
    return 4;
}

export circuit quux() : Uint<32> {
    return 5;
}
`;
        const [smallMetrics, largeMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'small.compact', content: small }]),
            adapter.calculateMetrics([{ path: 'large.compact', content: large }]),
        ]);

        expect(largeMetrics[0].nloc).toBeGreaterThan(smallMetrics[0].nloc);
        expect(largeMetrics[0].estimatedHours).toBeGreaterThan(smallMetrics[0].estimatedHours);
    });
});
