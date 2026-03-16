import { describe, it, expect } from 'vitest';
import { CairoAdapter } from '../../../../src/languages/cairoAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runMapRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/MAP-002-unused-function.js';

describe('MAP-002: Unused function (Cairo)', () => {
    it('flags unused private function', async () => {
        const { ctx, symbolMap } = await buildContextForAdapter(new CairoAdapter(), SupportedLanguage.Cairo, {
            '/test.cairo': `fn unused_helper() -> felt252 { 1 }
fn main() -> felt252 { 2 }`,
        });
        const findings = await runMapRule(ctx, symbolMap, rule);
        expect(findings.some(f => f.snippet.includes('unused_helper'))).toBe(true);
    });
});
