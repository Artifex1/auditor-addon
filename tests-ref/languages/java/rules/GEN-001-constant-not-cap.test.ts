import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../../../../src/languages/javaAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-001-constant-not-cap.js';

describe('GEN-001: Constant not UPPER_CASE (Java)', () => {
    it('detects lowercase static final field', async () => {
        const { ctx } = await buildContextForAdapter(new JavaAdapter(), SupportedLanguage.Java, {
            '/Test.java': `public class Test {
    public static final int myConst = 42;
}`,
        });
        const findings = await runRule(ctx, '/Test.java', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('myConst');
    });

    it('does not flag UPPER_CASE static final', async () => {
        const { ctx } = await buildContextForAdapter(new JavaAdapter(), SupportedLanguage.Java, {
            '/Test.java': `public class Test {
    public static final int MY_CONST = 42;
}`,
        });
        const findings = await runRule(ctx, '/Test.java', rule);
        expect(findings).toHaveLength(0);
    });
});
