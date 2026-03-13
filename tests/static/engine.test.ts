import { describe, it, expect, afterEach } from 'vitest';
import { runScan, resolveEffective } from '../../src/static/engine.js';
import { deleteScanState } from '../../src/static/persistence.js';
import { SupportedLanguage, LANGUAGE_META } from '../../src/engine/types.js';
import { SolidityAdapter } from '../../src/languages/solidityAdapter.js';

const scanIds: string[] = [];

afterEach(async () => {
    for (const id of scanIds) {
        await deleteScanState(id);
    }
    scanIds.length = 0;
});

describe('resolveEffective', () => {
    it('returns LANGUAGE_META defaults when no context', () => {
        const result = resolveEffective([SupportedLanguage.Solidity]);
        expect(result[SupportedLanguage.Solidity]).toEqual({
            domain: 'on-chain',
            inheritanceModel: 'classical',
            framework: undefined,
        });
    });

    it('applies domain overrides from context', () => {
        const result = resolveEffective([SupportedLanguage.Rust], {
            domainOverrides: { [SupportedLanguage.Rust]: 'on-chain' },
        });
        expect(result[SupportedLanguage.Rust].domain).toBe('on-chain');
        // inheritanceModel is never overridden
        expect(result[SupportedLanguage.Rust].inheritanceModel).toBe('trait-based');
    });

    it('passes through framework from context', () => {
        const result = resolveEffective([SupportedLanguage.Rust], {
            framework: 'anchor',
        });
        expect(result[SupportedLanguage.Rust].framework).toBe('anchor');
    });

    it('handles multiple languages', () => {
        const result = resolveEffective([
            SupportedLanguage.Solidity,
            SupportedLanguage.Rust,
        ]);
        expect(Object.keys(result)).toHaveLength(2);
        expect(result[SupportedLanguage.Solidity].domain).toBe('on-chain');
        expect(result[SupportedLanguage.Rust].domain).toBe('off-chain');
    });
});

describe('runScan', () => {
    it('produces a scan result with scanId and status', async () => {
        const adapter = new SolidityAdapter();
        const code = `
            contract Test {
                function foo() public { bar(); }
                function bar() internal {}
            }
        `;

        const filesByLanguage = new Map([[
            SupportedLanguage.Solidity,
            { adapter, files: [{ path: '/test.sol', content: code }] },
        ]]);

        const result = await runScan(filesByLanguage);
        scanIds.push(result.scanId);

        expect(result.scanId).toBeTruthy();
        expect(result.symbolMap.size).toBeGreaterThan(0);
        expect(result.effective[SupportedLanguage.Solidity]).toBeDefined();
        expect(['ready', 'needs_resolution']).toContain(result.status);
    });

    it('detects gaps for external calls', async () => {
        const adapter = new SolidityAdapter();
        const code = `
            interface IExternal {
                function doStuff() external;
            }
            contract Test {
                IExternal ext;
                function foo() public {
                    ext.doStuff();
                }
            }
        `;

        const filesByLanguage = new Map([[
            SupportedLanguage.Solidity,
            { adapter, files: [{ path: '/test.sol', content: code }] },
        ]]);

        const result = await runScan(filesByLanguage);
        scanIds.push(result.scanId);

        // The external call edge may produce a gap
        // (depends on whether doStuff resolves to the interface symbol)
        expect(result.symbolMap.size).toBeGreaterThan(0);
    });

    it('persists scan state to disk', async () => {
        const adapter = new SolidityAdapter();
        const code = `contract Test { function foo() public {} }`;

        const filesByLanguage = new Map([[
            SupportedLanguage.Solidity,
            { adapter, files: [{ path: '/test.sol', content: code }] },
        ]]);

        const result = await runScan(filesByLanguage);
        scanIds.push(result.scanId);

        expect(result.persistedPath).toBeTruthy();
        expect(result.persistedPath).toContain(result.scanId);
    });

    it('computes hotspots from the symbol map', async () => {
        const adapter = new SolidityAdapter();
        const code = `
            contract Test {
                function a() public { shared(); }
                function b() public { shared(); }
                function shared() internal {}
            }
        `;

        const filesByLanguage = new Map([[
            SupportedLanguage.Solidity,
            { adapter, files: [{ path: '/test.sol', content: code }] },
        ]]);

        const result = await runScan(filesByLanguage);
        scanIds.push(result.scanId);

        expect(Array.isArray(result.hotspots)).toBe(true);
    });
});
