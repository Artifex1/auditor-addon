import { describe, it, expect } from 'vitest';
import { RustAdapter } from '../../../src/languages/rustAdapter.js';
import { FileContent } from '../../../src/engine/types.js';

describe('RustAdapter Test Stripping', () => {
    const adapter = new RustAdapter();

    describe('stripTestCode', () => {
        it('should strip #[cfg(test)] mod blocks', async () => {
            const content = `use std::collections::HashMap;

fn production_code() -> i32 {
    42
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_production_code() {
        assert_eq!(production_code(), 42);
    }
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production_code()');
            expect(stripped).toContain('use std::collections::HashMap');
            expect(stripped).not.toContain('mod tests');
            expect(stripped).not.toContain('#[cfg(test)]');
            expect(stripped).not.toContain('test_production_code');
        });

        it('should strip standalone #[test] functions', async () => {
            const content = `fn helper() -> i32 {
    1
}

#[test]
fn test_helper() {
    assert_eq!(helper(), 1);
}

fn another_helper() -> i32 {
    2
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn helper()');
            expect(stripped).toContain('fn another_helper()');
            expect(stripped).not.toContain('test_helper');
            expect(stripped).not.toContain('#[test]');
        });

        it('should NOT strip doc-test code blocks inside /// comments', async () => {
            const content = `/// Adds two numbers together.
///
/// # Examples
///
/// \`\`\`
/// let result = add(2, 3);
/// assert_eq!(result, 5);
/// \`\`\`
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('/// ```');
            expect(stripped).toContain('/// let result = add(2, 3);');
            expect(stripped).toContain('/// assert_eq!(result, 5);');
            expect(stripped).toContain('pub fn add(a: i32, b: i32) -> i32');
        });

        it('should return content unchanged when no tests present', async () => {
            const content = `use std::io;

pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

fn main() {
    println!("{}", greet("world"));
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toBe(content);
        });
    });

    describe('calculateMetrics with test stripping', () => {
        it('should exclude #[cfg(test)] mod from metrics', async () => {
            const contentWithTests = `fn production() -> i32 {
    if true {
        42
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_production() {
        assert_eq!(production(), 42);
    }

    #[test]
    fn test_production_edge() {
        let x = production();
        if x > 0 {
            assert!(true);
        }
    }
}
`;

            const contentWithoutTests = `fn production() -> i32 {
    if true {
        42
    } else {
        0
    }
}
`;

            const [metricsWithTests] = await adapter.calculateMetrics([
                { path: 'with_tests.rs', content: contentWithTests }
            ]);
            const [metricsWithoutTests] = await adapter.calculateMetrics([
                { path: 'without_tests.rs', content: contentWithoutTests }
            ]);

            // The metrics should be very close since test code is stripped
            expect(metricsWithTests.nloc).toBe(metricsWithoutTests.nloc);
            expect(metricsWithTests.cognitiveComplexity).toBe(metricsWithoutTests.cognitiveComplexity);
            expect(metricsWithTests.estimatedHours).toBe(metricsWithoutTests.estimatedHours);
        });

        it('should not affect metrics when doc-tests are present', async () => {
            const content: FileContent = {
                path: 'documented.rs',
                content: `/// Adds two numbers.
///
/// # Examples
///
/// \`\`\`
/// let result = add(2, 3);
/// assert_eq!(result, 5);
/// \`\`\`
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
`
            };

            const metrics = await adapter.calculateMetrics([content]);
            expect(metrics).toHaveLength(1);
            // Doc comments should still be counted
            expect(metrics[0].linesWithComments).toBeGreaterThan(0);
            expect(metrics[0].nloc).toBeGreaterThan(0);
        });

        it('should strip standalone #[test] functions from metrics', async () => {
            const withTest = `fn real_fn() -> i32 {
    1
}

#[test]
fn test_real_fn() {
    assert_eq!(real_fn(), 1);
}
`;
            const withoutTest = `fn real_fn() -> i32 {
    1
}
`;

            const [metricsWith] = await adapter.calculateMetrics([
                { path: 'a.rs', content: withTest }
            ]);
            const [metricsWithout] = await adapter.calculateMetrics([
                { path: 'b.rs', content: withoutTest }
            ]);

            expect(metricsWith.nloc).toBe(metricsWithout.nloc);
        });
    });
});
