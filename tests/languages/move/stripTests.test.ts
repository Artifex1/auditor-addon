import { describe, it, expect } from 'vitest';
import { MoveAdapter } from '../../../src/languages/moveAdapter.js';

describe('MoveAdapter Test Stripping', () => {
    const adapter = new MoveAdapter();

    describe('stripTestCode', () => {
        it('should strip #[test_only] modules', async () => {
            const content = `module 0x1::main {
    fun production(): u64 {
        42
    }
}

#[test_only]
module 0x1::test_helpers {
    fun helper(): u64 { 1 }
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('module 0x1::main');
            expect(stripped).toContain('fun production()');
            expect(stripped).not.toContain('test_helpers');
            expect(stripped).not.toContain('#[test_only]');
        });

        it('should strip #[test] function declarations', async () => {
            const content = `module 0x1::my_module {
    fun production(): u64 {
        42
    }

    #[test]
    fun test_production() {
        assert!(production() == 42, 0);
    }

    fun another(): u64 {
        1
    }
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fun production()');
            expect(stripped).toContain('fun another()');
            expect(stripped).not.toContain('test_production');
            expect(stripped).not.toContain('#[test]');
        });

        it('should strip #[test_only] function declarations', async () => {
            const content = `module 0x1::my_module {
    fun production(): u64 { 42 }

    #[test_only]
    fun test_helper(): u64 { 1 }
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fun production()');
            expect(stripped).not.toContain('test_helper');
            expect(stripped).not.toContain('#[test_only]');
        });

        it('should strip #[test] with #[expected_failure]', async () => {
            const content = `module 0x1::my_module {
    fun production(): u64 { 42 }

    #[test]
    #[expected_failure(abort_code = 0)]
    fun test_fails() {
        abort 0
    }
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fun production()');
            expect(stripped).not.toContain('test_fails');
            expect(stripped).not.toContain('#[expected_failure');
        });

        it('should strip #[test] with signer arguments', async () => {
            const content = `module 0x1::my_module {
    fun production(): u64 { 42 }

    #[test(a = @0x1)]
    fun test_with_signer(a: signer) {
    }
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fun production()');
            expect(stripped).not.toContain('test_with_signer');
        });

        it('should return content unchanged when no tests present', async () => {
            const content = `module 0x1::my_module {
    fun production(): u64 {
        42
    }

    public fun get(): u64 {
        production()
    }
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toBe(content);
        });
    });

    describe('calculateMetrics with test stripping', () => {
        it('should exclude test code from metrics', async () => {
            const contentWithTests = `module 0x1::my_module {
    fun production(): u64 {
        if (true) {
            42
        } else {
            0
        }
    }

    #[test]
    fun test_production() {
        assert!(production() == 42, 0);
    }

    #[test_only]
    fun test_helper(): u64 {
        if (true) { 1 } else { 0 }
    }
}
`;

            const contentWithoutTests = `module 0x1::my_module {
    fun production(): u64 {
        if (true) {
            42
        } else {
            0
        }
    }
}
`;

            const [metricsWith] = await adapter.calculateMetrics([
                { path: 'with_tests.move', content: contentWithTests }
            ]);
            const [metricsWithout] = await adapter.calculateMetrics([
                { path: 'without_tests.move', content: contentWithoutTests }
            ]);

            expect(metricsWith.nloc).toBe(metricsWithout.nloc);
            expect(metricsWith.cognitiveComplexity).toBe(metricsWithout.cognitiveComplexity);
        });
    });
});
