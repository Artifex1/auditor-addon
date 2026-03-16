import { describe, it, expect } from 'vitest';
import { PythonAdapter } from '../../../../src/languages/pythonAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-002-duplicated-import.js';

describe('GEN-002: Duplicated import (Python)', () => {
    it('detects duplicate import', async () => {
        const { ctx } = await buildContextForAdapter(new PythonAdapter(), SupportedLanguage.Python, {
            '/test.py': `import os
import os
def main(): pass`,
        });
        const findings = await runRule(ctx, '/test.py', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag unique imports', async () => {
        const { ctx } = await buildContextForAdapter(new PythonAdapter(), SupportedLanguage.Python, {
            '/test.py': `import os
import sys
def main(): pass`,
        });
        const findings = await runRule(ctx, '/test.py', rule);
        expect(findings).toHaveLength(0);
    });
});
