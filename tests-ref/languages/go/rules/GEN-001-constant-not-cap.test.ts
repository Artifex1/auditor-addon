import { describe, it, expect } from 'vitest';
import { GoAdapter } from '../../../../src/languages/goAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-001-constant-not-cap.js';

describe('GEN-001: Constant not UPPER_CASE (Go)', () => {
    it('detects lowercase const', async () => {
        const { ctx } = await buildContextForAdapter(new GoAdapter(), SupportedLanguage.Go, {
            '/test.go': `package main
const myConst = 42`,
        });
        const findings = await runRule(ctx, '/test.go', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('myConst');
    });

    it('does not flag UPPER_CASE const', async () => {
        const { ctx } = await buildContextForAdapter(new GoAdapter(), SupportedLanguage.Go, {
            '/test.go': `package main
const MY_CONST = 42`,
        });
        const findings = await runRule(ctx, '/test.go', rule);
        expect(findings).toHaveLength(0);
    });
});
