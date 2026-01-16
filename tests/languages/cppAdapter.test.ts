import { describe, it, expect } from 'vitest';
import { CppAdapter } from '../../src/languages/cppAdapter.js';
import { FileContent } from '../../src/engine/types.js';

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
});
