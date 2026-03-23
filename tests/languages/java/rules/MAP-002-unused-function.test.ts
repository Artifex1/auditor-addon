import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../../../../src/languages/javaAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runMapRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/MAP-002-unused-function.js';

describe('MAP-002: Unused function (Java)', () => {
    it('flags unused private method', async () => {
        const { ctx, graph } = await buildContextForAdapter(new JavaAdapter(), SupportedLanguage.Java, {
            '/Test.java': `public class Test {
    private int unused() { return 1; }
    public int main() { return 2; }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings.some(f => f.snippet.includes('unused'))).toBe(true);
    });

    it('does not flag called private method', async () => {
        const { ctx, graph } = await buildContextForAdapter(new JavaAdapter(), SupportedLanguage.Java, {
            '/Test.java': `public class Test {
    private int helper() { return 1; }
    public int main() { return helper(); }
}`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings.some(f => f.snippet.includes('helper'))).toBe(false);
    });
});
