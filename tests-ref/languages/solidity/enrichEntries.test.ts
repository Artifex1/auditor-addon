import { describe, it, expect } from 'vitest';
import { SolidityAdapter } from '../../../src/languages/solidityAdapter.js';
import type { FileContent } from '../../../src/engine/types.js';

describe('enrichEntries via generateGraph', () => {
    it('populates writes edges for state writes', async () => {
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

        const graph = await adapter.generateGraph(files);
        const node = [...graph.nodes()].find(e => e.label === 'setX')!;
        expect(node).toBeDefined();
        const writesEdges = graph.getOutEdgesOfKind(node.id, 'writes');
        expect(writesEdges.length).toBeGreaterThan(0);
        const writeTargets = writesEdges.map(e => graph.getNode(e.to)?.label);
        expect(writeTargets).toContain('x');
    });

    it('populates reads edges for state reads', async () => {
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

        const graph = await adapter.generateGraph(files);
        const node = [...graph.nodes()].find(e => e.label === 'getX')!;
        expect(node).toBeDefined();
        const readsEdges = graph.getOutEdgesOfKind(node.id, 'reads');
        expect(readsEdges.length).toBeGreaterThan(0);
    });

    it('populates has_modifier edges via getModifiers', async () => {
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

        const graph = await adapter.generateGraph(files);
        const node = [...graph.nodes()].find(e => e.label === 'restricted')!;
        expect(node).toBeDefined();
        const modEdges = graph.getOutEdgesOfKind(node.id, 'has_modifier');
        expect(modEdges.length).toBeGreaterThan(0);
        const modNode = graph.getNode(modEdges[0].to);
        expect(modNode?.label).toBe('onlyOwner');
        expect(modNode?.pattern).toBe('explicit');
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

        const graph = await adapter.generateGraph(files);
        const node = [...graph.nodes()].find(e => e.label === 'setX')!;
        // writes edges should have no duplicates (same from+to pair)
        const writesEdges = graph.getOutEdgesOfKind(node.id, 'writes');
        const edgeKeys = writesEdges.map(e => `${e.from}->${e.to}`);
        const unique = new Set(edgeKeys);
        expect(unique.size).toBe(edgeKeys.length);
    });
});
