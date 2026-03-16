import { describe, it, expect } from 'vitest';
import { CairoAdapter } from '../../../../src/languages/cairoAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-002-duplicated-import.js';

describe('GEN-002: Duplicated import (Cairo)', () => {
    it('detects duplicate use declaration', async () => {
        const { ctx } = await buildContextForAdapter(new CairoAdapter(), SupportedLanguage.Cairo, {
            '/test.cairo': `use core::array::ArrayTrait;
use core::array::ArrayTrait;
fn main() {}`,
        });
        const findings = await runRule(ctx, '/test.cairo', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag unique use declarations', async () => {
        const { ctx } = await buildContextForAdapter(new CairoAdapter(), SupportedLanguage.Cairo, {
            '/test.cairo': `use core::array::ArrayTrait;
use core::option::OptionTrait;
fn main() {}`,
        });
        const findings = await runRule(ctx, '/test.cairo', rule);
        expect(findings).toHaveLength(0);
    });
});
