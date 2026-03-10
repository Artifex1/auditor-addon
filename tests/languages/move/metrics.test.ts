import { describe, it, expect } from 'vitest';
import { MoveAdapter } from '../../../src/languages/moveAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('MoveAdapter Metrics', () => {
    const adapter = new MoveAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'main.move',
            content: `
                module 0x1::M {
                    fun main() {
                        // comment
                        if (true) {
                            let x = 1;
                        };
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
        const simple = `module 0x1::Simple {
    /// Well documented function
    fun simple(): u64 {
        // just returns a constant
        1
    }
}
`;
        const complex = `module 0x1::Complex {
    fun complex(a: u64, b: u64, c: u64): u64 {
        if (a > 0) {
            if (b > c) {
                if (b > a) {
                    if (c > 0) {
                        return a
                    };
                };
            };
        };
        0
    }
}
`;
        const [simpleMetrics, complexMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'simple.move', content: simple }]),
            adapter.calculateMetrics([{ path: 'complex.move', content: complex }]),
        ]);

        // Hours must be positive and complex > simple (more code + higher CC + no docs)
        expect(simpleMetrics[0].estimatedHours).toBeGreaterThan(0);
        expect(complexMetrics[0].estimatedHours).toBeGreaterThan(simpleMetrics[0].estimatedHours);
    });

    it('should produce higher estimated hours for larger files, all else equal', async () => {
        const small = `module 0x1::Small {
    fun foo(): u64 { 1 }
}
`;
        const large = `module 0x1::Large {
    fun foo(): u64 { 1 }
    fun bar(): u64 { 2 }
    fun baz(): u64 { 3 }
    fun qux(): u64 { 4 }
    fun quux(): u64 { 5 }
}
`;
        const [smallMetrics, largeMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'small.move', content: small }]),
            adapter.calculateMetrics([{ path: 'large.move', content: large }]),
        ]);

        expect(largeMetrics[0].nloc).toBeGreaterThan(smallMetrics[0].nloc);
        expect(largeMetrics[0].estimatedHours).toBeGreaterThan(smallMetrics[0].estimatedHours);
    });
});
