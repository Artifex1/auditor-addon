import {
    LanguageAdapter, FileContent, SupportedLanguage, CallGraph, FileMetrics, DiffFileMetrics,
    GraphNode, GraphEdge, SymbolMap, SymbolEntry, CalleeEntry, CallTargetKind,
    ModifierInfo, BuiltinContextValue, ModifierPattern
} from "../engine/types.js";
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
 *
 * The primary data structure is SymbolMap (Map<string, SymbolEntry>).
 * generateCallGraph is derived from it for backward compatibility.
 */
export abstract class BaseAdapter implements LanguageAdapter {
    languageId: SupportedLanguage;
    protected config: AdapterConfig;

    constructor(config: AdapterConfig) {
        this.languageId = config.languageId;
        this.config = config;
    }

    protected _symbolMap: SymbolMap = new Map();
    protected symbolsByLabel: Map<string, SymbolEntry[]> = new Map();
    protected symbolsByContainer: Map<string, SymbolEntry[]> = new Map();
    private symbolsByLocation: Map<string, SymbolEntry> = new Map();

    /**
     * Normalizes a function signature by cleaning up whitespace.
     * Converts multi-line signatures to single line with consistent spacing.
     */
    protected cleanSignature(raw: string): string {
        return raw.replace(/\s+/g, ' ')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
            .replace(/\s*,\s*/g, ', ')
            .trim();
    }

    // ==========================================
    // Primary: SymbolMap generation
    // ==========================================

    /**
     * Generates the symbol map for the source files.
     * Template method: resets state, builds symbol table, identifies calls.
     * This is the primary code path — all analysis runs through here.
     */
    async generateSymbolMap(files: FileContent[]): Promise<SymbolMap> {
        this.resetState();
        await this.buildSymbolTable(files);
        await this.identifyCalls(files);
        await this.enrichEntries(files);
        return this._symbolMap;
    }

    /**
     * Generates a call graph for backward compatibility.
     * Derived from SymbolMap — not the primary representation.
     */
    async generateCallGraph(files: FileContent[]): Promise<CallGraph> {
        const symbolMap = await this.generateSymbolMap(files);
        return BaseAdapter.symbolMapToCallGraph(symbolMap);
    }

    /**
     * Projects a SymbolMap into the legacy CallGraph format.
     */
    static symbolMapToCallGraph(symbolMap: SymbolMap): CallGraph {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];

        for (const [_id, entry] of symbolMap) {
            nodes.push({
                id: entry.qualifiedName,
                label: entry.label,
                file: entry.file,
                contract: entry.contract,
                range: entry.range,
                visibility: entry.visibility,
                containerKind: entry.containerKind,
            });

            for (const callee of entry.callees) {
                edges.push({
                    from: entry.qualifiedName,
                    to: callee.qualifiedName,
                    kind: callee.targetKind === 'internal' ? 'internal' : 'external',
                });
            }
        }

        return { nodes, edges };
    }

    /**
     * Converts a legacy CallGraph into a SymbolMap. Used by tests.
     */
    static callGraphToSymbolMap(graph: CallGraph, language: SupportedLanguage): SymbolMap {
        const symbolMap: SymbolMap = new Map();

        const edgeIndex = new Map<string, GraphEdge[]>();
        for (const edge of graph.edges) {
            const list = edgeIndex.get(edge.from) ?? [];
            list.push(edge);
            edgeIndex.set(edge.from, list);
        }

        for (const node of graph.nodes) {
            const outEdges = edgeIndex.get(node.id) ?? [];
            const callees: CalleeEntry[] = outEdges.map(e => ({
                qualifiedName: e.to,
                targetKind: (e.kind === 'external' ? 'cross_module' : 'internal') as CallTargetKind,
            }));

            symbolMap.set(node.id, {
                qualifiedName: node.id,
                label: node.label,
                file: node.file,
                line: node.range?.start.line ?? 0,
                language,
                writesState: [],
                readsState: [],
                callsExternal: callees.some(c => c.targetKind !== 'internal'),
                callees,
                isPublic: node.visibility === 'public' || node.visibility === 'external',
                hasAccessControl: false,
                modifiers: [],
                resolvedBy: 'static',
                confidence: 'high',
                contract: node.contract,
                range: node.range,
                visibility: node.visibility,
                containerKind: node.containerKind,
            });
        }

        return symbolMap;
    }

    // ==========================================
    // Internal state management
    // ==========================================

    protected resetState(): void {
        this._symbolMap.clear();
        this.symbolsByLabel.clear();
        this.symbolsByContainer.clear();
        this.symbolsByLocation.clear();
    }

    protected indexSymbol(entry: SymbolEntry): void {
        this._symbolMap.set(entry.qualifiedName, entry);
        const labelEntries = this.symbolsByLabel.get(entry.label) ?? [];
        labelEntries.push(entry);
        this.symbolsByLabel.set(entry.label, labelEntries);
        if (entry.contract) {
            const containerEntries = this.symbolsByContainer.get(entry.contract) ?? [];
            containerEntries.push(entry);
            this.symbolsByContainer.set(entry.contract, containerEntries);
        }
        if (entry.range) {
            const key = `${entry.file}:${entry.range.start.line}:${entry.range.start.column}`;
            this.symbolsByLocation.set(key, entry);
        }
    }

    /**
     * Adds a callee to a symbol's callees list, deduplicating by qualifiedName.
     */
    protected addCallee(callerId: string, callee: CalleeEntry): void {
        const entry = this._symbolMap.get(callerId);
        if (!entry) return;
        if (!entry.callees.some(c => c.qualifiedName === callee.qualifiedName)) {
            entry.callees.push(callee);
            if (callee.targetKind !== 'internal') {
                entry.callsExternal = true;
            }
        }
    }

    /**
     * Creates a CalleeEntry for the common case of a resolved internal call.
     */
    protected makeCallee(qualifiedName: string, kind: CallTargetKind = 'internal'): CalleeEntry {
        return {
            qualifiedName,
            targetKind: kind,
        };
    }

    protected findSymbolAtNode(node: Node, filePath: string): SymbolEntry | undefined {
        const line = node.startPosition.row + 1;
        const col = node.startPosition.column;
        return this.symbolsByLocation.get(`${filePath}:${line}:${col}`);
    }

    /**
     * Creates a SymbolEntry with sensible defaults. Adapters call this from
     * their createFunctionNode / createMethodNode methods.
     */
    protected createEntry(opts: {
        qualifiedName: string;
        label: string;
        file: string;
        node: Node;
        visibility: import("../engine/types.js").Visibility;
        contract?: string;
        containerKind?: 'contract' | 'interface' | 'library';
        modifiers?: ModifierInfo[];
    }): SymbolEntry {
        return {
            qualifiedName: opts.qualifiedName,
            label: opts.label,
            file: opts.file,
            line: opts.node.startPosition.row + 1,
            language: this.languageId,
            writesState: [],
            readsState: [],
            callsExternal: false,
            callees: [],
            isPublic: opts.visibility === 'public' || opts.visibility === 'external',
            hasAccessControl: (opts.modifiers?.length ?? 0) > 0,
            modifiers: opts.modifiers ?? [],
            resolvedBy: 'static',
            confidence: 'high',
            contract: opts.contract,
            range: {
                start: { line: opts.node.startPosition.row + 1, column: opts.node.startPosition.column },
                end: { line: opts.node.endPosition.row + 1, column: opts.node.endPosition.column },
            },
            visibility: opts.visibility,
            containerKind: opts.containerKind,
        };
    }

    protected async buildSymbolTable(_files: FileContent[]): Promise<void> {}
    protected async identifyCalls(_files: FileContent[]): Promise<void> {}

    /**
     * Enriches symbol entries with writesState, readsState, and modifiers
     * by walking each function's AST body and calling trait methods.
     */
    protected async enrichEntries(files: FileContent[]): Promise<void> {
        const service = TreeSitterService.getInstance();
        const parser = await service.createParser(this.languageId);

        const treeCache = new Map<string, import("web-tree-sitter").Tree>();
        for (const file of files) {
            const tree = parser.parse(file.content);
            if (tree) treeCache.set(file.path, tree);
        }

        for (const entry of this._symbolMap.values()) {
            const tree = treeCache.get(entry.file);
            if (!tree || !entry.range) continue;

            const targetRow = entry.range.start.line - 1;
            const targetCol = entry.range.start.column;
            const funcNode = findNodeAt(tree.rootNode, targetRow, targetCol);
            if (!funcNode) continue;

            // Populate modifiers if empty (some adapters do this in buildSymbolTable)
            if (entry.modifiers.length === 0) {
                const mods = this.getModifiers(funcNode);
                if (mods.length > 0) {
                    entry.modifiers = mods;
                    entry.hasAccessControl = true;
                }
            }

            // Walk descendants to populate writesState and readsState
            const writes = new Set<string>(entry.writesState);
            const reads = new Set<string>(entry.readsState);
            walkDescendants(funcNode, (node) => {
                if (this.isStateWrite(node)) {
                    const varName = this.getWrittenVar(node);
                    if (varName) writes.add(varName);
                }
                if (this.isStateRead(node)) {
                    // For reads, use the node text as the variable name
                    const text = node.text;
                    if (text && text.length < 80) reads.add(text);
                }
            });
            entry.writesState = [...writes];
            entry.readsState = [...reads];
        }
    }

    // ==========================================
    // Node classifier stubs (override in adapters)
    // ==========================================

    isFunctionDef(_node: Node): boolean { return false; }
    isExternalCall(_node: Node): boolean { return false; }
    isStateWrite(_node: Node): boolean { return false; }
    isStateRead(_node: Node): boolean { return false; }
    isAccessModifier(_node: Node): boolean { return false; }
    isReturnStatement(_node: Node): boolean { return false; }
    isPublicFn(_node: Node): boolean { return false; }

    // ==========================================
    // Extractor stubs (override in adapters)
    // ==========================================

    getFunctionName(_node: Node): string | null { return null; }
    getCallTarget(_node: Node): string | null { return null; }
    getWrittenVar(_node: Node): string | null { return null; }
    getModifiers(_node: Node): ModifierInfo[] { return []; }

    // ==========================================
    // Resolution stubs (override in adapters)
    // ==========================================

    resolveCallee(
        _node: Node,
        _symbolMap: SymbolMap,
        _sourceFiles: Map<string, string>
    ): { qualifiedName: string; targetKind: CallTargetKind } | null {
        return null;
    }

    resolveExtensionMethod(
        _receiverType: string,
        _methodName: string,
        _sourceFiles: Map<string, string>
    ): string | null {
        return null;
    }

    resolveScope(
        _containerName: string,
        _sourceFiles: Map<string, string>
    ): string[] {
        return [];
    }

    isBuiltinContextValue(_node: Node): BuiltinContextValue | null {
        return null;
    }

    /**
     * Extracts function signatures from source files.
     * Returns signatures without function bodies, truncated to 80 characters.
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
                        const bodyNode = node.childForFieldName('body') || node.children.find(c => c.type.includes('body') || c.type === 'block');

                        let rawSignature = '';
                        if (bodyNode) {
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
     */
    async calculateMetrics(files: FileContent[]): Promise<FileMetrics[]> {
        const results: FileMetrics[] = [];
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

            const { linesWithComments, onlyCommentLinesCount } = this.calculateCommentMetrics(
                commentQuery,
                tree.rootNode,
                lines
            );

            const cognitiveComplexity = this.calculateCognitiveComplexity(branchQuery, tree.rootNode);

            const blankLines = lines.filter(line => line.trim() === '').length;
            const normalizationAdjustment = normQuery
                ? this.calculateNormalizationAdjustment(normQuery, tree.rootNode)
                : 0;

            const nloc = Math.max(0, totalLines - blankLines - onlyCommentLinesCount - normalizationAdjustment);
            const commentDensity = nloc > 0 ? parseFloat(((linesWithComments / nloc) * 100).toFixed(2)) : 0;
            const normalizedComplexity = nloc > 0 ? (cognitiveComplexity / nloc) * 100 : 0;

            const estimatedHours = this.calculateEstimation(nloc, normalizedComplexity, commentDensity);

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
            if (/^(\/\/|\/\*|\*|#)/.test(lineContent)) {
                onlyCommentLinesCount++;
            }
        }

        return { linesWithComments, onlyCommentLinesCount };
    }

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

    private calculateNormalizationAdjustment(
        normQuery: Query,
        rootNode: Node
    ): number {
        const normCaptures = normQuery.captures(rootNode);
        const allConstructs = normCaptures.map(c => ({ node: c.node, name: c.name }));

        const topLevelConstructs = allConstructs.filter(construct => {
            const isNested = allConstructs.some(other => {
                if (construct === other) return false;

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

    private calculateEstimation(nloc: number, normalizedComplexity: number, commentDensity: number): number {
        const {
            baseRateNlocPerDay,
            complexityMidpoint,
            complexitySteepness,
            complexityBenefitCap,
            complexityPenaltyCap,
            commentFullBenefitDensity,
            commentBenefitCap
        } = this.config.constants;
        const baseHours = (nloc / baseRateNlocPerDay) * 8;

        const complexityDelta = normalizedComplexity - complexityMidpoint;
        const complexityShape = Math.tanh(complexityDelta / complexitySteepness);
        const complexityAdjustment = complexityShape >= 0
            ? complexityShape * complexityPenaltyCap
            : complexityShape * complexityBenefitCap;

        const commentDensityProgress = Math.max(0, commentDensity) / Math.max(1, commentFullBenefitDensity);
        const commentShape = Math.tanh(commentDensityProgress * 2.646);
        const commentAdjustment = commentShape * commentBenefitCap;

        let factor = 1.0 + complexityAdjustment - commentAdjustment;
        factor = Math.max(0.5, Math.min(1 + complexityPenaltyCap, factor));

        return parseFloat((baseHours * factor).toFixed(2));
    }

    async calculateDiffMetrics(
        file: FileContent,
        addedLines: number[],
        removedLines: number[],
        status: 'added' | 'modified' | 'deleted'
    ): Promise<DiffFileMetrics> {
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

        const commentQuery = new Query(lang, this.config.queries.comments);
        const commentCaptures = commentQuery.captures(tree.rootNode);
        const commentOnlyLines = new Set<number>();

        for (const capture of commentCaptures) {
            for (let i = capture.node.startPosition.row; i <= capture.node.endPosition.row; i++) {
                const lineNum = i + 1;
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
                if (lineContent === '') continue;
                if (commentOnlyLines.has(lineNum)) {
                    linesWithComments++;
                    continue;
                }
                diffNloc++;
            }
        }

        const branchQuery = new Query(lang, this.config.queries.branching);
        const branchCaptures = branchQuery.captures(tree.rootNode);
        const branches = branchCaptures.map(c => c.node);

        let diffComplexity = 0;
        for (const lineNum of addedLines) {
            const lineIdx = lineNum - 1;
            if (lineIdx >= 0 && lineIdx < lines.length) {
                const lineContent = lines[lineIdx].trim();
                if (lineContent === '' || commentOnlyLines.has(lineNum)) continue;
                const nestingDepth = this.calculateNestingDepthForLine(lineNum, branches);
                diffComplexity += nestingDepth;
            }
        }

        const commentDensity = diffNloc > 0
            ? parseFloat(((linesWithComments / diffNloc) * 100).toFixed(2))
            : 0;

        const normalizedComplexity = diffNloc > 0 ? (diffComplexity / diffNloc) * 100 : 0;

        const estimatedHours = this.calculateEstimation(diffNloc, normalizedComplexity, commentDensity);

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

    private calculateNestingDepthForLine(lineNum: number, branches: Node[]): number {
        const lineIdx = lineNum - 1;
        let depth = 0;

        for (const branch of branches) {
            const branchStartLine = branch.startPosition.row;
            const branchEndLine = branch.endPosition.row;

            if (lineIdx >= branchStartLine && lineIdx <= branchEndLine) {
                depth++;
            }
        }

        return depth;
    }

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
                        startLine: node.startPosition.row + 1,
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

function walkDescendants(node: Node, callback: (n: Node) => void): void {
    for (const child of node.children) {
        callback(child);
        walkDescendants(child, callback);
    }
}
