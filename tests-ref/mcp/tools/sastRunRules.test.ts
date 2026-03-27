import { describe, it, expect, afterEach } from 'vitest';
import { createSastRunRulesHandler } from '../../../src/mcp/tools/sastRunRules.js';
import { writeScanState, deleteScanState, ScanState } from '../../../src/static/persistence.js';
import { SymbolGraph, SupportedLanguage } from '../../../src/engine/types.js';
import { Engine } from '../../../src/engine/index.js';

describe('sast_run_rules MCP tool', () => {
    // No shipped rules, no adapters — tests isolation only
    const handler = createSastRunRulesHandler([], new Engine());
    const scanIds: string[] = [];

    function makeScanState(): ScanState {
        const id = 'test-' + Math.random().toString(36).slice(2, 8);
        scanIds.push(id);

        const graph = new SymbolGraph();
        graph.addNode({
            id: 'n1',
            kind: 'function',
            qualifiedName: 'Test.foo',
            status: 'concrete',
            language: SupportedLanguage.Solidity,
            label: 'foo',
            locator: { file: '/a.sol', startIndex: 0, endIndex: 10, line: 5, column: 0 },
            visibility: 'public',
            resolvedBy: 'static',
            confidence: 'high',
        });

        return {
            scanId: id,
            files: ['/a.sol'],
            languages: [SupportedLanguage.Solidity],
            context: {},
            effective: {
                solidity: { domain: 'on-chain', inheritanceModel: 'classical' },
            },
            graph: graph.toJSON(),
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
