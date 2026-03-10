import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../../../src/languages/javaAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('JavaAdapter Metrics', () => {
    const adapter = new JavaAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'Test.java',
            content: `
                public class Test {
                    /* Block comment */
                    public void main() {
                        for (int i=0; i<10; i++) {
                            System.out.println(i);
                        }
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
        const simple = `public class Simple {
    /** Well documented method */
    public int simple() {
        // just returns a constant
        return 1;
    }
}
`;
        const complex = `public class Complex {
    public int complex(int a, int b, int c) {
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
}
`;
        const [simpleMetrics, complexMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'Simple.java', content: simple }]),
            adapter.calculateMetrics([{ path: 'Complex.java', content: complex }]),
        ]);

        // Hours must be positive and complex > simple (more code + higher CC + no docs)
        expect(simpleMetrics[0].estimatedHours).toBeGreaterThan(0);
        expect(complexMetrics[0].estimatedHours).toBeGreaterThan(simpleMetrics[0].estimatedHours);
    });

    it('should produce higher estimated hours for larger files, all else equal', async () => {
        const small = `public class Small {
    public int foo() { return 1; }
}
`;
        const large = `public class Large {
    public int foo() { return 1; }
    public int bar() { return 2; }
    public int baz() { return 3; }
    public int qux() { return 4; }
    public int quux() { return 5; }
}
`;
        const [smallMetrics, largeMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'Small.java', content: small }]),
            adapter.calculateMetrics([{ path: 'Large.java', content: large }]),
        ]);

        expect(largeMetrics[0].nloc).toBeGreaterThan(smallMetrics[0].nloc);
        expect(largeMetrics[0].estimatedHours).toBeGreaterThan(smallMetrics[0].estimatedHours);
    });
});
