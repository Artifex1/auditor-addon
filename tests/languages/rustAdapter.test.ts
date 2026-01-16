import { describe, it, expect } from 'vitest';
import { RustAdapter } from '../../src/languages/rustAdapter.js';
import { FileContent } from '../../src/engine/types.js';

describe('RustAdapter Metrics', () => {
    const adapter = new RustAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'main.rs',
            content: `
                fn main() {
                    // Comment
                    if true {
                        println!("Hello");
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
