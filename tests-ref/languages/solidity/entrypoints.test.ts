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
            path.join(__dirname, 'fixtures/SimpleVault.sol'),
            'utf-8'
        );

        const graph = await adapter.generateGraph([
            { path: 'SimpleVault.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

        expect(entrypoints.length).toBeGreaterThan(0);

        // Check for specific functions by qualifiedName
        const ids = entrypoints.map(e => e.qualifiedName);
        expect(ids).toContain('SimpleVault.deposit(uint256 amount)');
        expect(ids).toContain('SimpleVault.withdraw(uint256 amount)');
        expect(ids).toContain('SimpleVault.getBalance()');

        // Should NOT contain private or internal functions
        expect(ids).not.toContain('SimpleVault._internalHelper()');
        expect(ids).not.toContain('SimpleVault.privateFunction()');
    });

    it('should extract correct visibility', async () => {
        const code = fs.readFileSync(
            path.join(__dirname, 'fixtures/SimpleVault.sol'),
            'utf-8'
        );

        const graph = await adapter.generateGraph([
            { path: 'SimpleVault.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

        const deposit = entrypoints.find(e => e.qualifiedName === 'SimpleVault.deposit(uint256 amount)');
        expect(deposit?.visibility).toBe('external');

        const withdraw = entrypoints.find(e => e.qualifiedName === 'SimpleVault.withdraw(uint256 amount)');
        expect(withdraw?.visibility).toBe('public');
    });

    it('should extract contract name', async () => {
        const code = fs.readFileSync(
            path.join(__dirname, 'fixtures/SimpleVault.sol'),
            'utf-8'
        );

        const graph = await adapter.generateGraph([
            { path: 'SimpleVault.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

        entrypoints.forEach(e => {
            expect(graph.getContainerOf(e.id)?.label).toBe('SimpleVault');
        });
    });

    it('should assign consistent ids', async () => {
        const code = `contract Test {
    function foo() public {}
}`;

        const graph = await adapter.generateGraph([
            { path: 'Test.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

        expect(entrypoints.length).toBe(1);
        expect(entrypoints[0].qualifiedName).toBe('Test.foo()');
    });

    it('should detect contract name inside abstract contracts', async () => {
        const code = fs.readFileSync(
            path.join(__dirname, 'fixtures/AbstractContract.sol'),
            'utf-8'
        );

        const graph = await adapter.generateGraph([
            { path: 'AbstractContract.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

        const pendingBalance = entrypoints.find(e => e.label === 'pendingBalance');
        expect(pendingBalance).toBeDefined();
        expect(graph.getContainerOf(pendingBalance!.id)?.label).toBe('BaseVault');

        const deposit = entrypoints.find(e => e.label === 'deposit');
        expect(deposit).toBeDefined();
        expect(graph.getContainerOf(deposit!.id)?.label).toBe('DerivedVault');
    });

    it('should extract fallback and receive functions as entrypoints', async () => {
        const code = `
            contract Test {
                fallback() external payable {}
                receive() external payable {}
            }
        `;

        const graph = await adapter.generateGraph([
            { path: 'Test.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

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

        const graph = await adapter.generateGraph([
            { path: 'Test.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

        expect(entrypoints[0].qualifiedName).toBe('Test.foo(uint256 a, uint256 b)');
    });

    it('should extract complex function type parameters correctly', async () => {
        const code = `
            contract Test {
                function execute(function(uint256) external returns (uint256) callback) public {}
            }
        `;

        const graph = await adapter.generateGraph([
            { path: 'Test.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

        const execute = entrypoints.find(e => e.label === 'execute');
        expect(execute).toBeDefined();
        expect(execute?.qualifiedName).toContain('function(uint256) external returns (uint256) callback');
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

        const graph = await adapter.generateGraph([
            { path: 'Test.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

        const complex = entrypoints.find(e => e.label === 'complex');
        expect(complex).toBeDefined();
        expect(complex?.qualifiedName).toBe('Test.complex(uint256 a, function(uint256) external returns (uint256) cb)');
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

        const graph = await adapter.generateGraph([
            { path: 'Test.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

        const execute = entrypoints.find(e => e.label === 'execute');
        expect(execute).toBeDefined();
        expect(execute?.qualifiedName).toBe('Test.execute(uint256 input)');
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

        const graph = await adapter.generateGraph([
            { path: 'Test.sol', content: code }
        ]);
        const functions = [...graph.nodes()].filter(e => e.kind === 'function');
        const entrypoints = functions.filter(e => e.visibility === 'public' || e.visibility === 'external');

        const execute = entrypoints.find(e => e.label === 'execute');
        expect(execute).toBeDefined();
        expect(execute?.qualifiedName).toBe('Test.execute(uint256 id, function(uint256 nestedParam) external callback)');
    });
});
