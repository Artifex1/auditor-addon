import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSastInitScanHandler } from '../../../src/mcp/tools/sastInitScan.js';
import { createSastRunRulesHandler } from '../../../src/mcp/tools/sastRunRules.js';
import { createRulesInfoHandler } from '../../../src/mcp/tools/rulesInfo.js';
import { shippedRules } from '../../../src/static/rules/index.js';
import { Engine } from '../../../src/engine/index.js';
import { SolidityAdapter } from '../../../src/languages/solidityAdapter.js';
import { deleteScanState } from '../../../src/static/persistence.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUSTOM_RULE_PATH = path.join(__dirname, 'fixtures', 'CUSTOM-001-require-check.ts');

function getText(result: any): string {
    return (result.content[0] as any).text;
}

describe('SAiST pipeline e2e', () => {
    const engine = new Engine();
    engine.registerAdapter(new SolidityAdapter());

    const initHandler = createSastInitScanHandler(engine);
    // Shipped rules come from the static index — no filesystem scan, no path needed
    const runRulesHandler = createSastRunRulesHandler(shippedRules, engine);
    const rulesInfoHandler = createRulesInfoHandler(shippedRules);

    const tmpDir = os.tmpdir();
    const testFile = path.join(tmpDir, 'sast-e2e-test.sol');
    let scanId: string;

    // Contract with multiple known rule triggers:
    // - SOL-003: tx.origin auth check
    // - SOL-006: floating pragma (^0.8.0)
    // - CUSTOM-001: require() call (custom rule loaded via tsx)
    const solCode = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Vulnerable {
    mapping(address => uint) public balances;

    function unsafeWithdraw(uint amount) external {
        require(tx.origin == msg.sender, "no");
        balances[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
    }

    function safeDeposit() external payable {
        balances[msg.sender] += msg.value;
    }
}
`;

    beforeAll(() => {
        fs.writeFileSync(testFile, solCode);
    });

    afterAll(async () => {
        try { fs.unlinkSync(testFile); } catch {}
        if (scanId) await deleteScanState(scanId);
    });

    it('phase 0: shippedRules index contains all 22 rules', () => {
        expect(shippedRules).toHaveLength(22);
        const ids = shippedRules.map(r => r.id);
        expect(ids).toContain('SOL-001');
        expect(ids).toContain('SOL-006');
        expect(ids).toContain('GEN-001');
        expect(ids).toContain('MAP-001');
    });

    it('phase 1: rules_info filters solidity rules from in-memory index', async () => {
        const result = await rulesInfoHandler({ languages: ['solidity'] });
        const text = getText(result);

        expect(text).toContain('SOL-001');
        expect(text).toContain('SOL-003');
        expect(text).toContain('SOL-006');
        // GEN rules have no language filter → included for any language
        expect(text).toContain('GEN-001');
        expect(text).toContain('total');
    });

    it('phase 2: init scan builds symbol map', async () => {
        const result = await initHandler({
            files: [testFile],
            languages: ['solidity'],
        });
        const text = getText(result);

        expect(text).toContain('scanId');
        expect(text).toContain('status');
        expect(text).toContain('symbolMapStats');
        // 3 symbols: balances state var + 2 functions
        expect(text).toContain('total: 3');

        const match = text.match(/scanId[:\s]+"?([a-f0-9-]+)"?/);
        expect(match).toBeTruthy();
        scanId = match![1];
    });

    it('phase 3: run shipped rules produces findings', async () => {
        expect(scanId).toBeTruthy();

        const result = await runRulesHandler({ scanId });
        const text = getText(result);

        expect(text).toContain('findings');
        expect(text).toContain('summary');
        // Rules actually ran (engine + adapters are wired up correctly)
        expect(text).not.toMatch(/rulesRun[:\s]+0/);
        // SOL-003: tx.origin
        expect(text).toContain('SOL-003');
        // SOL-006: floating pragma
        expect(text).toContain('SOL-006');
    });

    it('phase 3b: ruleIds filter runs exactly one rule', async () => {
        expect(scanId).toBeTruthy();

        const result = await runRulesHandler({ scanId, ruleIds: ['SOL-006'] });
        const text = getText(result);

        expect(text).toContain('SOL-006');
        expect(text).toMatch(/rulesRun[:\s]+1/);
    });

    it('phase 3c: kind filter works', async () => {
        expect(scanId).toBeTruthy();

        const result = await runRulesHandler({ scanId, includeKind: ['pointer'] });
        const text = getText(result);

        expect(text).toContain('rulesRun');
        // Tool should succeed regardless of whether pointer rules fire
        expect(text).not.toContain('Error');
    });

    it('phase 4: custom .ts rule loaded via tsx finds findings', async () => {
        expect(scanId).toBeTruthy();

        const result = await runRulesHandler({
            scanId,
            customRulePaths: [CUSTOM_RULE_PATH],
            ruleIds: ['CUSTOM-001'],
        });
        const text = getText(result);

        // Custom rule should have run and found the require() call
        expect(text).toContain('CUSTOM-001');
        expect(text).toMatch(/rulesRun[:\s]+1/);
    });
});
