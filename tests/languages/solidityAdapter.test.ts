import { describe, it, expect } from 'vitest';
import { SolidityAdapter } from '../../src/languages/solidityAdapter.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('SolidityAdapter', () => {
    const adapter = new SolidityAdapter();

    it('should extract public and external functions', async () => {
        const code = fs.readFileSync(
            path.join(__dirname, '../fixtures/solidity/SimpleVault.sol'),
            'utf-8'
        );

        const entrypoints = await adapter.extractEntrypoints([
            { path: 'SimpleVault.sol', content: code }
        ]);

        expect(entrypoints.length).toBeGreaterThan(0);

        // Check for specific functions
        const functionNames = entrypoints.map(e => e.name);
        expect(functionNames).toContain('deposit');
        expect(functionNames).toContain('withdraw');
        expect(functionNames).toContain('getBalance');

        // Should NOT contain private or internal functions
        expect(functionNames).not.toContain('_internalHelper');
        expect(functionNames).not.toContain('privateFunction');
    });

    it('should extract correct visibility', async () => {
        const code = fs.readFileSync(
            path.join(__dirname, '../fixtures/solidity/SimpleVault.sol'),
            'utf-8'
        );

        const entrypoints = await adapter.extractEntrypoints([
            { path: 'SimpleVault.sol', content: code }
        ]);

        const deposit = entrypoints.find(e => e.name === 'deposit');
        expect(deposit?.visibility).toBe('external');

        const withdraw = entrypoints.find(e => e.name === 'withdraw');
        expect(withdraw?.visibility).toBe('public');
    });

    it('should extract contract name', async () => {
        const code = fs.readFileSync(
            path.join(__dirname, '../fixtures/solidity/SimpleVault.sol'),
            'utf-8'
        );

        const entrypoints = await adapter.extractEntrypoints([
            { path: 'SimpleVault.sol', content: code }
        ]);

        entrypoints.forEach(e => {
            expect(e.contract).toBe('SimpleVault');
        });
    });

    it('should extract location information', async () => {
        const code = `contract Test {
    function foo() public {}
}`;

        const entrypoints = await adapter.extractEntrypoints([
            { path: 'Test.sol', content: code }
        ]);

        expect(entrypoints.length).toBe(1);
        expect(entrypoints[0].location.line).toBeGreaterThan(0);
        expect(entrypoints[0].location.column).toBeGreaterThanOrEqual(0);
    });
});
