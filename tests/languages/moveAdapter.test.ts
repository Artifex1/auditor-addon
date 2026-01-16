import { describe, it, expect } from 'vitest';
import { MoveAdapter } from '../../src/languages/moveAdapter.js';
import { FileContent } from '../../src/engine/types.js';

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
});
