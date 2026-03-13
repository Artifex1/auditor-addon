import { describe, it, expect, afterEach } from 'vitest';
import { createSastResolveGapsHandler } from '../../../src/mcp/tools/sastResolveGaps.js';
import { writeScanState, deleteScanState, ScanState } from '../../../src/static/persistence.js';
import { SupportedLanguage } from '../../../src/engine/types.js';

describe('sast_resolve_gaps MCP tool', () => {
    const handler = createSastResolveGapsHandler();
    const scanIds: string[] = [];

    function makeScanState(overrides?: Partial<ScanState>): ScanState {
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
                    callsExternal: true,
                    callees: [{ qualifiedName: 'ext.bar', targetKind: 'external_unknown' }],
                    isPublic: true,
                    hasAccessControl: false,
                    modifiers: [],
                    resolvedBy: 'static',
                    confidence: 'high',
                    visibility: 'public',
                },
            },
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
                facts: { callsExternal: false },
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
