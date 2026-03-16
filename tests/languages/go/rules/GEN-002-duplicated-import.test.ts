import { describe, it, expect } from 'vitest';
import { GoAdapter } from '../../../../src/languages/goAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-002-duplicated-import.js';

describe('GEN-002: Duplicated import (Go)', () => {
    it('detects duplicate import', async () => {
        const { ctx } = await buildContextForAdapter(new GoAdapter(), SupportedLanguage.Go, {
            '/test.go': `package main
import "fmt"
import "fmt"
func main() {}`,
        });
        const findings = await runRule(ctx, '/test.go', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag unique imports', async () => {
        const { ctx } = await buildContextForAdapter(new GoAdapter(), SupportedLanguage.Go, {
            '/test.go': `package main
import "fmt"
import "os"
func main() {}`,
        });
        const findings = await runRule(ctx, '/test.go', rule);
        expect(findings).toHaveLength(0);
    });
});
