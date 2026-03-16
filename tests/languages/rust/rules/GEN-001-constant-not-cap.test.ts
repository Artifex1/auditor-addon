import { describe, it, expect } from 'vitest';
import { RustAdapter } from '../../../../src/languages/rustAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-001-constant-not-cap.js';

describe('GEN-001: Constant not UPPER_CASE (Rust)', () => {
    it('detects lowercase const', async () => {
        const { ctx } = await buildContextForAdapter(new RustAdapter(), SupportedLanguage.Rust, {
            '/test.rs': `const myConst: u32 = 42;`,
        });
        const findings = await runRule(ctx, '/test.rs', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('myConst');
    });

    it('does not flag UPPER_CASE const', async () => {
        const { ctx } = await buildContextForAdapter(new RustAdapter(), SupportedLanguage.Rust, {
            '/test.rs': `const MY_CONST: u32 = 42;`,
        });
        const findings = await runRule(ctx, '/test.rs', rule);
        expect(findings).toHaveLength(0);
    });
});
