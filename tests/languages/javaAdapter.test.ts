import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../../src/languages/javaAdapter.js';
import { FileContent } from '../../src/engine/types.js';

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
});
