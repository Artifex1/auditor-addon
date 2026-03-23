import { describe, it, expect } from 'vitest';
import { SolidityAdapter } from '../../../src/languages/solidityAdapter.js';
import { FileContent } from '../../../src/engine/types.js';
import { detectGaps } from '../../../src/static/symbol-table.js';

describe('Solidity gap detection (integration)', () => {
    const adapter = new SolidityAdapter();

    async function getGaps(code: string, filePath = '/test.sol') {
        const files: FileContent[] = [{ path: filePath, content: code }];
        const graph = await adapter.generateGraph(files);
        return { gaps: detectGaps(graph), graph };
    }

    it('produces no gaps when all calls resolve internally', async () => {
        const code = `
            contract Vault {
                function deposit() external {
                    _validate();
                }
                function _validate() internal {}
            }
        `;
        const { gaps } = await getGaps(code);
        expect(gaps).toHaveLength(0);
    });

    it('produces a gap for an unresolved simple call (out-of-scope function)', async () => {
        const code = `
            contract Vault {
                function compute(bytes memory data) external pure returns (bytes32) {
                    return _hashData(data);
                }
            }
        `;
        const { gaps } = await getGaps(code);
        // _hashData is called but not defined anywhere in scope
        expect(gaps.length).toBeGreaterThanOrEqual(1);
        const gap = gaps.find(g => g.qualifiedName.includes('_hashData'));
        expect(gap).toBeDefined();
        expect(gap!.type).toBe('unresolved_callee');
    });

    it('produces a gap for an interface method call via state variable', async () => {
        const code = `
            interface IERC20 {
                function transfer(address to, uint256 amount) external returns (bool);
            }

            contract Vault {
                IERC20 public token;

                function withdraw(address to, uint256 amount) external {
                    token.transfer(to, amount);
                }
            }
        `;
        const { gaps } = await getGaps(code);
        // token.transfer resolves to the interface — but token is a variable,
        // not a contract name. The adapter can't resolve the concrete target.
        expect(gaps.length).toBeGreaterThanOrEqual(1);
        const gap = gaps.find(g => g.qualifiedName.includes('transfer'));
        expect(gap).toBeDefined();
    });

    it('produces a gap for a call to an inherited function from an out-of-scope parent', async () => {
        const code = `
            contract Child is MissingParent {
                function doWork() external {
                    parentFunction();
                }
            }
        `;
        const { gaps } = await getGaps(code);
        // MissingParent is not in scope — parentFunction() cannot be resolved
        expect(gaps.length).toBeGreaterThanOrEqual(1);
        const gap = gaps.find(g => g.qualifiedName.includes('parentFunction'));
        expect(gap).toBeDefined();
    });

    it('does NOT gap an inherited call when parent IS in scope', async () => {
        const code = `
            contract Parent {
                function parentFunction() public {}
            }

            contract Child is Parent {
                function doWork() external {
                    parentFunction();
                }
            }
        `;
        const { gaps } = await getGaps(code);
        expect(gaps).toHaveLength(0);
    });

    it('produces a gap for an external library call not in scope', async () => {
        const code = `
            contract Vault {
                function hash(bytes memory data) external pure returns (bytes32) {
                    return Utils.keccak(data);
                }
            }
        `;
        const { gaps } = await getGaps(code);
        // Utils is not defined in scope
        expect(gaps.length).toBeGreaterThanOrEqual(1);
        const gap = gaps.find(g => g.qualifiedName.includes('keccak'));
        expect(gap).toBeDefined();
    });

    it('gap callSite points to the caller function', async () => {
        const code = `
            contract Vault {
                function withdraw() external {
                    externalCall();
                }
            }
        `;
        const { gaps } = await getGaps(code);
        expect(gaps.length).toBeGreaterThanOrEqual(1);
        expect(gaps[0].callSite.file).toBe('/test.sol');
        expect(gaps[0].callSite.line).toBeGreaterThan(0);
    });
});
