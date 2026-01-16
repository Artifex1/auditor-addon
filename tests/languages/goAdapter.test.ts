import { describe, it, expect } from 'vitest';
import { GoAdapter } from '../../src/languages/goAdapter.js';
import { FileContent } from '../../src/engine/types.js';

describe('GoAdapter Metrics', () => {
    const adapter = new GoAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'main.go',
            content: `
                package main
                import "fmt"

                // Comment
                func main() {
                    if true {
                        fmt.Println("Hello")
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
