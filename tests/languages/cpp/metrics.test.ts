import { describe, it, expect } from 'vitest';
import { CppAdapter } from '../../../src/languages/cppAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('CppAdapter Metrics', () => {
    const adapter = new CppAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'test.cpp',
            content: `
                #include <iostream>

                // This is a comment
                void main() {
                    if (true) {
                        std::cout << "Hello";
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
int simple() {
    // just returns a constant
    return 1;
}
`;
        const complex = `int complex(int a, int b, int c) {
    if (a > 0) {
        for (int i = 0; i < a; i++) {
            if (b > c) {
                if (b > a) {
                    return i;
                }
            }
        }
    }
    return 0;
}
`;
        const [simpleMetrics, complexMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'simple.cpp', content: simple }]),
            adapter.calculateMetrics([{ path: 'complex.cpp', content: complex }]),
        ]);

        // Hours must be positive and complex > simple (more code + higher CC + no docs)
        expect(simpleMetrics[0].estimatedHours).toBeGreaterThan(0);
        expect(complexMetrics[0].estimatedHours).toBeGreaterThan(simpleMetrics[0].estimatedHours);
    });

    it('should produce higher estimated hours for larger files, all else equal', async () => {
        const small = `int foo() {
    return 1;
}
`;
        const large = `int foo() {
    return 1;
}

int bar() {
    return 2;
}

int baz() {
    return 3;
}

int qux() {
    return 4;
}

int quux() {
    return 5;
}
`;
        const [smallMetrics, largeMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'small.cpp', content: small }]),
            adapter.calculateMetrics([{ path: 'large.cpp', content: large }]),
        ]);

        expect(largeMetrics[0].nloc).toBeGreaterThan(smallMetrics[0].nloc);
        expect(largeMetrics[0].estimatedHours).toBeGreaterThan(smallMetrics[0].estimatedHours);
    });
});
