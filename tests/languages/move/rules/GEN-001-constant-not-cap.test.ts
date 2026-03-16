import { describe, it, expect } from 'vitest';
import { MoveAdapter } from '../../../../src/languages/moveAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-001-constant-not-cap.js';

describe('GEN-001: Constant not UPPER_CASE (Move)', () => {
    it('detects lowercase const', async () => {
        const { ctx } = await buildContextForAdapter(new MoveAdapter(), SupportedLanguage.Move, {
            '/test.move': `module 0x1::test {
    const myConst: u64 = 42;
}`,
        });
        const findings = await runRule(ctx, '/test.move', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('myConst');
    });

    it('does not flag UPPER_CASE const', async () => {
        const { ctx } = await buildContextForAdapter(new MoveAdapter(), SupportedLanguage.Move, {
            '/test.move': `module 0x1::test {
    const MY_CONST: u64 = 42;
}`,
        });
        const findings = await runRule(ctx, '/test.move', rule);
        expect(findings).toHaveLength(0);
    });
});
