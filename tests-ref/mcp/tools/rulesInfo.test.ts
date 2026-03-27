import { describe, it, expect } from 'vitest';
import { createRulesInfoHandler } from '../../../src/mcp/tools/rulesInfo.js';
import { shippedRules } from '../../../src/static/rules/index.js';

describe('rules_info MCP tool', () => {
    const handler = createRulesInfoHandler(shippedRules);

    it('returns all rules when no filters', async () => {
        const result = await handler({});
        const text = (result.content[0] as any).text;
        expect(text).toContain('rules');
        expect(text).toContain('total');
        expect(text).toContain('SOL-001');
        expect(text).toContain('GEN-001');
        expect(text).toContain('MAP-001');
    });

    it('filters by language', async () => {
        const result = await handler({ languages: ['solidity'] });
        const text = (result.content[0] as any).text;
        expect(text).toContain('SOL-001');
        // GEN rules have no language filter → apply to all → included
        expect(text).toContain('GEN-001');
    });

    it('filters by severity', async () => {
        const result = await handler({ severity: ['high'] });
        const text = (result.content[0] as any).text;
        expect(text).toContain('SOL-001'); // high severity
        expect(text).not.toContain('SOL-006'); // info severity
    });

    it('filters by kind', async () => {
        const result = await handler({ kind: ['pointer'] });
        const text = (result.content[0] as any).text;
        // pointer rules exist (SOL-026, SOL-027, SOL-028)
        expect(text).toContain('pointer');
    });

    it('returns empty list when given no rules', async () => {
        const handler2 = createRulesInfoHandler([]);
        const result = await handler2({});
        const text = (result.content[0] as any).text;
        expect(text).toContain('total');
        expect(text).toContain('0');
    });
});
