import { describe, it, expect } from 'vitest';
import { GoAdapter } from '../../../src/languages/goAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

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

    it('should extract signatures from Go code', async () => {
        const content = `
            package main

            func PublicFunc() {}
            func privateFunc(x int) int { return x }

            type Server struct{}

            func (s *Server) Start() {}
            func (s Server) Stop() {}
        `;

        const signaturesByFile = await adapter.extractSignatures([{ path: 'test.go', content }]);
        const allSignatures = Object.values(signaturesByFile).flat();
        expect(allSignatures.length).toBe(4);
        expect(allSignatures.some(s => s.includes('PublicFunc'))).toBe(true);
        expect(allSignatures.some(s => s.includes('privateFunc'))).toBe(true);
        expect(allSignatures.some(s => s.includes('Start'))).toBe(true);
        expect(allSignatures.some(s => s.includes('Stop'))).toBe(true);
    });

    it('should calculate metrics with nested complexity', async () => {
        const content = `package main

func complex(n int) {
    if n > 0 {
        for i := 0; i < n; i++ {
            // comment
        }
    }
}`;
        // Analysis:
        // Total lines: 8
        // Blank lines: 0
        // Comment-only lines: 1 (line 6: "// comment")
        // NLoC = 8 - 0 - 1 = 7
        // Cognitive complexity: if (level 0) = 1, for (level 1) = 1 + 1 = 2, total = 3

        const metrics = await adapter.calculateMetrics([{ path: 'complex.go', content }]);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].nloc).toBe(7);
        expect(metrics[0].cognitiveComplexity).toBe(3);
        expect(metrics[0].linesWithComments).toBe(1);
    });

    it('should calculate metrics with switch statements', async () => {
        const content = `package main

func withSwitch(x int) int {
    switch x {
    case 1:
        return 1
    case 2:
        return 2
    default:
        return 0
    }
}`;
        // switch adds complexity
        const metrics = await adapter.calculateMetrics([{ path: 'switch.go', content }]);
        expect(metrics).toHaveLength(1);
        expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
    });
});
