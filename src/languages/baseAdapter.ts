import { LanguageAdapter, Entrypoint, FileContent, SupportedLanguage, CallGraph, FileMetrics } from "../engine/types.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Parser, Language, Node } from "web-tree-sitter";

export interface AdapterConfig {
    languageId: SupportedLanguage;
    queries: {
        comments: string; // Tree-sitter query for matching comments
        functions: string; // Tree-sitter query for matching function/method definitions
        branching: string; // Tree-sitter query for matching branching statements
        normalization?: string; // Optional: Tree-sitter query for multi-line constructs to normalize
    };
    constants: {
        baseRateNlocPerDay: number; // How many NLoC a reviewer covers in one day (8h baseline)
        complexityMidpoint: number; // Normalized CC (per 100 NLoC) where complexity impact is neutral
        complexitySteepness: number; // How quickly complexity ramps toward its caps
        complexityBenefitCap: number; // Max factor reduction from low complexity (e.g., 0.25 => -25%)
        complexityPenaltyCap: number; // Max factor increase from high complexity (e.g., 0.50 => +50%)
        commentFullBenefitDensity: number; // Comment density (%) where documentation benefit is near its cap
        commentBenefitCap: number; // Max factor reduction from strong documentation (e.g., 0.30 => -30%)
    };
}

export abstract class BaseAdapter implements LanguageAdapter {
    languageId: SupportedLanguage;
    protected config: AdapterConfig;

    constructor(config: AdapterConfig) {
        this.languageId = config.languageId;
        this.config = config;
    }

    protected cleanSignature(raw: string): string {
        return raw.replace(/\s+/g, ' ')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
            .replace(/\s*,\s*/g, ', ')
            .trim();
    }

    async extractEntrypoints(files: FileContent[]): Promise<Entrypoint[]> {
        return [];
    }

    async generateCallGraph(files: FileContent[]): Promise<CallGraph> {
        return { nodes: [], edges: [] };
    }

    async extractSignatures(files: FileContent[]): Promise<Record<string, string[]>> {
        const signaturesByFile: Record<string, string[]> = {};
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(this.languageId);
        const parser = await service.createParser(this.languageId);
        const query = new Query(lang, this.config.queries.functions);

        for (const file of files) {
            try {
                const tree = parser.parse(file.content);
                if (!tree) continue;

                const captures = query.captures(tree.rootNode);

                const signatures: string[] = [];
                for (const capture of captures) {
                    if (capture.name === 'function') {
                        const node = capture.node;
                        // For signatures, we often want the text up to the body
                        // In tree-sitter, we usually have separate nodes for name, params, etc.
                        // But to stay close to the original logic, we'll try to find a 'body' child or use the node text
                        const bodyNode = node.childForFieldName('body') || node.children.find(c => c.type.includes('body') || c.type === 'block');

                        let rawSignature = '';
                        if (bodyNode) {
                            // Text from node start to body start
                            rawSignature = file.content.substring(node.startIndex, bodyNode.startIndex);
                        } else {
                            rawSignature = node.text;
                        }

                        const signature = this.cleanSignature(rawSignature);
                        const truncated = signature.length > 80
                            ? signature.substring(0, 77) + '...'
                            : signature;
                        signatures.push(truncated);
                    }
                }

                if (signatures.length > 0) {
                    signaturesByFile[file.path] = signatures;
                }
            } catch (e) {
                console.error(`Error extracting signatures for ${file.path}:`, e);
            }
        }
        return signaturesByFile;
    }

    async calculateMetrics(files: FileContent[]): Promise<FileMetrics[]> {
        const results: FileMetrics[] = [];
        const {
            baseRateNlocPerDay,
            complexityMidpoint,
            complexitySteepness,
            complexityBenefitCap,
            complexityPenaltyCap,
            commentFullBenefitDensity,
            commentBenefitCap
        } = this.config.constants;

        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(this.languageId);
        const parser = await service.createParser(this.languageId);

        const commentQuery = new Query(lang, this.config.queries.comments);
        const branchQuery = new Query(lang, this.config.queries.branching);
        const normQuery = this.config.queries.normalization ? new Query(lang, this.config.queries.normalization) : null;

        for (const file of files) {
            const lines = file.content.split('\n');
            const totalLines = lines.length;
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // 1. Comments
            const commentLinesSet = new Set<number>();
            let onlyCommentLinesCount = 0;

            const commentCaptures = commentQuery.captures(tree.rootNode);
            for (const capture of commentCaptures) {
                for (let i = capture.node.startPosition.row; i <= capture.node.endPosition.row; i++) {
                    commentLinesSet.add(i);
                }
            }

            const linesWithComments = commentLinesSet.size;

            for (const lineIdx of commentLinesSet) {
                if (lineIdx >= lines.length) continue;
                const lineContent = lines[lineIdx].trim();
                // Simple heuristic for "only comment" lines (consistent with original)
                if (/^(\/\/|\/\*|\*|#)/.test(lineContent)) {
                    onlyCommentLinesCount++;
                }
            }

            // 2. Complexity
            const branchCaptures = branchQuery.captures(tree.rootNode);
            let cc = 0;

            // Nested branches calculation (consistent with original logic)
            const branches = branchCaptures.map(c => c.node);
            for (const branch of branches) {
                let nestingLevel = 0;
                for (const other of branches) {
                    if (branch === other) continue;

                    const isInside = (
                        other.startIndex <= branch.startIndex &&
                        other.endIndex >= branch.endIndex &&
                        (
                            other.startIndex < branch.startIndex ||
                            other.endIndex > branch.endIndex
                        )
                    );

                    if (isInside) {
                        nestingLevel++;
                    }
                }
                cc += (1 + nestingLevel);
            }

            // 3. NLoC Calculation with Normalization
            let blankLines = 0;
            for (const line of lines) {
                if (line.trim() === '') {
                    blankLines++;
                }
            }

            let normalizationAdjustment = 0;
            if (normQuery) {
                const normCaptures = normQuery.captures(tree.rootNode);
                const allConstructs = normCaptures.map(c => ({ node: c.node, name: c.name }));

                // Filter constructs to prevent double-counting multi-line adjustments.
                // A construct is "nested" if it's inside another construct that also normalizes its extent.
                const topLevelConstructs = allConstructs.filter(construct => {
                    const isNested = allConstructs.some(other => {
                        if (construct === other) return false;

                        // Functions/methods only normalize their signatures, not their bodies.
                        // Therefore, a construct inside a function body is NOT "nested" in a way
                        // that would cause double-counting of normalization adjustments.
                        const isOtherFunction = other.name.includes('function') ||
                            other.name.includes('method') ||
                            other.node.type.includes('function') ||
                            other.node.type.includes('method');

                        if (isOtherFunction) {
                            const bodyNode = other.node.childForFieldName('body') ||
                                other.node.children.find(c => c.type.includes('body') || c.type === 'block');
                            if (bodyNode && construct.node.startIndex >= bodyNode.startIndex) {
                                return false;
                            }
                        }

                        return other.node.startIndex <= construct.node.startIndex &&
                            other.node.endIndex >= construct.node.endIndex &&
                            (other.node.startIndex < construct.node.startIndex ||
                                other.node.endIndex > construct.node.endIndex);
                    });
                    return !isNested;
                });

                for (const construct of topLevelConstructs) {
                    let startLine = construct.node.startPosition.row;
                    let endLine = construct.node.endPosition.row;

                    // Special handling for functions/methods: only count signature lines
                    // Check capture name OR node type for robustness across languages
                    const isFunction = construct.name.includes('function') ||
                        construct.name.includes('method') ||
                        construct.node.type.includes('function') ||
                        construct.node.type.includes('method');

                    if (isFunction) {
                        const bodyNode = construct.node.childForFieldName('body') ||
                            construct.node.children.find(c => c.type.includes('body') || c.type === 'block');
                        if (bodyNode) {
                            endLine = bodyNode.startPosition.row - 1;
                        }
                    }

                    const linesSpanned = endLine - startLine + 1;
                    if (linesSpanned > 1) {
                        normalizationAdjustment += (linesSpanned - 1);
                    }
                }
            }

            const nloc = Math.max(0, totalLines - blankLines - onlyCommentLinesCount - normalizationAdjustment);
            const commentDensity = nloc > 0 ? parseFloat(((linesWithComments / nloc) * 100).toFixed(2)) : 0;
            const normalizedCC = nloc > 0 ? (cc / nloc) * 100 : 0;

            // 4. Estimation
            const baseHours = (nloc / baseRateNlocPerDay) * 8;

            // Complexity effect: centered around midpoint, capped by separate benefit/penalty caps
            const ccDelta = normalizedCC - complexityMidpoint;
            const ccShape = Math.tanh(ccDelta / complexitySteepness); // ~[-1, 1]
            const ccAdjustment = ccShape >= 0
                ? ccShape * complexityPenaltyCap
                : ccShape * complexityBenefitCap;

            // Comment effect: smooth ramp up to full benefit density (tanh-based, 0 benefit at 0%)
            const cdProgress = Math.max(0, commentDensity) / Math.max(1, commentFullBenefitDensity); // 0..>
            const cdShape = Math.tanh(cdProgress * 2.646); // ~0 at 0%, ~0.99 at fullBenefitDensity
            const cdAdjustment = cdShape * commentBenefitCap;

            let factor = 1.0 + ccAdjustment - cdAdjustment;
            factor = Math.max(0.5, Math.min(1 + complexityPenaltyCap, factor));

            const estimatedHours = parseFloat((baseHours * factor).toFixed(2));

            results.push({
                file: file.path,
                nloc,
                linesWithComments,
                commentDensity,
                cognitiveComplexity: cc,
                estimatedHours
            });
        }
        return results;
    }
}
