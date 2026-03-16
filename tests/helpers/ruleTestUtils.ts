import { TreeSitterService } from '../../src/util/treeSitter.js';
import { walkShallow } from '../../src/static/walker.js';
import type {
    RuleContext, SymbolMap, FindingInstance, FileContent, Rule, MapRule,
    LanguageAdapter, SupportedLanguage, EffectiveLanguageMeta,
} from '../../src/engine/types.js';
import { LANGUAGE_META } from '../../src/engine/types.js';
import type { Tree } from 'web-tree-sitter';

export async function buildContextForAdapter(
    adapter: LanguageAdapter,
    lang: SupportedLanguage,
    sources: Record<string, string>,
): Promise<{ ctx: RuleContext; symbolMap: SymbolMap }> {
    const files: FileContent[] = Object.entries(sources).map(([path, content]) => ({ path, content }));
    const symbolMap = await adapter.generateSymbolMap(files);

    const service = TreeSitterService.getInstance();
    const treeCache = new Map<string, Tree>();
    const sourceFiles = new Map<string, string>(Object.entries(sources));
    const meta = LANGUAGE_META[lang];
    const effective: EffectiveLanguageMeta = {
        domain: meta.domain,
        inheritanceModel: meta.inheritanceModel,
    };

    const getTree = async (file: string): Promise<Tree> => {
        if (treeCache.has(file)) return treeCache.get(file)!;
        const parser = await service.createParser(lang);
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
            effective,
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

export async function runMapRule(
    ctx: RuleContext,
    symbolMap: SymbolMap,
    rule: MapRule,
): Promise<FindingInstance[]> {
    return rule.check(symbolMap, ctx);
}
