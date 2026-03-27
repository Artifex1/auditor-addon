import { describe, it, expect, afterEach } from 'vitest';
import { createSastResolveGapsHandler } from '../../../src/mcp/tools/sastResolveGaps.js';
import { writeScanState, deleteScanState, ScanState } from '../../../src/static/persistence.js';
import { SymbolGraph, SupportedLanguage } from '../../../src/engine/types.js';
import { Engine } from '../../../src/engine/index.js';

describe('sast_resolve_gaps MCP tool', () => {
    const handler = createSastResolveGapsHandler(new Engine());
    const scanIds: string[] = [];

    function makeScanState(overrides?: Partial<ScanState>): ScanState {
        const id = 'test-' + Math.random().toString(36).slice(2, 8);
        scanIds.push(id);

        const graph = new SymbolGraph();
        const callerNode = {
            id: 'caller-1',
            kind: 'function' as const,
            qualifiedName: 'Test.foo',
            status: 'concrete' as const,
            language: SupportedLanguage.Solidity,
            label: 'foo',
            locator: { file: '/a.sol', startIndex: 0, endIndex: 10, line: 5, column: 0 },
            visibility: 'public' as const,
            resolvedBy: 'static' as const,
            confidence: 'high' as const,
        };
        const gapNode = {
            id: 'gap-node-1',
            kind: 'function' as const,
            qualifiedName: 'ext.bar',
            status: 'gap' as const,
            language: SupportedLanguage.Solidity,
            label: 'bar',
            visibility: 'external' as const,
            resolvedBy: 'static' as const,
            confidence: 'low' as const,
        };
        graph.addNode(callerNode);
        graph.addNode(gapNode);
        graph.addEdge({ from: 'caller-1', to: 'gap-node-1', kind: 'calls', attrs: { targetKind: 'external_unknown' } });

        return {
            scanId: id,
            files: ['/a.sol'],
            languages: [SupportedLanguage.Solidity],
            context: {},
            effective: {
                solidity: { domain: 'on-chain', inheritanceModel: 'classical' },
            },
            graph: graph.toJSON(),
            gaps: [{
                id: 'gap-abc',
                type: 'unresolved_callee',
                qualifiedName: 'ext.bar',
                callSite: { file: '/a.sol', line: 5, col: 0 },
                codeSnippet: '',
                relevantFiles: ['/a.sol'],
                priority: 'high',
            }],
            status: 'needs_resolution',
            findings: [],
            sourceFiles: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...overrides,
        };
    }

    afterEach(async () => {
        for (const id of scanIds) {
            await deleteScanState(id);
        }
        scanIds.length = 0;
    });

    it('resolves a gap and returns updated status', async () => {
        const state = makeScanState();
        await writeScanState(state);

        const result = await handler({
            scanId: state.scanId,
            resolutions: [{
                gapId: 'gap-abc',
                facts: {},
                resolvedBy: 'agent',
                confidence: 'high',
            }],
        });

        const text = (result.content[0] as any).text;
        expect(text).toContain('applied');
        expect(text).toContain('status');
    });

    it('returns error for non-existent scan', async () => {
        const result = await handler({
            scanId: 'nonexistent',
            resolutions: [],
        });

        const text = (result.content[0] as any).text;
        expect(text).toContain('not found');
    });

    it('transitions to ready when all gaps resolved', async () => {
        const state = makeScanState();
        await writeScanState(state);

        const result = await handler({
            scanId: state.scanId,
            resolutions: [{
                gapId: 'gap-abc',
                facts: {},
                resolvedBy: 'manual',
                confidence: 'medium',
            }],
        });

        const text = (result.content[0] as any).text;
        expect(text).toContain('ready');
    });
});
