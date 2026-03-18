import { z } from "zod";
import { encode } from "@toon-format/toon";
import {
    Severity, FindingKind, RuleFinding, FindingInstance, Rule, MapRule,
    SupportedLanguage, RuleContext
} from "../../engine/types.js";
import { readScanState, writeScanState, recordToSymbolMap } from "../../static/persistence.js";
import { loadCustomRules, ruleApplies, AnyRule, LoadedRule } from "../../static/rule-loader.js";
import { walkShallow, walkDeep, deduplicateInstances } from "../../static/walker.js";
import { TreeSitterService } from "../../util/treeSitter.js";
import { Engine } from "../../engine/index.js";
import type { Tree, Node, Parser } from "web-tree-sitter";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const sastRunRulesSchema = {
    description: "Run SAiST rules against an enriched symbol map. Supports shipped and custom rules with severity filtering.",
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

function isRule(rule: AnyRule): rule is Rule {
    return 'finalize' in rule && typeof (rule as any).finalize === 'function';
}

function isMapRule(rule: AnyRule): rule is MapRule {
    return 'check' in rule && typeof (rule as any).check === 'function' && !('finalize' in rule);
}

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

            const symbolMap = recordToSymbolMap(state.symbolMap);
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

            let rulesRun = 0;

            for (const lang of state.languages) {
                const meta = effective[lang];
                if (!meta) continue;

                const adapter = engine.getAdapter(lang as SupportedLanguage);
                if (!adapter) continue;

                let parser: Parser | null = null;
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
                    symbolMap,
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
                        rulesRun++;
                        const instances: FindingInstance[] = [];

                        if (rule.deep) {
                            for (const [_qn, entry] of symbolMap) {
                                if (entry.language !== lang) continue;
                                if (!entry.range) continue;
                                try {
                                    const tree = await getTree(entry.file);
                                    const funcNode = findNodeAt(tree.rootNode, entry.range.start.line - 1, entry.range.start.column);
                                    if (!funcNode) continue;
                                    ctx.currentFile = entry.file;
                                    rule.reset();
                                    const visited = new Set<string>();
                                    visited.add(entry.qualifiedName);
                                    await walkDeep(funcNode, rule, ctx, visited, 0, rule.deep.maxDepth);
                                    instances.push(...rule.finalize(ctx));
                                } catch { /* skip unparseable functions */ }
                            }
                        } else {
                            const langFiles = [...sourceFiles.entries()].filter(([p]) =>
                                [...symbolMap.values()].some(e => e.file === p && e.language === lang)
                            );
                            for (const [file] of langFiles) {
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
                        rulesRun++;
                        const instances = rule.check(symbolMap, ctx);
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
