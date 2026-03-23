import crypto from "crypto";
import {
    LanguageAdapter, FileContent, SupportedLanguage, FileMetrics, DiffFileMetrics,
    SymbolGraph, GraphNode, GraphEdge, NodeId, NodeKind, ModifierPattern,
    CallTargetKind, CallEdgeAttrs,
    ModifierInfo, BuiltinContextValue, Visibility, ContainerKind,
    ResolvedBy, Confidence,
} from "../engine/types.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node, Tree } from "web-tree-sitter";

export interface AdapterConfig {
    languageId: SupportedLanguage;
    queries: {
        comments: string;
        functions: string;
        branching: string;
        normalization?: string;
    };
    constants: {
        baseRateNlocPerDay: number;
        complexityMidpoint: number;
        complexitySteepness: number;
        complexityBenefitCap: number;
        complexityPenaltyCap: number;
        commentFullBenefitDensity: number;
        commentBenefitCap: number;
    };
}

export abstract class BaseAdapter implements LanguageAdapter {
    languageId: SupportedLanguage;
    protected config: AdapterConfig;

    constructor(config: AdapterConfig) {
        this.languageId = config.languageId;
        this.config = config;
    }

    protected _graph: SymbolGraph = new SymbolGraph();
    // Per-scan gap node cache: qualifiedName → NodeId. Reset on each generateGraph call.
    private _gapNodesByName: Map<string, NodeId> = new Map();
    // Container index: containerName → NodeId[]. Shared by all adapters; reset per scan.
    protected _nodesByContainer: Map<string, NodeId[]> = new Map();
    // Container node index: containerName → NodeId of the container node itself.
    protected _containerNodesByName: Map<string, NodeId> = new Map();
    // Event node cache: eventName → NodeId.
    private _eventNodesByName: Map<string, NodeId> = new Map();
    // Modifier node cache: modifierName → NodeId.
    private _modifierNodesByName: Map<string, NodeId> = new Map();

    protected cleanSignature(raw: string): string {
        return raw.replace(/\s+/g, ' ')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
            .replace(/\s*,\s*/g, ', ')
            .trim();
    }

    // ==========================================
    // Primary: graph generation
    // ==========================================

    async generateGraph(files: FileContent[]): Promise<SymbolGraph> {
        this.resetState();
        await this.buildSymbolTable(files);
        await this.identifyCalls(files);
        await this.enrichNodes(files);
        return this._graph;
    }

    // ==========================================
    // Internal state management
    // ==========================================

    protected resetState(): void {
        this._graph = new SymbolGraph();
        this._gapNodesByName.clear();
        this._nodesByContainer.clear();
        this._containerNodesByName.clear();
        this._eventNodesByName.clear();
        this._modifierNodesByName.clear();
    }

    /** Add a node to the graph, index by container name, emit `contains` edge. */
    protected addNode(node: GraphNode, containerName?: string): void {
        this._graph.addNode(node);
        if (containerName) {
            const list = this._nodesByContainer.get(containerName) ?? [];
            list.push(node.id);
            this._nodesByContainer.set(containerName, list);

            const containerId = this._containerNodesByName.get(containerName);
            if (containerId) {
                this._graph.addEdge({ from: containerId, to: node.id, kind: 'contains' });
            }
        }
    }

    /** Get the container name for a node via its incoming `contains` edge. */
    protected getContainerName(nodeId: NodeId): string | undefined {
        return this._graph.getContainerOf(nodeId)?.label;
    }

    /**
     * Creates a container node (contract, class, impl, module) and registers it.
     * Call BEFORE adding member nodes so that `contains` edges are emitted automatically.
     */
    protected addContainerNode(opts: {
        name: string;
        containerKind: ContainerKind;
        visibility: Visibility;
        node: Node;
        file: string;
    }): NodeId {
        const id = crypto.randomUUID();
        const graphNode: GraphNode = {
            id,
            kind: 'container',
            qualifiedName: opts.name,
            status: 'concrete',
            language: this.languageId,
            label: opts.name,
            locator: {
                file: opts.file,
                startIndex: opts.node.startIndex,
                endIndex: opts.node.endIndex,
                line: opts.node.startPosition.row + 1,
                column: opts.node.startPosition.column,
            },
            visibility: opts.visibility,
            resolvedBy: 'static',
            confidence: 'high',
            containerKind: opts.containerKind,
        };
        this._graph.addNode(graphNode);
        this._containerNodesByName.set(opts.name, id);
        return id;
    }

    /**
     * Emits an `inherits` edge from child container to parent container.
     * Creates a gap container node for the parent if it doesn't exist yet.
     */
    protected addInheritsEdge(childName: string, parentName: string): void {
        const childId = this._containerNodesByName.get(childName);
        if (!childId) return;

        let parentId = this._containerNodesByName.get(parentName);
        if (!parentId) {
            // Create a gap container node for the unresolved parent
            parentId = crypto.randomUUID();
            this._graph.addNode({
                id: parentId,
                kind: 'container',
                qualifiedName: parentName,
                status: 'gap',
                language: this.languageId,
                label: parentName,
                visibility: 'public',
                resolvedBy: 'static',
                confidence: 'low',
            });
            this._containerNodesByName.set(parentName, parentId);
        }

        this._graph.addEdge({ from: childId, to: parentId, kind: 'inherits' });
    }

    /** Find a node by container name and label. Uses contains edges when available, falls back to index. */
    protected findInContainer(container: string, label: string): GraphNode | undefined {
        // Try graph-based lookup via contains edges first
        const containerId = this._containerNodesByName.get(container);
        if (containerId) {
            for (const member of this._graph.getContainerMembers(containerId)) {
                if (member.label === label) return member;
            }
        }
        // Fallback to string index (for containers without container nodes, e.g. Go)
        const ids = this._nodesByContainer.get(container);
        if (!ids) return undefined;
        for (const id of ids) {
            const n = this._graph.getNode(id);
            if (n?.label === label) return n;
        }
        return undefined;
    }

    /**
     * Creates a GraphNode with sensible defaults from a tree-sitter AST node.
     * Uses byte offsets (startIndex/endIndex) for precise, O(log n) AST re-entry.
     */
    protected createNode(opts: {
        qualifiedName: string;
        label: string;
        node: Node;
        file: string;
        visibility: Visibility;
        kind?: NodeKind;
    }): GraphNode {
        return {
            id: crypto.randomUUID(),
            kind: opts.kind ?? 'function',
            qualifiedName: opts.qualifiedName,
            status: 'concrete',
            language: this.languageId,
            label: opts.label,
            locator: {
                file: opts.file,
                startIndex: opts.node.startIndex,
                endIndex: opts.node.endIndex,
                line: opts.node.startPosition.row + 1,
                column: opts.node.startPosition.column,
            },
            visibility: opts.visibility,
            resolvedBy: 'static' as ResolvedBy,
            confidence: 'high' as Confidence,
        };
    }

    /**
     * Emits has_modifier edges from a node to modifier nodes.
     * Call after addNode() for nodes that have modifiers.
     */
    protected addModifiers(nodeId: NodeId, modifiers: ModifierInfo[], containerName?: string): void {
        for (const mod of modifiers) {
            const modNodeId = this._getOrCreateModifierNode(mod.name, mod.pattern, containerName);
            this._graph.addEdge({ from: nodeId, to: modNodeId, kind: 'has_modifier' });
        }
    }

    /**
     * Find the graph node whose source position exactly matches the given AST node.
     * Used during identifyCalls to locate the caller.
     */
    protected findNodeAtPosition(node: Node, filePath: string): GraphNode | undefined {
        return this._graph.findByLocatorExact(
            filePath,
            node.startPosition.row + 1,
            node.startPosition.column,
        );
    }

    /**
     * Add a call edge from caller to target. Resolves target by name in the graph;
     * creates a gap node if unresolved. Filters known stdlib calls.
     */
    protected addCallEdge(
        callerId: NodeId,
        targetQn: string,
        targetKind: CallTargetKind,
        callSite: { startIndex: number; line: number },
    ): void {
        if (targetKind === 'external_unknown' && this.isKnownStdlib(targetQn)) return;

        let targetId: NodeId;
        if (targetKind !== 'external_unknown' && targetKind !== 'interface_dispatch') {
            const candidates = this._graph.findByName(targetQn);
            const concrete = candidates.find(n => n.status === 'concrete');
            targetId = concrete?.id ?? this._getOrCreateGapNode(targetQn);
        } else {
            targetId = this._getOrCreateGapNode(targetQn);
        }

        // Deduplicate edges to the same target from the same caller
        const existing = this._graph.getOutEdges(callerId);
        if (existing.some(e => e.to === targetId && e.kind === 'calls')) return;

        this._graph.addEdge({
            from: callerId,
            to: targetId,
            kind: 'calls',
            attrs: { targetKind, callSite } as CallEdgeAttrs,
        });
    }

    private _getOrCreateGapNode(qualifiedName: string): NodeId {
        const existing = this._gapNodesByName.get(qualifiedName);
        if (existing) return existing;
        const id = crypto.randomUUID();
        this._graph.addNode({
            id,
            kind: 'function',
            qualifiedName,
            status: 'gap',
            language: this.languageId,
            label: qualifiedName.split(/[.:(]/).shift() ?? qualifiedName,
            visibility: 'internal',
            resolvedBy: 'static',
            confidence: 'low',
        });
        this._gapNodesByName.set(qualifiedName, id);
        return id;
    }

    protected isKnownStdlib(_name: string): boolean { return false; }

    protected async buildSymbolTable(_files: FileContent[]): Promise<void> {}
    protected async identifyCalls(_files: FileContent[]): Promise<void> {}

    /**
     * Enriches function nodes: extracts modifiers, state writes/reads, and emits
     * by walking each function's AST body. All results become graph edges.
     */
    protected async enrichNodes(files: FileContent[]): Promise<void> {
        const service = TreeSitterService.getInstance();
        const parser = await service.createParser(this.languageId);

        const treeCache = new Map<string, Tree>();
        for (const file of files) {
            const tree = parser.parse(file.content);
            if (tree) treeCache.set(file.path, tree);
        }

        for (const node of this._graph.nodes()) {
            if (node.status !== 'concrete' || !node.locator) continue;
            if (node.kind !== 'function') continue;
            const tree = treeCache.get(node.locator.file);
            if (!tree) continue;

            const funcNode = tree.rootNode.descendantForIndex(
                node.locator.startIndex,
                node.locator.endIndex,
            );
            if (!funcNode) continue;

            const containerName = this.getContainerName(node.id);

            // Extract modifiers if none were set during buildSymbolTable
            const existingModEdges = this._graph.getOutEdgesOfKind(node.id, 'has_modifier');
            if (existingModEdges.length === 0) {
                const mods = this.getModifiers(funcNode);
                if (mods.length > 0) {
                    this.addModifiers(node.id, mods, containerName);
                }
            }

            // Walk AST for state writes, reads, and emit statements → emit edges directly
            const seenWrites = new Set<string>();
            const seenReads = new Set<string>();
            walkDescendants(funcNode, (child) => {
                if (this.isStateWrite(child)) {
                    const varName = this.getWrittenVar(child);
                    if (varName && !seenWrites.has(varName)) {
                        seenWrites.add(varName);
                        const svId = this._resolveStateVar(varName, containerName);
                        if (svId) this._graph.addEdge({ from: node.id, to: svId, kind: 'writes' });
                    }
                }
                if (this.isStateRead(child)) {
                    const text = child.text;
                    if (text && text.length < 80 && !seenReads.has(text)) {
                        seenReads.add(text);
                        const svId = this._resolveStateVar(text, containerName);
                        if (svId) this._graph.addEdge({ from: node.id, to: svId, kind: 'reads' });
                    }
                }
                if (this.isEmitStatement(child)) {
                    const eventName = this.getEventName(child);
                    if (eventName) {
                        const eventNodeId = this._getOrCreateEventNode(eventName, containerName);
                        this._graph.addEdge({ from: node.id, to: eventNodeId, kind: 'emits' });
                    }
                }
            });
        }
    }

    /** Resolve a state variable name to its NodeId, trying qualified then unqualified names. */
    private _resolveStateVar(varName: string, containerName?: string): NodeId | undefined {
        if (containerName) {
            const qualified = `${containerName}.${varName}`;
            const candidates = this._graph.findByName(qualified);
            const sv = candidates.find(n => n.kind === 'state_variable');
            if (sv) return sv.id;
        }
        const candidates = this._graph.findByName(varName);
        const sv = candidates.find(n => n.kind === 'state_variable');
        return sv?.id;
    }

    /** Get or create an event node by name. */
    private _getOrCreateEventNode(eventName: string, containerName?: string): NodeId {
        const existing = this._eventNodesByName.get(eventName);
        if (existing) return existing;
        const id = crypto.randomUUID();
        this._graph.addNode({
            id,
            kind: 'event',
            qualifiedName: containerName ? `${containerName}.${eventName}` : eventName,
            status: 'gap',
            language: this.languageId,
            label: eventName,
            visibility: 'public',
            resolvedBy: 'static',
            confidence: 'medium',
        });
        this._eventNodesByName.set(eventName, id);
        return id;
    }

    /** Get or create a modifier node by name. */
    private _getOrCreateModifierNode(modName: string, pattern: ModifierPattern, containerName?: string): NodeId {
        const key = containerName ? `${containerName}.${modName}` : modName;
        const existing = this._modifierNodesByName.get(key);
        if (existing) return existing;

        // Try to find a concrete modifier definition already in the graph
        const candidates = this._graph.findByName(key);
        const concrete = candidates.find(n => n.kind === 'modifier' && n.status === 'concrete');
        if (concrete) {
            this._modifierNodesByName.set(key, concrete.id);
            return concrete.id;
        }

        const id = crypto.randomUUID();
        this._graph.addNode({
            id,
            kind: 'modifier',
            qualifiedName: key,
            status: 'gap',
            language: this.languageId,
            label: modName,
            visibility: 'internal',
            resolvedBy: 'static',
            confidence: 'medium',
            pattern,
        });
        this._modifierNodesByName.set(key, id);
        return id;
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
    isEmitStatement(_node: Node): boolean { return false; }

    // ==========================================
    // Extractor stubs (override in adapters)
    // ==========================================

    getFunctionName(_node: Node): string | null { return null; }
    getCallTarget(_node: Node): string | null { return null; }
    getWrittenVar(_node: Node): string | null { return null; }
    getModifiers(_node: Node): ModifierInfo[] { return []; }
    getEventName(_node: Node): string | null { return null; }

    // ==========================================
    // Resolution stubs (override in adapters)
    // ==========================================

    isBuiltinContextValue(_node: Node): BuiltinContextValue | null { return null; }

    // ==========================================
    // Signatures, metrics, diff (unchanged)
    // ==========================================

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
                        const bodyNode = node.childForFieldName('body') ||
                            node.children.find(c => c.type.includes('body') || c.type === 'block');
                        const rawSignature = bodyNode
                            ? file.content.substring(node.startIndex, bodyNode.startIndex)
                            : node.text;
                        const signature = this.cleanSignature(rawSignature);
                        signatures.push(signature.length > 80 ? signature.substring(0, 77) + '...' : signature);
                    }
                }
                if (signatures.length > 0) signaturesByFile[file.path] = signatures;
            } catch (e) {
                console.error(`Error extracting signatures for ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        return signaturesByFile;
    }

    async calculateMetrics(files: FileContent[]): Promise<FileMetrics[]> {
        const results: FileMetrics[] = [];
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(this.languageId);
        const parser = await service.createParser(this.languageId);

        const commentQuery = new Query(lang, this.config.queries.comments);
        const branchQuery = new Query(lang, this.config.queries.branching);
        const normQuery = this.config.queries.normalization
            ? new Query(lang, this.config.queries.normalization) : null;

        for (const file of files) {
            const lines = file.content.split('\n');
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const { linesWithComments, onlyCommentLinesCount } =
                this.calculateCommentMetrics(commentQuery, tree.rootNode, lines);
            const cognitiveComplexity = this.calculateCognitiveComplexity(branchQuery, tree.rootNode);
            const blankLines = lines.filter(line => line.trim() === '').length;
            const normalizationAdjustment = normQuery
                ? this.calculateNormalizationAdjustment(normQuery, tree.rootNode) : 0;

            const nloc = Math.max(0, lines.length - blankLines - onlyCommentLinesCount - normalizationAdjustment);
            const commentDensity = nloc > 0 ? parseFloat(((linesWithComments / nloc) * 100).toFixed(2)) : 0;
            const normalizedComplexity = nloc > 0 ? (cognitiveComplexity / nloc) * 100 : 0;

            results.push({
                file: file.path,
                nloc,
                linesWithComments,
                commentDensity,
                cognitiveComplexity,
                estimatedHours: this.calculateEstimation(nloc, normalizedComplexity, commentDensity),
            });
        }
        return results;
    }

    private calculateCommentMetrics(commentQuery: Query, rootNode: Node, lines: string[]) {
        const commentLinesSet = new Set<number>();
        for (const capture of commentQuery.captures(rootNode)) {
            for (let i = capture.node.startPosition.row; i <= capture.node.endPosition.row; i++) {
                commentLinesSet.add(i);
            }
        }
        let onlyCommentLinesCount = 0;
        for (const lineIdx of commentLinesSet) {
            if (lineIdx >= lines.length) continue;
            if (/^(\/\/|\/\*|\*|#)/.test(lines[lineIdx].trim())) onlyCommentLinesCount++;
        }
        return { linesWithComments: commentLinesSet.size, onlyCommentLinesCount };
    }

    private calculateCognitiveComplexity(branchQuery: Query, rootNode: Node): number {
        const branches = branchQuery.captures(rootNode).map(c => c.node);
        let complexity = 0;
        for (const branch of branches) {
            let nesting = 0;
            for (const other of branches) {
                if (branch === other) continue;
                if (other.startIndex <= branch.startIndex && other.endIndex >= branch.endIndex &&
                    (other.startIndex < branch.startIndex || other.endIndex > branch.endIndex)) {
                    nesting++;
                }
            }
            complexity += 1 + nesting;
        }
        return complexity;
    }

    private calculateNormalizationAdjustment(normQuery: Query, rootNode: Node): number {
        const allConstructs = normQuery.captures(rootNode).map(c => ({ node: c.node, name: c.name }));
        const topLevel = allConstructs.filter(construct => {
            return !allConstructs.some(other => {
                if (construct === other) return false;
                const isOtherFn = other.name.includes('function') || other.name.includes('method') ||
                    other.node.type.includes('function') || other.node.type.includes('method');
                if (isOtherFn) {
                    const body = other.node.childForFieldName('body') ||
                        other.node.children.find(c => c.type.includes('body') || c.type === 'block');
                    if (body && construct.node.startIndex >= body.startIndex) return false;
                }
                return other.node.startIndex <= construct.node.startIndex &&
                    other.node.endIndex >= construct.node.endIndex &&
                    (other.node.startIndex < construct.node.startIndex || other.node.endIndex > construct.node.endIndex);
            });
        });

        let adjustment = 0;
        for (const construct of topLevel) {
            let startLine = construct.node.startPosition.row;
            let endLine = construct.node.endPosition.row;
            const isFn = construct.name.includes('function') || construct.name.includes('method') ||
                construct.node.type.includes('function') || construct.node.type.includes('method');
            if (isFn) {
                const body = construct.node.childForFieldName('body') ||
                    construct.node.children.find(c => c.type.includes('body') || c.type === 'block');
                if (body) endLine = body.startPosition.row - 1;
            }
            const span = endLine - startLine + 1;
            if (span > 1) adjustment += span - 1;
        }
        return adjustment;
    }

    private calculateEstimation(nloc: number, normalizedComplexity: number, commentDensity: number): number {
        const {
            baseRateNlocPerDay, complexityMidpoint, complexitySteepness,
            complexityBenefitCap, complexityPenaltyCap, commentFullBenefitDensity, commentBenefitCap,
        } = this.config.constants;
        const baseHours = (nloc / baseRateNlocPerDay) * 8;
        const complexityDelta = normalizedComplexity - complexityMidpoint;
        const complexityShape = Math.tanh(complexityDelta / complexitySteepness);
        const complexityAdjustment = complexityShape >= 0
            ? complexityShape * complexityPenaltyCap : complexityShape * complexityBenefitCap;
        const commentShape = Math.tanh((Math.max(0, commentDensity) / Math.max(1, commentFullBenefitDensity)) * 2.646);
        let factor = 1.0 + complexityAdjustment - commentShape * commentBenefitCap;
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
            return { file: file.path, status, addedLines: 0, removedLines: removedLines.length, diffNloc: 0, diffComplexity: 0, commentDensity: 0, estimatedHours: 0 };
        }
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(this.languageId);
        const parser = await service.createParser(this.languageId);
        const tree = parser.parse(file.content);
        if (!tree) {
            return { file: file.path, status, addedLines: addedLines.length, removedLines: removedLines.length, diffNloc: addedLines.length, diffComplexity: 0, commentDensity: 0, estimatedHours: 0 };
        }
        const lines = file.content.split('\n');
        const commentQuery = new Query(lang, this.config.queries.comments);
        const commentOnlyLines = new Set<number>();
        for (const capture of commentQuery.captures(tree.rootNode)) {
            for (let i = capture.node.startPosition.row; i <= capture.node.endPosition.row; i++) {
                const lineNum = i + 1;
                if (lineNum < lines.length && /^(\/\/|\/\*|\*|#|--|;;)/.test(lines[i].trim())) {
                    commentOnlyLines.add(lineNum);
                }
            }
        }
        let diffNloc = 0;
        let linesWithComments = 0;
        for (const lineNum of addedLines) {
            const lineIdx = lineNum - 1;
            if (lineIdx < 0 || lineIdx >= lines.length) continue;
            if (lines[lineIdx].trim() === '') continue;
            if (commentOnlyLines.has(lineNum)) { linesWithComments++; continue; }
            diffNloc++;
        }
        const branchQuery = new Query(lang, this.config.queries.branching);
        const branches = branchQuery.captures(tree.rootNode).map(c => c.node);
        let diffComplexity = 0;
        for (const lineNum of addedLines) {
            const lineIdx = lineNum - 1;
            if (lineIdx < 0 || lineIdx >= lines.length) continue;
            if (lines[lineIdx].trim() === '' || commentOnlyLines.has(lineNum)) continue;
            diffComplexity += this.calculateNestingDepthForLine(lineNum, branches);
        }
        const commentDensity = diffNloc > 0 ? parseFloat(((linesWithComments / diffNloc) * 100).toFixed(2)) : 0;
        const normalizedComplexity = diffNloc > 0 ? (diffComplexity / diffNloc) * 100 : 0;
        return {
            file: file.path, status,
            addedLines: addedLines.length, removedLines: removedLines.length,
            diffNloc, diffComplexity, commentDensity,
            estimatedHours: this.calculateEstimation(diffNloc, normalizedComplexity, commentDensity),
        };
    }

    private calculateNestingDepthForLine(lineNum: number, branches: Node[]): number {
        const lineIdx = lineNum - 1;
        let depth = 0;
        for (const branch of branches) {
            if (lineIdx >= branch.startPosition.row && lineIdx <= branch.endPosition.row) depth++;
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
            for (const capture of query.captures(tree.rootNode)) {
                if (capture.name !== 'function') continue;
                const node = capture.node;
                const bodyNode = node.childForFieldName('body') ||
                    node.children.find(c => c.type.includes('body') || c.type === 'block');
                const rawSignature = bodyNode
                    ? file.content.substring(node.startIndex, bodyNode.startIndex) : node.text;
                const signature = this.cleanSignature(rawSignature);
                results.push({
                    signature: signature.length > 120 ? signature.substring(0, 117) + '...' : signature,
                    startLine: node.startPosition.row + 1,
                    endLine: node.endPosition.row + 1,
                });
            }
        } catch (e) {
            console.error(`Error extracting signatures for ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return results;
    }
}

function walkDescendants(node: Node, callback: (n: Node) => void): void {
    for (const child of node.children) {
        callback(child);
        walkDescendants(child, callback);
    }
}
