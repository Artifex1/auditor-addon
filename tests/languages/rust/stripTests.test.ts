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

        it('should strip #[tokio::test] functions (scoped test attribute)', async () => {
            const content = `fn production() -> i32 { 42 }

#[tokio::test]
async fn async_test() {
    assert_eq!(production(), 42);
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production()');
            expect(stripped).not.toContain('async_test');
            expect(stripped).not.toContain('#[tokio::test]');
        });

        it('should strip scoped test attributes with arguments', async () => {
            const content = `fn production() -> i32 { 42 }

#[tokio1::test(crate = "tokio1")]
async fn async_test() {
    assert_eq!(production(), 42);
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production()');
            expect(stripped).not.toContain('async_test');
            expect(stripped).not.toContain('tokio1::test');
        });

        it('should strip scoped test with non-test cfg attribute', async () => {
            const content = `fn production() -> i32 { 42 }

#[cfg(tokio_unstable)]
#[tokio::test(flavor = "current_thread", unhandled_panic = "shutdown_runtime")]
async fn async_test() {
    assert_eq!(production(), 42);
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production()');
            expect(stripped).not.toContain('async_test');
            expect(stripped).not.toContain('#[tokio::test');
            expect(stripped).not.toContain('#[cfg(tokio_unstable)]');
        });

        it('should not strip functions with test-like names but no #[test] attribute', async () => {
            const content = `fn test_helper() -> i32 { 1 }

fn run_tests() {
    test_helper();
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn test_helper()');
            expect(stripped).toContain('fn run_tests()');
        });

        it('should strip #[test] functions with multiple attributes', async () => {
            const content = `fn production() -> i32 { 42 }

#[test]
#[should_panic]
fn test_panics() {
    panic!("expected");
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production()');
            expect(stripped).not.toContain('test_panics');
            expect(stripped).not.toContain('#[test]');
            expect(stripped).not.toContain('#[should_panic]');
        });

        it('should handle #[cfg(test)] with extra whitespace in source', async () => {
            const content = `fn production() -> i32 { 42 }

#[cfg( test )]
mod tests {
    fn test_it() {}
}
`;
            const stripped = await adapter.stripTestCode(content);
            expect(stripped).toContain('fn production()');
            expect(stripped).not.toContain('mod tests');
            expect(stripped).not.toContain('test_it');
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
