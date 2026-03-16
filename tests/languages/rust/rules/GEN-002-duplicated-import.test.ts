import { describe, it, expect } from 'vitest';
import { RustAdapter } from '../../../../src/languages/rustAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-002-duplicated-import.js';

describe('GEN-002: Duplicated import (Rust)', () => {
    it('detects duplicate use declaration', async () => {
        const { ctx } = await buildContextForAdapter(new RustAdapter(), SupportedLanguage.Rust, {
            '/test.rs': `use std::io;
use std::io;
fn main() {}`,
        });
        const findings = await runRule(ctx, '/test.rs', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('duplicate import');
    });

    it('does not flag unique use declarations', async () => {
        const { ctx } = await buildContextForAdapter(new RustAdapter(), SupportedLanguage.Rust, {
            '/test.rs': `use std::io;
use std::fs;
fn main() {}`,
        });
        const findings = await runRule(ctx, '/test.rs', rule);
        expect(findings).toHaveLength(0);
    });
});
