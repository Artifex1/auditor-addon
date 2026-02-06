import { describe, it, expect } from 'vitest';
import { MasmAdapter } from '../../src/languages/masmAdapter.js';
import { FileContent } from '../../src/engine/types.js';

describe('MasmAdapter Metrics', () => {
    const adapter = new MasmAdapter();

    it('should calculate metrics correctly', async () => {
        const file: FileContent = {
            path: 'test.masm',
            content: `
use std::math::u64

# This is a comment
export.my_procedure.2
    push.1
    push.2
    add

    if.true
        dup
        mul
    else
        drop
    end
end

proc.helper
    push.0
    while.true
        dup
        push.1
        sub
    end
end
`
        };
        const metrics = await adapter.calculateMetrics([file]);
        expect(metrics[0].nloc).toBeGreaterThan(0);
        expect(metrics[0].linesWithComments).toBeGreaterThanOrEqual(1);
        expect(metrics[0].cognitiveComplexity).toBeGreaterThan(0);
    });

    it('should extract signatures', async () => {
        const file: FileContent = {
            path: 'test.masm',
            content: `
export.my_procedure.2
    push.1
    add
end

proc.helper
    push.0
end
`
        };
        const signatures = await adapter.extractSignatures([file]);
        expect(signatures['test.masm']).toBeDefined();
        expect(signatures['test.masm'].length).toBe(2);
    });
});
