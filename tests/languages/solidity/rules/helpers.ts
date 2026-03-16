import { SolidityAdapter } from '../../../../src/languages/solidityAdapter.js';
import { TreeSitterService } from '../../../../src/util/treeSitter.js';
import { walkShallow, walkDeep, findNodeAt } from '../../../../src/static/walker.js';
import type { RuleContext, SymbolMap, FindingInstance, FileContent, Rule, MapRule } from '../../../../src/engine/types.js';
import type { Tree } from 'web-tree-sitter';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { expect } from 'vitest';

export async function buildContext(
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
    symbolMap: SymbolMap,
    funcLabel: string,
    rule: Rule,
): Promise<FindingInstance[]> {
    const entry = [...symbolMap.values()].find(e => e.label === funcLabel)!;
    expect(entry).toBeDefined();
    const tree = await ctx.getTree(entry.file);
    const funcNode = findNodeAt(tree.rootNode, entry.range!.start.line - 1, entry.range!.start.column)!;
    expect(funcNode).not.toBeNull();
    ctx.currentFile = entry.file;
    rule.reset();
    const visited = new Set<string>([entry.qualifiedName]);
    await walkDeep(funcNode, rule, ctx, visited, 0, rule.deep!.maxDepth);
    return rule.finalize(ctx);
}

export async function runMapRule(
    ctx: RuleContext,
    symbolMap: SymbolMap,
    rule: MapRule,
): Promise<FindingInstance[]> {
    return rule.check(symbolMap, ctx);
}
