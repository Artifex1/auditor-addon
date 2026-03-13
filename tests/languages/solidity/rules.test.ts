import { describe, it, expect } from 'vitest';
import { SolidityAdapter } from '../../../src/languages/solidityAdapter.js';
import { TreeSitterService } from '../../../src/util/treeSitter.js';
import { walkPath, initialPhaseState } from '../../../src/static/walker.js';
import type { RuleContext, SymbolMap, FindingInstance, FileContent } from '../../../src/engine/types.js';
import type { Tree, Node } from 'web-tree-sitter';
import uncheckedCallRule from '../../../src/static/rules/SOL-001-unchecked-call.js';
import reentrancyRule from '../../../src/static/rules/SOL-002-reentrancy.js';
import { SupportedLanguage } from '../../../src/engine/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildContext(
    sources: Record<string, string>,
): Promise<{ ctx: RuleContext; symbolMap: SymbolMap }> {
    const adapter = new SolidityAdapter();
    const files: FileContent[] = Object.entries(sources).map(([path, content]) => ({ path, content }));
    const symbolMap = await adapter.generateSymbolMap(files);

    const service = TreeSitterService.getInstance();
    const treeCache = new Map<string, Tree>();
    const sourceFiles = new Map<string, string>(Object.entries(sources));

    const getTree = async (file: string): Promise<Tree> => {
        if (treeCache.has(file)) return treeCache.get(file)!;
        const parser = await service.createParser(SupportedLanguage.Solidity);
        const src = sourceFiles.get(file);
        if (!src) throw new Error(`Source not found: ${file}`);
        const tree = parser.parse(src);
        if (!tree) throw new Error(`Parse failed: ${file}`);
        treeCache.set(file, tree);
        return tree;
    };

    return {
        ctx: {
            symbolMap,
            trait: adapter,
            effective: { domain: 'on-chain', inheritanceModel: 'classical' },
            sourceFiles,
            treeCache,
            currentFile: '',
            getTree,
        },
        symbolMap,
    };
}

function findNodeAt(root: Node, row: number, col: number): Node | null {
    if (root.startPosition.row === row && root.startPosition.column === col) return root;
    for (const child of root.children) {
        if (child.startPosition.row > row) break;
        if (child.endPosition.row < row) continue;
        const found = findNodeAt(child, row, col);
        if (found) return found;
    }
    return null;
}

function walkAllNodes(node: Node, cb: (n: Node) => void): void {
    cb(node);
    for (const child of node.children) walkAllNodes(child, cb);
}

async function runNarrowRule(
    ctx: RuleContext,
    file: string,
    rule: typeof uncheckedCallRule,
): Promise<FindingInstance[]> {
    const tree = await ctx.getTree(file);
    ctx.currentFile = file;
    const instances: FindingInstance[] = [];
    walkAllNodes(tree.rootNode, (node) => {
        const inst = rule.check(ctx, node);
        if (inst) instances.push(inst);
    });
    return instances;
}

async function runPathRuleOnFunction(
    ctx: RuleContext,
    symbolMap: SymbolMap,
    funcLabel: string,
    rule: typeof reentrancyRule,
): Promise<FindingInstance | null> {
    const entry = [...symbolMap.values()].find(e => e.label === funcLabel)!;
    expect(entry).toBeDefined();
    const tree = await ctx.getTree(entry.file);
    const funcNode = findNodeAt(tree.rootNode, entry.range!.start.line - 1, entry.range!.start.column)!;
    expect(funcNode).not.toBeNull();
    ctx.currentFile = entry.file;
    const visited = new Set<string>([entry.qualifiedName]);
    const result = await walkPath(funcNode, rule, initialPhaseState(), ctx, visited, 0);
    return result.finding;
}

// ---------------------------------------------------------------------------
// SOL-001: Unchecked Low-Level Call
// ---------------------------------------------------------------------------

describe('SOL-001: Unchecked Low-Level Call', () => {
    it('detects unchecked .call()', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function bad() external {
        address(this).call("");
    }
}`,
        });

        const instances = await runNarrowRule(ctx, '/test.sol', uncheckedCallRule);
        expect(instances).toHaveLength(1);
        expect(instances[0].location.file).toBe('/test.sol');
        expect(instances[0].snippet).toContain('call');
    });

    it('does not flag checked .call() with assignment', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function safe() external {
        (bool ok, ) = address(this).call("");
        require(ok);
    }
}`,
        });

        const instances = await runNarrowRule(ctx, '/test.sol', uncheckedCallRule);
        expect(instances).toHaveLength(0);
    });

    it('detects unchecked .send()', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function bad() external {
        payable(msg.sender).send(1 ether);
    }
}`,
        });

        const instances = await runNarrowRule(ctx, '/test.sol', uncheckedCallRule);
        expect(instances).toHaveLength(1);
    });

    it('detects multiple unchecked calls in one contract', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function a() external {
        address(this).call("");
    }
    function b() external {
        address(this).delegatecall("");
    }
}`,
        });

        const instances = await runNarrowRule(ctx, '/test.sol', uncheckedCallRule);
        expect(instances).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// SOL-002: Reentrancy — State Write After External Call
// ---------------------------------------------------------------------------

describe('SOL-002: Reentrancy', () => {
    it('detects state write after external call in same function', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Vault {
    mapping(address => uint) balances;
    function withdraw(uint amount) external {
        msg.sender.call{value: amount}("");
        balances[msg.sender] -= amount;
    }
}`,
        });

        const finding = await runPathRuleOnFunction(ctx, symbolMap, 'withdraw', reentrancyRule);
        expect(finding).not.toBeNull();
        expect(finding!.snippet).toContain('state write');
        expect(finding!.executionPath).toBeDefined();
        expect(finding!.executionPath!.length).toBe(2);
    });

    it('does not flag when state write is before external call', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Vault {
    mapping(address => uint) balances;
    function withdraw(uint amount) external {
        balances[msg.sender] -= amount;
        msg.sender.call{value: amount}("");
    }
}`,
        });

        const finding = await runPathRuleOnFunction(ctx, symbolMap, 'withdraw', reentrancyRule);
        expect(finding).toBeNull();
    });

    it('detects reentrancy across functions — external call in callee, write in caller', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Vault {
    mapping(address => uint) balances;

    function withdraw(uint amount) external {
        _sendFunds(msg.sender, amount);
        balances[msg.sender] -= amount;
    }

    function _sendFunds(address to, uint amount) internal {
        to.call{value: amount}("");
    }
}`,
        });

        const finding = await runPathRuleOnFunction(ctx, symbolMap, 'withdraw', reentrancyRule);
        expect(finding).not.toBeNull();
        expect(finding!.executionPath!.length).toBe(2);
    });

    it('detects reentrancy across 3 functions — deep call chain', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Vault {
    mapping(address => uint) balances;

    function withdraw(uint amount) external {
        _process(msg.sender, amount);
        balances[msg.sender] -= amount;
    }

    function _process(address to, uint amount) internal {
        _doTransfer(to, amount);
    }

    function _doTransfer(address to, uint amount) internal {
        to.call{value: amount}("");
    }
}`,
        });

        const finding = await runPathRuleOnFunction(ctx, symbolMap, 'withdraw', reentrancyRule);
        expect(finding).not.toBeNull();
    });

    it('detects reentrancy across two files', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/vault.sol': `
contract Vault {
    mapping(address => uint) balances;

    function withdraw(uint amount) external {
        _sendFunds(msg.sender, amount);
        balances[msg.sender] -= amount;
    }
}`,
            '/sender.sol': `
contract Sender {
    function _sendFunds(address to, uint amount) internal {
        to.call{value: amount}("");
    }
}`,
        });

        const finding = await runPathRuleOnFunction(ctx, symbolMap, 'withdraw', reentrancyRule);
        expect(finding).not.toBeNull();
    });

    it('does not flag when no external call in the chain', async () => {
        const { ctx, symbolMap } = await buildContext({
            '/test.sol': `
contract Vault {
    mapping(address => uint) balances;
    uint total;

    function update(uint amount) external {
        _compute(amount);
        balances[msg.sender] = amount;
    }

    function _compute(uint amount) internal pure returns (uint) {
        return amount * 2;
    }
}`,
        });

        const finding = await runPathRuleOnFunction(ctx, symbolMap, 'update', reentrancyRule);
        expect(finding).toBeNull();
    });
});
