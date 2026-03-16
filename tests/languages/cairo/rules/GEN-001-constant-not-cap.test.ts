import { describe, it, expect } from 'vitest';
import { CairoAdapter } from '../../../../src/languages/cairoAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-001-constant-not-cap.js';

describe('GEN-001: Constant not UPPER_CASE (Cairo)', () => {
    it('detects lowercase const', async () => {
        const { ctx } = await buildContextForAdapter(new CairoAdapter(), SupportedLanguage.Cairo, {
            '/test.cairo': `const myConst: felt252 = 42;`,
        });
        const findings = await runRule(ctx, '/test.cairo', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('myConst');
    });

    it('does not flag UPPER_CASE const', async () => {
        const { ctx } = await buildContextForAdapter(new CairoAdapter(), SupportedLanguage.Cairo, {
            '/test.cairo': `const MY_CONST: felt252 = 42;`,
        });
        const findings = await runRule(ctx, '/test.cairo', rule);
        expect(findings).toHaveLength(0);
    });
});
