import { describe, it, expect } from 'vitest';
import { MasmAdapter } from '../../../src/languages/masmAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

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

    it('should produce higher estimated hours for complex undocumented code than simple documented code', async () => {
        const simple = `# Well documented procedure
# This procedure pushes a constant and returns it
# No branching or looping logic involved
export.simple
    # push the constant value
    push.1
    push.2
    add
    push.3
    mul
end
`;
        const complex = `export.complex
    push.0
    if.true
        push.1
        if.true
            push.2
            if.true
                push.3
                while.true
                    dup
                    push.1
                    sub
                end
            end
        end
    end
end
`;
        const [simpleMetrics, complexMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'simple.masm', content: simple }]),
            adapter.calculateMetrics([{ path: 'complex.masm', content: complex }]),
        ]);

        // Hours must be positive and complex > simple (more code + higher CC + no docs)
        expect(simpleMetrics[0].estimatedHours).toBeGreaterThan(0);
        expect(complexMetrics[0].estimatedHours).toBeGreaterThan(simpleMetrics[0].estimatedHours);
    });

    it('should produce higher estimated hours for larger files, all else equal', async () => {
        const small = `export.foo
    push.1
end
`;
        const large = `export.foo
    push.1
end

proc.bar
    push.2
end

proc.baz
    push.3
end

proc.qux
    push.4
end

proc.quux
    push.5
end
`;
        const [smallMetrics, largeMetrics] = await Promise.all([
            adapter.calculateMetrics([{ path: 'small.masm', content: small }]),
            adapter.calculateMetrics([{ path: 'large.masm', content: large }]),
        ]);

        expect(largeMetrics[0].nloc).toBeGreaterThan(smallMetrics[0].nloc);
        expect(largeMetrics[0].estimatedHours).toBeGreaterThan(smallMetrics[0].estimatedHours);
    });
});
