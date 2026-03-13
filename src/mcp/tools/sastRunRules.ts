import { z } from "zod";
import { encode } from "@toon-format/toon";
import {
    Severity, RuleFinding, FindingInstance, PathRule, NarrowRule,
    SupportedLanguage, RuleContext, EffectiveLanguageMeta
} from "../../engine/types.js";
import { readScanState, writeScanState, recordToSymbolMap } from "../../static/persistence.js";
import { loadShippedRules, loadCustomRules, ruleApplies, AnyRule, LoadedRule } from "../../static/rule-loader.js";
import { walkPath, initialPhaseState, deduplicateInstances } from "../../static/walker.js";
import { TreeSitterService } from "../../util/treeSitter.js";
import type { Tree, Node, Parser } from "web-tree-sitter";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const sastRunRulesSchema = {
    description: "Run SAiST rules against an enriched symbol map. Supports shipped and custom rules with severity filtering.",
    inputSchema: {
        scanId: z.string().describe("Scan ID from sast_init_scan"),
        ruleIds: z.array(z.string()).optional().describe("Specific shipped rule IDs to run; omit for all applicable"),
        customRulePaths: z.array(z.string()).optional().describe("Absolute paths to custom .ts rule files"),
        includeSeverity: z.array(z.enum(['critical', 'high', 'medium', 'low', 'info'])).optional()
            .describe("Severity filter; omit to run all"),
    },
};

function isPathRule(rule: AnyRule): rule is PathRule {
    return typeof rule === 'object' && rule !== null && 'phases' in rule;
}

function isNarrowRule(rule: AnyRule): rule is NarrowRule {
    return typeof rule === 'object' && rule !== null && 'check' in rule && typeof (rule as any).check === 'function';
}

export function createSastRunRulesHandler(shippedRuleDir?: string) {
    return async (input: {
        scanId: string;
        ruleIds?: string[];
        customRulePaths?: string[];
        includeSeverity?: Severity[];
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

            // Load rules
            const shipped = shippedRuleDir
                ? await loadShippedRules(shippedRuleDir)
                : { rules: [] as LoadedRule[], failed: [] as string[] };

            const custom = input.customRulePaths?.length
                ? await loadCustomRules(input.customRulePaths)
                : { rules: [] as LoadedRule[], failed: [] as string[] };

            const allRules = [...shipped.rules, ...custom.rules];

            // Filter by ruleIds if specified
            let applicableRules = allRules;
            if (input.ruleIds?.length) {
                applicableRules = allRules.filter(lr => {
                    const id = isPathRule(lr.rule) ? lr.rule.id : (lr.rule as NarrowRule).id;
                    return input.ruleIds!.includes(id);
                });
            }

            // Filter by severity
            if (input.includeSeverity?.length) {
                applicableRules = applicableRules.filter(lr => {
                    const sev = isPathRule(lr.rule) ? lr.rule.severity : (lr.rule as NarrowRule).severity;
                    return input.includeSeverity!.includes(sev);
                });
            }

            // Build sourceFiles map from persisted state
            const sourceFiles = new Map<string, string>();
            for (const [path, content] of Object.entries(state.sourceFiles ?? {})) {
                sourceFiles.set(path, content);
            }

            // Lazy tree cache
            const treeCache = new Map<string, Tree>();
            const service = TreeSitterService.getInstance();

            // Collect findings grouped by ruleId
            const findingsByRule = new Map<string, {
                rule: PathRule | NarrowRule;
                source: 'shipped' | 'custom';
                instances: FindingInstance[];
            }>();

            let rulesRun = 0;

            for (const lang of state.languages) {
                const meta = effective[lang];
                if (!meta) continue;

                // Build RuleContext for this language
                let parser: Parser | null = null;

                const getTree = async (file: string): Promise<Tree> => {
                    if (treeCache.has(file)) return treeCache.get(file)!;
                    const src = sourceFiles.get(file);
                    if (!src) throw new Error(`Source not found for ${file}`);
                    if (!parser) {
                        parser = await service.createParser(lang as SupportedLanguage);
                    }
                    const tree = parser.parse(src);
                    if (!tree) throw new Error(`Failed to parse ${file}`);
                    treeCache.set(file, tree);
                    return tree;
                };

                // Get the adapter for this language
                const { Engine } = await import("../../engine/index.js");
                const engine = new Engine();
                const adapter = engine.getAdapter(lang as SupportedLanguage);
                if (!adapter) continue;

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
                    if (isPathRule(rule)) {
                        if (!ruleApplies(rule.appliesTo, meta, lang as SupportedLanguage)) continue;
                        rulesRun++;

                        // Run PathRule from every function in the symbolMap for this language
                        const instances: FindingInstance[] = [];
                        for (const [_qn, entry] of symbolMap) {
                            if (entry.language !== lang) continue;
                            if (!entry.range) continue;

                            try {
                                const tree = await getTree(entry.file);
                                const funcNode = findNodeAt(tree.rootNode, entry.range.start.line - 1, entry.range.start.column);
                                if (!funcNode) continue;

                                ctx.currentFile = entry.file;
                                const visited = new Set<string>();
                                visited.add(entry.qualifiedName);
                                const result = await walkPath(funcNode, rule, initialPhaseState(), ctx, visited, 0);
                                if (result.finding) instances.push(result.finding);
                            } catch {
                                // Skip functions we can't parse
                            }
                        }

                        if (instances.length > 0) {
                            const existing = findingsByRule.get(rule.id);
                            if (existing) {
                                existing.instances.push(...instances);
                            } else {
                                findingsByRule.set(rule.id, { rule, source, instances });
                            }
                        }
                    } else if (isNarrowRule(rule)) {
                        const narrowRule = rule as NarrowRule;
                        if (!ruleApplies(narrowRule.appliesTo, meta, lang as SupportedLanguage)) continue;
                        rulesRun++;

                        // NarrowRule: walk all nodes in all files for this language
                        const instances: FindingInstance[] = [];
                        const langFiles = [...sourceFiles.entries()].filter(([path]) => {
                            // Match files that belong to entries of this language
                            return [...symbolMap.values()].some(e => e.file === path && e.language === lang);
                        });

                        for (const [file] of langFiles) {
                            try {
                                const tree = await getTree(file);
                                ctx.currentFile = file;
                                walkAllNodes(tree.rootNode, (node) => {
                                    const inst = narrowRule.check(ctx, node);
                                    if (inst) instances.push(inst);
                                });
                            } catch {
                                // Skip unparseable files
                            }
                        }

                        if (instances.length > 0) {
                            const existing = findingsByRule.get(narrowRule.id);
                            if (existing) {
                                existing.instances.push(...instances);
                            } else {
                                findingsByRule.set(narrowRule.id, { rule: narrowRule, source, instances });
                            }
                        }
                    }
                }
            }

            // Build grouped, deduplicated findings
            const findings: RuleFinding[] = [];
            for (const [ruleId, { rule, source, instances }] of findingsByRule) {
                const deduped = deduplicateInstances(instances);
                if (deduped.length === 0) continue;

                const r = isPathRule(rule) ? rule : rule as NarrowRule;
                findings.push({
                    ruleId,
                    ruleSource: source,
                    severity: r.severity,
                    title: r.title,
                    confidence: 'high',
                    resolvedBy: 'static',
                    instances: deduped,
                });
            }

            // Merge findings into state
            state.findings = [...state.findings, ...findings];
            state.status = 'complete';
            state.updatedAt = new Date().toISOString();
            await writeScanState(state);

            const bySeverity: Record<Severity, number> = {
                critical: 0, high: 0, medium: 0, low: 0, info: 0,
            };
            for (const f of findings) {
                bySeverity[f.severity]++;
            }

            return {
                content: [{
                    type: "text",
                    text: encode({
                        scanId: input.scanId,
                        findings,
                        summary: {
                            bySeverity,
                            rulesRun,
                        },
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
    if (root.startPosition.row === row && root.startPosition.column === col) {
        return root;
    }
    for (const child of root.children) {
        if (child.startPosition.row > row) break;
        if (child.endPosition.row < row) continue;
        const found = findNodeAt(child, row, col);
        if (found) return found;
    }
    return null;
}

function walkAllNodes(node: Node, callback: (n: Node) => void): void {
    callback(node);
    for (const child of node.children) {
        walkAllNodes(child, callback);
    }
}
