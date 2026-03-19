import { describe, it, expect } from 'vitest';
import { NoirAdapter } from '../../../src/languages/noirAdapter.js';

describe('NoirAdapter Test Stripping', () => {
    const adapter = new NoirAdapter();

    describe('stripTestCode', () => {
        it('should strip #[test] functions', async () => {
            const content = `fn production() -> u32 {
    42
}

#[test]
fn test_production() {
    assert(production() == 42);
}

fn another() -> u32 {
    1
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production()');
            expect(stripped).toContain('fn another()');
            expect(stripped).not.toContain('test_production');
            expect(stripped).not.toContain('#[test]');
        });

        it('should strip #[test(should_fail)] functions', async () => {
            const content = `fn production() -> u32 { 42 }

#[test(should_fail)]
fn test_should_fail() {
    assert(1 == 2);
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production()');
            expect(stripped).not.toContain('test_should_fail');
            expect(stripped).not.toContain('#[test(should_fail)]');
        });

        it('should strip #[test(should_fail_with = "msg")] functions', async () => {
            const content = `fn production() -> u32 { 42 }

#[test(should_fail_with = "not equal")]
fn test_fail_msg() {
    assert(1 == 2);
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production()');
            expect(stripped).not.toContain('test_fail_msg');
            expect(stripped).not.toContain('should_fail_with');
        });

        it('should not strip functions without test attributes', async () => {
            const content = `fn test_helper() -> u32 { 1 }

fn run_tests() {
    test_helper();
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn test_helper()');
            expect(stripped).toContain('fn run_tests()');
        });

        it('should return content unchanged when no tests present', async () => {
            const content = `fn greet() -> Field {
    42
}

fn main() {
    let x = greet();
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toBe(content);
        });
    });

    describe('calculateMetrics with test stripping', () => {
        it('should exclude test code from metrics', async () => {
            const contentWithTests = `fn production() -> u32 {
    if true {
        42
    } else {
        0
    }
}

#[test]
fn test_production() {
    assert(production() == 42);
}

#[test(should_fail)]
fn test_fail() {
    assert(1 == 2);
}
`;

            const contentWithoutTests = `fn production() -> u32 {
    if true {
        42
    } else {
        0
    }
}
`;

            const [metricsWith] = await adapter.calculateMetrics([
                { path: 'with_tests.nr', content: contentWithTests }
            ]);
            const [metricsWithout] = await adapter.calculateMetrics([
                { path: 'without_tests.nr', content: contentWithoutTests }
            ]);

            expect(metricsWith.nloc).toBe(metricsWithout.nloc);
            expect(metricsWith.cognitiveComplexity).toBe(metricsWithout.cognitiveComplexity);
        });
    });
});
