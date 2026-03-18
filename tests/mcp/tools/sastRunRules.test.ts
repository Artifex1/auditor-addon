import { describe, it, expect, afterEach } from 'vitest';
import { createSastRunRulesHandler } from '../../../src/mcp/tools/sastRunRules.js';
import { writeScanState, deleteScanState, ScanState } from '../../../src/static/persistence.js';
import { SupportedLanguage } from '../../../src/engine/types.js';
import { Engine } from '../../../src/engine/index.js';

describe('sast_run_rules MCP tool', () => {
    // No shipped rules, no adapters — tests isolation only
    const handler = createSastRunRulesHandler([], new Engine());
    const scanIds: string[] = [];

    function makeScanState(): ScanState {
        const id = 'test-' + Math.random().toString(36).slice(2, 8);
        scanIds.push(id);
        return {
            scanId: id,
            files: ['/a.sol'],
            languages: [SupportedLanguage.Solidity],
            context: {},
            effective: {
                solidity: { domain: 'on-chain', inheritanceModel: 'classical' },
            },
            symbolMap: {
                'Test.foo': {
                    qualifiedName: 'Test.foo',
                    label: 'foo',
                    file: '/a.sol',
                    line: 5,
                    language: SupportedLanguage.Solidity,
                    writesState: [],
                    readsState: [],
                    callsExternal: false,
                    callees: [],
                    isPublic: true,
                    hasAccessControl: false,
                    modifiers: [],
                    resolvedBy: 'static',
                    confidence: 'high',
                    visibility: 'public',
                },
            },
            gaps: [],
            status: 'ready',
            findings: [],
            sourceFiles: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    }

    afterEach(async () => {
        for (const id of scanIds) await deleteScanState(id);
        scanIds.length = 0;
    });

    it('runs with no rules and returns summary', async () => {
        const state = makeScanState();
        await writeScanState(state);
        const result = await handler({ scanId: state.scanId });
        const text = (result.content[0] as any).text;
        expect(text).toContain('findings');
        expect(text).toContain('summary');
        expect(text).toContain('rulesRun');
    });

    it('returns scanId in output', async () => {
        const state = makeScanState();
        await writeScanState(state);
        const result = await handler({ scanId: state.scanId });
        const text = (result.content[0] as any).text;
        expect(text).toContain('scanId');
    });

    it('returns error for non-existent scan', async () => {
        const result = await handler({ scanId: 'nonexistent' });
        const text = (result.content[0] as any).text;
        expect(text).toContain('not found');
    });

    it('handles severity filter', async () => {
        const state = makeScanState();
        await writeScanState(state);
        const result = await handler({ scanId: state.scanId, includeSeverity: ['critical', 'high'] });
        const text = (result.content[0] as any).text;
        expect(text).toContain('findings');
    });
});
