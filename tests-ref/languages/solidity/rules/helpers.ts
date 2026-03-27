import { SolidityAdapter } from '../../../../src/languages/solidityAdapter.js';
import { TreeSitterService } from '../../../../src/util/treeSitter.js';
import { walkShallow, walkDeep } from '../../../../src/static/walker.js';
import type { RuleContext, SymbolGraph, FindingInstance, FileContent, Rule, MapRule } from '../../../../src/engine/types.js';
import type { Tree } from 'web-tree-sitter';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { expect } from 'vitest';

export async function buildContext(
    sources: Record<string, string>,
): Promise<{ ctx: RuleContext; graph: SymbolGraph }> {
    const adapter = new SolidityAdapter();
    const files: FileContent[] = Object.entries(sources).map(([path, content]) => ({ path, content }));
    const graph = await adapter.generateGraph(files);

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
            graph,
            trait: adapter,
            effective: { domain: 'on-chain', inheritanceModel: 'classical' },
            sourceFiles,
            treeCache,
            currentFile: '',
            getTree,
        },
        graph,
    };
}

export async function runRule(
    ctx: RuleContext,
    file: string,
    rule: Rule,
): Promise<FindingInstance[]> {
    const tree = await ctx.getTree(file);
    ctx.currentFile = file;
    rule.reset();
    walkShallow(tree.rootNode, rule, ctx);
    return rule.finalize(ctx);
}

export async function runDeepRuleOnFunction(
    ctx: RuleContext,
    graph: SymbolGraph,
    funcLabel: string,
    rule: Rule,
): Promise<FindingInstance[]> {
    const node = [...graph.nodes()].find(n => n.label === funcLabel)!;
    expect(node).toBeDefined();
    expect(node.locator).toBeDefined();
    const tree = await ctx.getTree(node.locator!.file);
    const funcNode = tree.rootNode.descendantForIndex(
        node.locator!.startIndex,
        node.locator!.endIndex
    );
    expect(funcNode).not.toBeNull();
    ctx.currentFile = node.locator!.file;
    rule.reset();
    const visited = new Set<string>([node.id]);
    await walkDeep(node.id, funcNode!, rule, ctx, visited, 0, rule.deep!.maxDepth);
    return rule.finalize(ctx);
}

export async function runMapRule(
    ctx: RuleContext,
    graph: SymbolGraph,
    rule: MapRule,
): Promise<FindingInstance[]> {
    return rule.check(graph, ctx);
}
