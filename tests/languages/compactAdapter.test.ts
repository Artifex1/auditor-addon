import { describe, it, expect } from 'vitest';
import { CompactAdapter } from '../../src/languages/compactAdapter.js';
import { FileContent } from '../../src/engine/types.js';

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
});
