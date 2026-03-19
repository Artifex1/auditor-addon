import { describe, it, expect } from 'vitest';
import { CairoAdapter } from '../../../src/languages/cairoAdapter.js';

describe('CairoAdapter Test Stripping', () => {
    const adapter = new CairoAdapter();

    describe('stripTestCode', () => {
        it('should strip #[cfg(test)] mod blocks', async () => {
            const content = `fn production() -> u32 {
    42
}

#[cfg(test)]
mod tests {
    use super::production;

    #[test]
    fn test_production() {
        assert(production() == 42, 'fail');
    }
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production()');
            expect(stripped).not.toContain('mod tests');
            expect(stripped).not.toContain('#[cfg(test)]');
            expect(stripped).not.toContain('test_production');
        });

        it('should strip standalone #[test] functions', async () => {
            const content = `fn helper() -> u32 {
    1
}

#[test]
fn test_helper() {
    assert(helper() == 1, 'fail');
}

fn another_helper() -> u32 {
    2
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn helper()');
            expect(stripped).toContain('fn another_helper()');
            expect(stripped).not.toContain('test_helper');
            expect(stripped).not.toContain('#[test]');
        });

        it('should strip #[test] functions with extra attributes', async () => {
            const content = `fn production() -> u32 { 42 }

#[test]
#[available_gas(2000000)]
fn test_with_gas() {
    assert(1 == 1, 'ok');
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production()');
            expect(stripped).not.toContain('test_with_gas');
            expect(stripped).not.toContain('#[test]');
            expect(stripped).not.toContain('#[available_gas');
        });

        it('should return content unchanged when no tests present', async () => {
            const content = `fn greet() -> felt252 {
    'hello'
}

fn main() {
    greet();
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toBe(content);
        });
    });

    describe('calculateMetrics with test stripping', () => {
        it('should exclude #[cfg(test)] mod from metrics', async () => {
            const contentWithTests = `fn production() -> u32 {
    if true {
        42
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::production;

    #[test]
    fn test_production() {
        assert(production() == 42, 'fail');
    }

    #[test]
    fn test_edge() {
        if production() > 0 {
            assert(true, 'ok');
        }
    }
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
                { path: 'with_tests.cairo', content: contentWithTests }
            ]);
            const [metricsWithout] = await adapter.calculateMetrics([
                { path: 'without_tests.cairo', content: contentWithoutTests }
            ]);

            expect(metricsWith.nloc).toBe(metricsWithout.nloc);
            expect(metricsWith.cognitiveComplexity).toBe(metricsWithout.cognitiveComplexity);
        });

        it('should strip standalone #[test] functions from metrics', async () => {
            const withTest = `fn real_fn() -> u32 {
    1
}

#[test]
fn test_real_fn() {
    assert(real_fn() == 1, 'fail');
}
`;
            const withoutTest = `fn real_fn() -> u32 {
    1
}
`;

            const [metricsWith] = await adapter.calculateMetrics([
                { path: 'a.cairo', content: withTest }
            ]);
            const [metricsWithout] = await adapter.calculateMetrics([
                { path: 'b.cairo', content: withoutTest }
            ]);

            expect(metricsWith.nloc).toBe(metricsWithout.nloc);
        });
    });
});
