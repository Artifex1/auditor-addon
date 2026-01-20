import { LanguageAdapter, FileContent, SupportedLanguage, CallGraph, FileMetrics, DiffFileMetrics } from "../engine/types.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";

/**
 * Configuration for a language adapter.
 * Defines the tree-sitter queries and estimation constants for a specific language.
 */
export interface AdapterConfig {
    /** The language identifier */
    languageId: SupportedLanguage;

    /** Tree-sitter queries for extracting code constructs */
    queries: {
        /** Query for matching comments (e.g., line comments, block comments) */
        comments: string;
        /** Query for matching function/method definitions */
        functions: string;
        /** Query for matching branching statements (if, for, while, etc.) */
        branching: string;
        /** Optional query for multi-line constructs to normalize in NLoC calculation */
        normalization?: string;
    };

    /** Constants for code estimation and complexity analysis */
    constants: {
        /** How many normalized lines of code (NLoC) a reviewer can cover in one day (8h baseline) */
        baseRateNlocPerDay: number;
        /** Normalized cyclomatic complexity (per 100 NLoC) where complexity impact is neutral */
        complexityMidpoint: number;
        /** How quickly complexity penalties/benefits ramp toward their caps (higher = gentler slope) */
        complexitySteepness: number;
        /** Maximum factor reduction from low complexity (e.g., 0.25 => -25% time) */
        complexityBenefitCap: number;
        /** Maximum factor increase from high complexity (e.g., 0.75 => +75% time) */
        complexityPenaltyCap: number;
        /** Comment density (%) where documentation benefit approaches its cap */
        commentFullBenefitDensity: number;
        /** Maximum factor reduction from strong documentation (e.g., 0.35 => -35% time) */
        commentBenefitCap: number;
    };
}

/**
 * Base adapter providing common functionality for all language adapters.
 * Implements signature extraction and metrics calculation using tree-sitter.
 * Language-specific adapters should extend this class and override methods as needed.
 */
export abstract class BaseAdapter implements LanguageAdapter {
    languageId: SupportedLanguage;
    protected config: AdapterConfig;

    constructor(config: AdapterConfig) {
        this.languageId = config.languageId;
        this.config = config;
    }

    /**
     * Normalizes a function signature by cleaning up whitespace.
     * Converts multi-line signatures to single line with consistent spacing.
     * 
     * @param raw - Raw signature string
     * @returns Cleaned signature string
     */
    protected cleanSignature(raw: string): string {
        return raw.replace(/\s+/g, ' ')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
            .replace(/\s*,\s*/g, ', ')
            .trim();
    }

    /**
     * Generates a call graph for the source files.
     * Default implementation returns empty graph - override in language-specific adapters.
     * 
     * @param files - Array of source files to analyze
     * @returns Call graph with nodes and edges
     */
    async generateCallGraph(files: FileContent[]): Promise<CallGraph> {
        return { nodes: [], edges: [] };
    }

    /**
     * Extracts function signatures from source files.
     * Returns signatures without function bodies, truncated to 80 characters.
     * 
     * @param files - Array of source files to analyze
     * @returns Map of file paths to arrays of function signatures
     */
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
                        // Extract signature text up to the function body
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
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error(`Error extracting signatures for ${file.path}: ${errorMessage}`);
            }
        }
        return signaturesByFile;
    }

    /**
     * Calculates code metrics for source files.
     * Computes NLoC, complexity, comment density, and estimated review time.
     * 
     * @param files - Array of source files to analyze
     * @returns Array of file metrics
     */
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

            // 1. Calculate comment metrics
            const { linesWithComments, onlyCommentLinesCount } = this.calculateCommentMetrics(
                commentQuery,
                tree.rootNode,
                lines
            );

            // 2. Calculate cognitive complexity
            const cognitiveComplexity = this.calculateCognitiveComplexity(branchQuery, tree.rootNode);

            // 3. Calculate NLoC with normalization
            const blankLines = lines.filter(line => line.trim() === '').length;
            const normalizationAdjustment = normQuery
                ? this.calculateNormalizationAdjustment(normQuery, tree.rootNode, file.content)
                : 0;

            const nloc = Math.max(0, totalLines - blankLines - onlyCommentLinesCount - normalizationAdjustment);
            const commentDensity = nloc > 0 ? parseFloat(((linesWithComments / nloc) * 100).toFixed(2)) : 0;
            const normalizedComplexity = nloc > 0 ? (cognitiveComplexity / nloc) * 100 : 0;

            // 4. Calculate estimated hours
            const estimatedHours = this.calculateEstimation(
                nloc,
                normalizedComplexity,
                commentDensity,
                baseRateNlocPerDay,
                complexityMidpoint,
                complexitySteepness,
                complexityBenefitCap,
                complexityPenaltyCap,
                commentFullBenefitDensity,
                commentBenefitCap
            );

            results.push({
                file: file.path,
                nloc,
                linesWithComments,
                commentDensity,
                cognitiveComplexity,
                estimatedHours
            });
        }
        return results;
    }

    /**
     * Calculates comment-related metrics for a file.
     * 
     * @param commentQuery - Tree-sitter query for matching comments
     * @param rootNode - Root node of the syntax tree
     * @param lines - Array of file lines
     * @returns Object with linesWithComments and onlyCommentLinesCount
     */
    private calculateCommentMetrics(
        commentQuery: Query,
        rootNode: Node,
        lines: string[]
    ): { linesWithComments: number; onlyCommentLinesCount: number } {
        const commentLinesSet = new Set<number>();
        let onlyCommentLinesCount = 0;

        const commentCaptures = commentQuery.captures(rootNode);
        for (const capture of commentCaptures) {
            for (let i = capture.node.startPosition.row; i <= capture.node.endPosition.row; i++) {
                commentLinesSet.add(i);
            }
        }

        const linesWithComments = commentLinesSet.size;

        for (const lineIdx of commentLinesSet) {
            if (lineIdx >= lines.length) continue;
            const lineContent = lines[lineIdx].trim();
            // Simple heuristic for "only comment" lines
            if (/^(\/\/|\/\*|\*|#)/.test(lineContent)) {
                onlyCommentLinesCount++;
            }
        }

        return { linesWithComments, onlyCommentLinesCount };
    }

    /**
     * Calculates cognitive complexity based on branching statements and nesting.
     * Nested branches contribute more to complexity.
     * 
     * @param branchQuery - Tree-sitter query for matching branching statements
     * @param rootNode - Root node of the syntax tree
     * @returns Cognitive complexity score
     */
    private calculateCognitiveComplexity(branchQuery: Query, rootNode: Node): number {
        const branchCaptures = branchQuery.captures(rootNode);
        let cognitiveComplexity = 0;

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
            cognitiveComplexity += (1 + nestingLevel);
        }

        return cognitiveComplexity;
    }

    /**
     * Calculates the normalization adjustment for NLoC.
     * Multi-line constructs (like function signatures) are normalized to single lines.
     * 
     * @param normQuery - Tree-sitter query for normalization constructs
     * @param rootNode - Root node of the syntax tree
     * @param fileContent - Full file content
     * @returns Number of lines to subtract from total
     */
    private calculateNormalizationAdjustment(
        normQuery: Query,
        rootNode: Node,
        fileContent: string
    ): number {
        const normCaptures = normQuery.captures(rootNode);
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

        let normalizationAdjustment = 0;
        for (const construct of topLevelConstructs) {
            let startLine = construct.node.startPosition.row;
            let endLine = construct.node.endPosition.row;

            // Special handling for functions/methods: only count signature lines
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

        return normalizationAdjustment;
    }

    /**
     * Calculates estimated review time based on NLoC, complexity, and documentation.
     * Uses a tanh-based formula to apply complexity penalties and documentation benefits.
     * 
     * @param nloc - Normalized lines of code
     * @param normalizedComplexity - Complexity per 100 NLoC
     * @param commentDensity - Percentage of lines with comments
     * @param baseRateNlocPerDay - Base review rate
     * @param complexityMidpoint - Neutral complexity level
     * @param complexitySteepness - How quickly complexity impacts time
     * @param complexityBenefitCap - Max benefit from low complexity
     * @param complexityPenaltyCap - Max penalty from high complexity
     * @param commentFullBenefitDensity - Comment density for full benefit
     * @param commentBenefitCap - Max benefit from documentation
     * @returns Estimated hours
     */
    private calculateEstimation(
        nloc: number,
        normalizedComplexity: number,
        commentDensity: number,
        baseRateNlocPerDay: number,
        complexityMidpoint: number,
        complexitySteepness: number,
        complexityBenefitCap: number,
        complexityPenaltyCap: number,
        commentFullBenefitDensity: number,
        commentBenefitCap: number
    ): number {
        const baseHours = (nloc / baseRateNlocPerDay) * 8;

        // Complexity effect: centered around midpoint, capped by separate benefit/penalty caps
        const complexityDelta = normalizedComplexity - complexityMidpoint;
        const complexityShape = Math.tanh(complexityDelta / complexitySteepness); // ~[-1, 1]
        const complexityAdjustment = complexityShape >= 0
            ? complexityShape * complexityPenaltyCap
            : complexityShape * complexityBenefitCap;

        // Comment effect: smooth ramp up to full benefit density (tanh-based, 0 benefit at 0%)
        const commentDensityProgress = Math.max(0, commentDensity) / Math.max(1, commentFullBenefitDensity);
        const commentShape = Math.tanh(commentDensityProgress * 2.646); // ~0 at 0%, ~0.99 at fullBenefitDensity
        const commentAdjustment = commentShape * commentBenefitCap;

        let factor = 1.0 + complexityAdjustment - commentAdjustment;
        factor = Math.max(0.5, Math.min(1 + complexityPenaltyCap, factor));

        return parseFloat((baseHours * factor).toFixed(2));
    }

    /**
     * Calculates metrics for changed lines in a diff.
     *
     * @param file - Source file content
     * @param addedLines - Line numbers that were added (1-indexed)
     * @param removedLines - Line numbers that were removed (1-indexed)
     * @param status - File status: added, modified, or deleted
     * @returns Diff-specific metrics
     */
    async calculateDiffMetrics(
        file: FileContent,
        addedLines: number[],
        removedLines: number[],
        status: 'added' | 'modified' | 'deleted'
    ): Promise<DiffFileMetrics> {
        const {
            baseRateNlocPerDay,
            complexityMidpoint,
            complexitySteepness,
            complexityBenefitCap,
            complexityPenaltyCap,
            commentFullBenefitDensity,
            commentBenefitCap
        } = this.config.constants;

        // Deleted files are free
        if (status === 'deleted') {
            return {
                file: file.path,
                status,
                addedLines: 0,
                removedLines: removedLines.length,
                diffNloc: 0,
                diffComplexity: 0,
                commentDensity: 0,
                estimatedHours: 0
            };
        }

        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(this.languageId);
        const parser = await service.createParser(this.languageId);

        const tree = parser.parse(file.content);
        if (!tree) {
            return {
                file: file.path,
                status,
                addedLines: addedLines.length,
                removedLines: removedLines.length,
                diffNloc: addedLines.length,
                diffComplexity: 0,
                commentDensity: 0,
                estimatedHours: 0
            };
        }

        const lines = file.content.split('\n');

        // Calculate diff NLoC (exclude blank lines and comment-only lines from added lines)
        const commentQuery = new Query(lang, this.config.queries.comments);
        const commentCaptures = commentQuery.captures(tree.rootNode);
        const commentOnlyLines = new Set<number>();

        for (const capture of commentCaptures) {
            for (let i = capture.node.startPosition.row; i <= capture.node.endPosition.row; i++) {
                const lineNum = i + 1; // Convert to 1-indexed
                if (lineNum < lines.length) {
                    const lineContent = lines[i].trim();
                    if (/^(\/\/|\/\*|\*|#|--|;;)/.test(lineContent)) {
                        commentOnlyLines.add(lineNum);
                    }
                }
            }
        }

        let diffNloc = 0;
        let linesWithComments = 0;

        for (const lineNum of addedLines) {
            const lineIdx = lineNum - 1;
            if (lineIdx >= 0 && lineIdx < lines.length) {
                const lineContent = lines[lineIdx].trim();

                // Skip blank lines
                if (lineContent === '') continue;

                // Skip comment-only lines for NLoC but track them
                if (commentOnlyLines.has(lineNum)) {
                    linesWithComments++;
                    continue;
                }

                diffNloc++;
            }
        }

        // Calculate diff complexity based on nesting depth of changed lines
        const branchQuery = new Query(lang, this.config.queries.branching);
        const branchCaptures = branchQuery.captures(tree.rootNode);
        const branches = branchCaptures.map(c => c.node);

        let diffComplexity = 0;
        for (const lineNum of addedLines) {
            const lineIdx = lineNum - 1;
            if (lineIdx >= 0 && lineIdx < lines.length) {
                const lineContent = lines[lineIdx].trim();
                if (lineContent === '' || commentOnlyLines.has(lineNum)) continue;

                // Calculate nesting depth for this line
                const nestingDepth = this.calculateNestingDepthForLine(lineNum, branches);
                diffComplexity += nestingDepth;
            }
        }

        // Calculate comment density for diff
        const commentDensity = diffNloc > 0
            ? parseFloat(((linesWithComments / diffNloc) * 100).toFixed(2))
            : 0;

        // Calculate normalized complexity and estimated hours
        const normalizedComplexity = diffNloc > 0 ? (diffComplexity / diffNloc) * 100 : 0;

        const estimatedHours = this.calculateEstimation(
            diffNloc,
            normalizedComplexity,
            commentDensity,
            baseRateNlocPerDay,
            complexityMidpoint,
            complexitySteepness,
            complexityBenefitCap,
            complexityPenaltyCap,
            commentFullBenefitDensity,
            commentBenefitCap
        );

        return {
            file: file.path,
            status,
            addedLines: addedLines.length,
            removedLines: removedLines.length,
            diffNloc,
            diffComplexity,
            commentDensity,
            estimatedHours
        };
    }

    /**
     * Calculates the nesting depth for a specific line number.
     * Returns the number of branching statements that contain this line.
     *
     * @param lineNum - 1-indexed line number
     * @param branches - Array of branch nodes from Tree-sitter
     * @returns Nesting depth (0 if not inside any branch)
     */
    private calculateNestingDepthForLine(lineNum: number, branches: Node[]): number {
        const lineIdx = lineNum - 1; // Convert to 0-indexed for comparison
        let depth = 0;

        for (const branch of branches) {
            const branchStartLine = branch.startPosition.row;
            const branchEndLine = branch.endPosition.row;

            // Check if line is inside this branch
            if (lineIdx >= branchStartLine && lineIdx <= branchEndLine) {
                depth++;
            }
        }

        return depth;
    }

    /**
     * Extracts function signatures with their line ranges.
     * Used for mapping changed lines to affected functions.
     *
     * @param file - Source file to analyze
     * @returns Array of functions with signature and line range
     */
    async extractSignaturesWithRanges(
        file: FileContent
    ): Promise<Array<{ signature: string; startLine: number; endLine: number }>> {
        const results: Array<{ signature: string; startLine: number; endLine: number }> = [];

        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(this.languageId);
        const parser = await service.createParser(this.languageId);
        const query = new Query(lang, this.config.queries.functions);

        try {
            const tree = parser.parse(file.content);
            if (!tree) return results;

            const captures = query.captures(tree.rootNode);

            for (const capture of captures) {
                if (capture.name === 'function') {
                    const node = capture.node;
                    const bodyNode = node.childForFieldName('body') ||
                        node.children.find(c => c.type.includes('body') || c.type === 'block');

                    let rawSignature = '';
                    if (bodyNode) {
                        rawSignature = file.content.substring(node.startIndex, bodyNode.startIndex);
                    } else {
                        rawSignature = node.text;
                    }

                    const signature = this.cleanSignature(rawSignature);
                    const truncated = signature.length > 120
                        ? signature.substring(0, 117) + '...'
                        : signature;

                    results.push({
                        signature: truncated,
                        startLine: node.startPosition.row + 1, // 1-indexed
                        endLine: node.endPosition.row + 1
                    });
                }
            }
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`Error extracting signatures with ranges for ${file.path}: ${errorMessage}`);
        }

        return results;
    }
}
