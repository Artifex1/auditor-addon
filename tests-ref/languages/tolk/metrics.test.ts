import { describe, it, expect } from 'vitest';
import { TolkAdapter } from '../../../src/languages/tolkAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('TolkAdapter Metrics', () => {
    const adapter = new TolkAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'main.tolk',
            content: `
                fun main() {
                    // comment
                    if (true) {
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
        const simple = `// Well documented function
fun simple(): int {
    // just returns a constant
    return 1;
}
`;
        const complex = `fun complex(a: int, b: int, c: int): int {
    if (a > 0) {
        var i: int = 0;
        while (i < a) {
            if (b > c) {
                if (b > a) {
                    return i;
                }
            }
            i = i + 1;
        }
    }
    return 0;
}
`;
        const [simpleMetrics, complexMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'simple.tolk', content: simple }]),
            adapter.calculateMetrics([{ path: 'complex.tolk', content: complex }]),
        ]);

        // Hours must be positive and complex > simple (more code + higher CC + no docs)
        expect(simpleMetrics[0].estimatedHours).toBeGreaterThan(0);
        expect(complexMetrics[0].estimatedHours).toBeGreaterThan(simpleMetrics[0].estimatedHours);
    });

    it('should produce higher estimated hours for larger files, all else equal', async () => {
        const small = `fun foo(): int {
    return 1;
}
`;
        const large = `fun foo(): int {
    return 1;
}

fun bar(): int {
    return 2;
}

fun baz(): int {
    return 3;
}

fun qux(): int {
    return 4;
}

fun quux(): int {
    return 5;
}
`;
        const [smallMetrics, largeMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'small.tolk', content: small }]),
            adapter.calculateMetrics([{ path: 'large.tolk', content: large }]),
        ]);

        expect(largeMetrics[0].nloc).toBeGreaterThan(smallMetrics[0].nloc);
        expect(largeMetrics[0].estimatedHours).toBeGreaterThan(smallMetrics[0].estimatedHours);
    });
});
