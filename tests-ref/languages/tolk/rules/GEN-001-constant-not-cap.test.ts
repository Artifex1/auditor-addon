import { describe, it, expect } from 'vitest';
import { TolkAdapter } from '../../../../src/languages/tolkAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-001-constant-not-cap.js';

describe('GEN-001: Constant not UPPER_CASE (Tolk)', () => {
    it('detects lowercase const', async () => {
        const { ctx } = await buildContextForAdapter(new TolkAdapter(), SupportedLanguage.Tolk, {
            '/test.tolk': `const myConst = 42;`,
        });
        const findings = await runRule(ctx, '/test.tolk', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('myConst');
    });

    it('does not flag UPPER_CASE const', async () => {
        const { ctx } = await buildContextForAdapter(new TolkAdapter(), SupportedLanguage.Tolk, {
            '/test.tolk': `const MY_CONST = 42;`,
        });
        const findings = await runRule(ctx, '/test.tolk', rule);
        expect(findings).toHaveLength(0);
    });
});
