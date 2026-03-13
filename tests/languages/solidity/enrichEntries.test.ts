import { describe, it, expect } from 'vitest';
import { SolidityAdapter } from '../../../src/languages/solidityAdapter.js';
import type { FileContent } from '../../../src/engine/types.js';

describe('enrichEntries via generateSymbolMap', () => {
    it('populates writesState for state writes', async () => {
        const adapter = new SolidityAdapter();
        const files: FileContent[] = [{
            path: '/test.sol',
            content: `
contract Foo {
    uint x;
    function setX(uint val) external {
        x = val;
    }
}`,
        }];

        const symbolMap = await adapter.generateSymbolMap(files);
        const entry = [...symbolMap.values()].find(e => e.label === 'setX')!;
        expect(entry).toBeDefined();
        expect(entry.writesState.length).toBeGreaterThan(0);
        expect(entry.writesState).toContain('x');
    });

    it('populates readsState for state reads', async () => {
        const adapter = new SolidityAdapter();
        const files: FileContent[] = [{
            path: '/test.sol',
            content: `
contract Foo {
    uint x;
    function getX() external view returns (uint) {
        return x;
    }
}`,
        }];

        const symbolMap = await adapter.generateSymbolMap(files);
        const entry = [...symbolMap.values()].find(e => e.label === 'getX')!;
        expect(entry).toBeDefined();
        expect(entry.readsState.length).toBeGreaterThan(0);
    });

    it('populates modifiers via getModifiers', async () => {
        const adapter = new SolidityAdapter();
        const files: FileContent[] = [{
            path: '/test.sol',
            content: `
contract Foo {
    address owner;
    modifier onlyOwner() { require(msg.sender == owner); _; }
    function restricted() external onlyOwner {
        owner = msg.sender;
    }
}`,
        }];

        const symbolMap = await adapter.generateSymbolMap(files);
        const entry = [...symbolMap.values()].find(e => e.label === 'restricted')!;
        expect(entry).toBeDefined();
        expect(entry.modifiers.length).toBeGreaterThan(0);
        expect(entry.modifiers[0].name).toBe('onlyOwner');
        expect(entry.modifiers[0].pattern).toBe('explicit');
        expect(entry.hasAccessControl).toBe(true);
    });

    it('does not duplicate writes already set by buildSymbolTable', async () => {
        const adapter = new SolidityAdapter();
        const files: FileContent[] = [{
            path: '/test.sol',
            content: `
contract Foo {
    uint x;
    function setX(uint val) external {
        x = val;
    }
}`,
        }];

        const symbolMap = await adapter.generateSymbolMap(files);
        const entry = [...symbolMap.values()].find(e => e.label === 'setX')!;
        // writesState should have no duplicates
        const unique = new Set(entry.writesState);
        expect(unique.size).toBe(entry.writesState.length);
    });
});
