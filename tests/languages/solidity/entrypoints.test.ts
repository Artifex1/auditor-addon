import { describe, it, expect } from 'vitest';
import { SolidityAdapter } from '../../../src/languages/solidityAdapter.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('SolidityAdapter - Entrypoint Extraction', () => {
    const adapter = new SolidityAdapter();

    it('should extract public and external functions', async () => {
        const code = fs.readFileSync(
            path.join(__dirname, '../../fixtures/solidity/SimpleVault.sol'),
            'utf-8'
        );

        const graph = await adapter.generateCallGraph([
            { path: 'SimpleVault.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        expect(entrypoints.length).toBeGreaterThan(0);

        // Check for specific functions by ID
        const ids = entrypoints.map(e => e.id);
        expect(ids).toContain('SimpleVault.deposit(uint256 amount)');
        expect(ids).toContain('SimpleVault.withdraw(uint256 amount)');
        expect(ids).toContain('SimpleVault.getBalance()');

        // Should NOT contain private or internal functions
        expect(ids).not.toContain('SimpleVault._internalHelper()');
        expect(ids).not.toContain('SimpleVault.privateFunction()');
    });

    it('should extract correct visibility', async () => {
        const code = fs.readFileSync(
            path.join(__dirname, '../../fixtures/solidity/SimpleVault.sol'),
            'utf-8'
        );

        const graph = await adapter.generateCallGraph([
            { path: 'SimpleVault.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        const deposit = entrypoints.find(e => e.id === 'SimpleVault.deposit(uint256 amount)');
        expect(deposit?.visibility).toBe('external');

        const withdraw = entrypoints.find(e => e.id === 'SimpleVault.withdraw(uint256 amount)');
        expect(withdraw?.visibility).toBe('public');
    });

    it('should extract contract name', async () => {
        const code = fs.readFileSync(
            path.join(__dirname, '../../fixtures/solidity/SimpleVault.sol'),
            'utf-8'
        );

        const graph = await adapter.generateCallGraph([
            { path: 'SimpleVault.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        entrypoints.forEach(e => {
            expect(e.contract).toBe('SimpleVault');
        });
    });

    it('should assign consistent ids', async () => {
        const code = `contract Test {
    function foo() public {}
}`;

        const graph = await adapter.generateCallGraph([
            { path: 'Test.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        expect(entrypoints.length).toBe(1);
        expect(entrypoints[0].id).toBe('Test.foo()');
    });

    it('should detect contract name inside abstract contracts', async () => {
        const code = fs.readFileSync(
            path.join(__dirname, '../../fixtures/solidity/AbstractContract.sol'),
            'utf-8'
        );

        const graph = await adapter.generateCallGraph([
            { path: 'AbstractContract.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        const pendingBalance = entrypoints.find(e => e.label === 'pendingBalance');
        expect(pendingBalance).toBeDefined();
        expect(pendingBalance?.contract).toBe('BaseVault');

        const deposit = entrypoints.find(e => e.label === 'deposit');
        expect(deposit).toBeDefined();
        expect(deposit?.contract).toBe('DerivedVault');
    });

    it('should extract fallback and receive functions as entrypoints', async () => {
        const code = `
            contract Test {
                fallback() external payable {}
                receive() external payable {}
            }
        `;

        const graph = await adapter.generateCallGraph([
            { path: 'Test.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        const functionNames = entrypoints.map(e => e.label);
        expect(functionNames).toContain('fallback');
        expect(functionNames).toContain('receive');

        const fallbackFunc = entrypoints.find(e => e.label === 'fallback');
        expect(fallbackFunc?.visibility).toBe('external');

        const receiveFunc = entrypoints.find(e => e.label === 'receive');
        expect(receiveFunc?.visibility).toBe('external');
    });
    it('should normalize function signatures with extra whitespace', async () => {
        const code = `contract Test {
            function foo(
                uint256 a,
                uint256 b
            ) public {}
        }`;

        const graph = await adapter.generateCallGraph([
            { path: 'Test.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        expect(entrypoints[0].id).toBe('Test.foo(uint256 a, uint256 b)');
    });

    it('should extract complex function type parameters correctly', async () => {
        const code = `
            contract Test {
                function execute(function(uint256) external returns (uint256) callback) public {}
            }
        `;

        const graph = await adapter.generateCallGraph([
            { path: 'Test.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        const execute = entrypoints.find(e => e.label === 'execute');
        expect(execute).toBeDefined();
        expect(execute?.id).toContain('function(uint256) external returns (uint256) callback');
    });

    it('should extract multiple parameters correctly using fallback', async () => {
        const code = `
            contract Test {
                function complex(
                    uint256 a, 
                    function(uint256) external returns (uint256) cb
                ) public {}
            }
        `;

        const graph = await adapter.generateCallGraph([
            { path: 'Test.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        const complex = entrypoints.find(e => e.label === 'complex');
        expect(complex).toBeDefined();
        expect(complex?.id).toBe('Test.complex(uint256 a, function(uint256) external returns (uint256) cb)');
    });

    it('should exclude parameters from nested try-catch blocks', async () => {
        const code = `
            contract Test {
                function execute(uint256 input) public {
                    try this.something() returns (uint256 val) {
                        // success
                    } catch (bytes memory reason) {
                        // fail
                    }
                }
            }
        `;

        const graph = await adapter.generateCallGraph([
            { path: 'Test.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        const execute = entrypoints.find(e => e.label === 'execute');
        expect(execute).toBeDefined();
        expect(execute?.id).toBe('Test.execute(uint256 input)');
    });

    it('should exclude parameters from nested function definitions', async () => {
        const code = `
            contract Test {
                function execute(
                    uint256 id, 
                    function(uint256 nestedParam) external callback
                ) public {}
            }
        `;

        const graph = await adapter.generateCallGraph([
            { path: 'Test.sol', content: code }
        ]);
        const entrypoints = graph.nodes.filter(n => n.visibility === 'public' || n.visibility === 'external');

        const execute = entrypoints.find(e => e.label === 'execute');
        expect(execute).toBeDefined();
        expect(execute?.id).toBe('Test.execute(uint256 id, function(uint256 nestedParam) external callback)');
    });
});
