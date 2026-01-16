import { describe, it, expect } from 'vitest';
import { TolkAdapter } from '../../src/languages/tolkAdapter.js';
import { FileContent } from '../../src/engine/types.js';

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
});
