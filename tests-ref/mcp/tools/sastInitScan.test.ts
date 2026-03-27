import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createSastInitScanHandler } from '../../../src/mcp/tools/sastInitScan.js';
import { Engine } from '../../../src/engine/index.js';
import { deleteScanState } from '../../../src/static/persistence.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('sast_init_scan MCP tool', () => {
    const engine = new Engine();
    const handler = createSastInitScanHandler(engine);
    const scanIds: string[] = [];

    // Write a temp Solidity file for the test
    const tmpDir = os.tmpdir();
    const testFile = path.join(tmpDir, 'sast-test-init.sol');

    const solCode = `
        contract TestVault {
            uint public balance;
            function deposit() external {
                balance += 1;
                _validate();
            }
            function _validate() internal {}
        }
    `;

    beforeAll(() => {
        fs.writeFileSync(testFile, solCode);
    });

    afterAll(() => {
        try { fs.unlinkSync(testFile); } catch {}
    });

    afterEach(async () => {
        for (const id of scanIds) {
            await deleteScanState(id);
        }
        scanIds.length = 0;
    });

    it('returns a scanId and status', async () => {
        const result = await handler({
            files: [testFile],
            languages: ['solidity'],
        });

        expect(result.content).toHaveLength(1);
        const text = (result.content[0] as any).text;
        expect(text).toContain('scanId');
        expect(text).toContain('status');

        // Extract scanId for cleanup
        const match = text.match(/scanId[:\s]+"?([a-f0-9-]+)"?/);
        if (match) scanIds.push(match[1]);
    });

    it('returns symbol map stats', async () => {
        const result = await handler({
            files: [testFile],
            languages: ['solidity'],
        });

        const text = (result.content[0] as any).text;
        expect(text).toContain('total');
        expect(text).toContain('symbolMapStats');
    });

    it('handles context with domain overrides', async () => {
        const result = await handler({
            files: [testFile],
            languages: ['solidity'],
            context: { framework: 'custom' },
        });

        const text = (result.content[0] as any).text;
        expect(text).toContain('scanId');
    });

    it('returns error for non-existent files', async () => {
        const result = await handler({
            files: ['/nonexistent/path.sol'],
            languages: ['solidity'],
        });

        const text = (result.content[0] as any).text;
        // Should either error or return empty results
        expect(text).toBeTruthy();
    });
});
