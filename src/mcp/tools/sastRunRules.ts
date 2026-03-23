import { z } from "zod";
import { encode } from "@toon-format/toon";
import {
    Severity, FindingKind, RuleFinding, FindingInstance,
    SymbolGraph, SupportedLanguage, RuleContext
} from "../../engine/types.js";
import { readScanState, writeScanState } from "../../static/persistence.js";
import { loadCustomRules, ruleApplies, isRule, isMapRule, AnyRule, LoadedRule } from "../../static/rule-loader.js";
import { walkShallow, walkDeep, deduplicateInstances } from "../../static/walker.js";
import { TreeSitterService } from "../../util/treeSitter.js";
import { Engine } from "../../engine/index.js";
import type { Tree } from "web-tree-sitter";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const sastRunRulesSchema = {
    description: "Run SAiST rules against an enriched symbol graph. Supports shipped and custom rules with severity filtering.",
    inputSchema: {
        scanId: z.string().describe("Scan ID from sast_init_scan"),
        ruleIds: z.array(z.string()).optional().describe("Specific rule IDs to run; omit for all applicable"),
        customRulePaths: z.array(z.string()).optional().describe("Paths to custom rule files (.ts or .js)"),
        includeSeverity: z.array(z.enum(['critical', 'high', 'medium', 'low', 'info'])).optional()
            .describe("Severity filter; omit to run all"),
        includeKind: z.array(z.enum(['issue', 'smell', 'pointer'])).optional()
            .describe("Finding kind filter; omit to run all"),
    },
};

export function createSastRunRulesHandler(shippedRules: AnyRule[], engine: Engine) {
    return async (input: {
        scanId: string;
        ruleIds?: string[];
        customRulePaths?: string[];
        includeSeverity?: Severity[];
        includeKind?: FindingKind[];
    }): Promise<CallToolResult> => {
        try {
            const state = await readScanState(input.scanId);
            if (!state) {
                return {
                    content: [{ type: "text", text: `Error: Scan ${input.scanId} not found` }],
                };
            }

            const graph = SymbolGraph.fromJSON(state.graph);
            const effective = state.effective;

            // Shipped rules are pre-loaded; custom rules are loaded on demand via tsx
            const shippedLoaded: LoadedRule[] = shippedRules.map(r => ({ rule: r, source: 'shipped' as const }));
            const customLoaded = input.customRulePaths?.length
                ? (await loadCustomRules(input.customRulePaths)).rules
                : [] as LoadedRule[];

            let applicableRules = [...shippedLoaded, ...customLoaded];

            if (input.ruleIds?.length) {
                applicableRules = applicableRules.filter(lr => input.ruleIds!.includes(lr.rule.id));
            }
            if (input.includeSeverity?.length) {
                applicableRules = applicableRules.filter(lr => input.includeSeverity!.includes(lr.rule.severity));
            }
            if (input.includeKind?.length) {
                applicableRules = applicableRules.filter(lr => input.includeKind!.includes(lr.rule.kind));
            }

            // Build sourceFiles map from persisted state
            const sourceFiles = new Map<string, string>();
            for (const [p, content] of Object.entries(state.sourceFiles ?? {})) {
                sourceFiles.set(p, content);
            }

            const treeCache = new Map<string, Tree>();
            const service = TreeSitterService.getInstance();

            const findingsByRule = new Map<string, {
                rule: AnyRule;
                source: 'shipped' | 'custom';
                instances: FindingInstance[];
            }>();

            const ranRuleIds = new Set<string>();     // regular Rules (count unique IDs across languages)
            const ranMapRuleIds = new Set<string>(); // MapRules run once per scan, not per language

            for (const lang of state.languages) {
                const meta = effective[lang];
                if (!meta) continue;

                const adapter = engine.getAdapter(lang as SupportedLanguage);
                if (!adapter) continue;

                // Compute file set for this language once — used by all shallow rules
                const langFiles = new Set<string>();
                for (const node of graph.nodes()) {
                    if (node.language === lang && node.locator) {
                        langFiles.add(node.locator.file);
                    }
                }

                let parser: any | null = null;
                const getTree = async (file: string): Promise<Tree> => {
                    if (treeCache.has(file)) return treeCache.get(file)!;
                    const src = sourceFiles.get(file);
                    if (!src) throw new Error(`Source not found for ${file}`);
                    if (!parser) parser = await service.createParser(lang as SupportedLanguage);
                    const tree = parser.parse(src);
                    if (!tree) throw new Error(`Failed to parse ${file}`);
                    treeCache.set(file, tree);
                    return tree;
                };

                const ctx: RuleContext = {
                    graph,
                    trait: adapter,
                    effective: meta,
                    sourceFiles,
                    treeCache,
                    currentFile: '',
                    getTree,
                };

                for (const { rule, source } of applicableRules) {
                    if (!ruleApplies(rule.appliesTo, meta, lang as SupportedLanguage)) continue;

                    if (isRule(rule)) {
                        ranRuleIds.add(rule.id);
                        const instances: FindingInstance[] = [];

                        if (rule.deep) {
                            // Deep walk: iterate concrete function nodes for this language
                            for (const node of graph.nodes()) {
                                if (node.kind !== 'function') continue;
                                if (node.status !== 'concrete') continue;
                                if (node.language !== lang) continue;
                                if (!node.locator) continue;
                                try {
                                    const tree = await getTree(node.locator.file);
                                    // Use byte-offset re-entry for O(log n) lookup
                                    const funcNode = tree.rootNode.descendantForIndex(
                                        node.locator.startIndex,
                                        node.locator.endIndex
                                    );
                                    if (!funcNode) continue;
                                    ctx.currentFile = node.locator.file;
                                    rule.reset();
                                    const visited = new Set<string>();
                                    visited.add(node.id);
                                    await walkDeep(node.id, funcNode, rule, ctx, visited, 0, rule.deep.maxDepth);
                                    instances.push(...rule.finalize(ctx));
                                } catch { /* skip unparseable functions */ }
                            }
                        } else {
                            // Shallow walk: iterate source files for this language
                            for (const file of langFiles) {
                                try {
                                    const tree = await getTree(file);
                                    ctx.currentFile = file;
                                    rule.reset();
                                    walkShallow(tree.rootNode, rule, ctx);
                                    instances.push(...rule.finalize(ctx));
                                } catch { /* skip unparseable files */ }
                            }
                        }

                        if (instances.length > 0) {
                            const existing = findingsByRule.get(rule.id);
                            if (existing) existing.instances.push(...instances);
                            else findingsByRule.set(rule.id, { rule, source, instances });
                        }
                    } else if (isMapRule(rule)) {
                        if (ranMapRuleIds.has(rule.id)) continue;
                        ranMapRuleIds.add(rule.id);
                        const instances = rule.check(graph, ctx);
                        if (instances.length > 0) {
                            const existing = findingsByRule.get(rule.id);
                            if (existing) existing.instances.push(...instances);
                            else findingsByRule.set(rule.id, { rule, source, instances });
                        }
                    }
                }
            }

            const findings: RuleFinding[] = [];
            for (const [ruleId, { rule, source, instances }] of findingsByRule) {
                const deduped = deduplicateInstances(instances);
                if (deduped.length === 0) continue;
                findings.push({
                    ruleId,
                    ruleSource: source,
                    severity: rule.severity,
                    kind: rule.kind,
                    title: rule.title,
                    description: rule.description,
                    confidence: rule.kind === 'pointer' ? 'low' : 'high',
                    resolvedBy: 'static',
                    instances: deduped,
                });
            }

            state.findings = [...state.findings, ...findings];
            state.status = 'complete';
            state.updatedAt = new Date().toISOString();
            await writeScanState(state);

            const rulesRun = ranRuleIds.size + ranMapRuleIds.size;
            const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
            const byKind: Record<FindingKind, number> = { issue: 0, smell: 0, pointer: 0 };
            for (const f of findings) {
                bySeverity[f.severity]++;
                byKind[f.kind]++;
            }

            // Strip snippets — agent can read the file at the reported location
            const leanFindings = findings.map(f => ({
                ...f,
                instances: f.instances.map(({ location, executionPath }) => ({
                    location,
                    ...(executionPath?.length ? { executionPath } : {}),
                })),
            }));

            return {
                content: [{
                    type: "text",
                    text: encode({
                        scanId: input.scanId,
                        findings: leanFindings,
                        summary: { bySeverity, byKind, rulesRun },
                    }),
                }],
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Error running rules: ${error instanceof Error ? error.message : String(error)}`,
                }],
            };
        }
    };
}
