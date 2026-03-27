export enum SupportedLanguage {
    Solidity = "solidity",
    Cpp = "cpp",
    JavaScript = "javascript",
    TypeScript = "typescript",
    Tsx = "tsx",
    Flow = "flow",
    Java = "java",
    Go = "go",
    Rust = "rust",
    Cairo = "cairo",
    Compact = "compact",
    Move = "move",
    Noir = "noir",
    Tolk = "tolk",
    Masm = "masm",
    Python = "python",
}

export interface FileContent {
    path: string;
    content: string;
}

export type Visibility = 'public' | 'external' | 'internal' | 'private';

export type ContainerKind =
    | 'contract' | 'interface' | 'library'  // Solidity
    | 'class' | 'struct'                     // C++, Java, Move, Rust
    | 'impl'                                 // Cairo, Rust
    | 'module'                               // Move, Python
    | (string & {});                         // extensible

export interface FileMetrics {
    file: string;
    nloc: number;
    linesWithComments: number;
    commentDensity: number;
    cognitiveComplexity: number;
    estimatedHours: number;
}

export interface DiffFileMetrics {
    file: string;
    status: 'added' | 'modified' | 'deleted';
    addedLines: number;
    removedLines: number;
    diffNloc: number;
    diffComplexity: number;
    commentDensity: number;
    estimatedHours: number;
}

// ==========================================
// Graph types
// ==========================================

import type { Node as TreeSitterNode, Tree } from "web-tree-sitter";
export type { TreeSitterNode as SyntaxNode };
export type { Tree };

export type NodeId = string; // UUID, stable identity

export type NodeKind =
    | 'function'
    | 'state_variable'
    | 'container'
    | 'event'
    | 'modifier'
    | (string & {});

export type EdgeKind =
    | 'calls'
    | 'writes'
    | 'reads'
    | 'contains'
    | 'has_modifier'
    | 'inherits'
    | 'emits'
    | (string & {});

/** Precise source position using byte offsets for O(log n) tree lookup. */
export interface SourceLocator {
    file: string;
    startIndex: number;  // byte offset — use tree.rootNode.descendantForIndex(startIndex, endIndex)
    endIndex: number;
    line: number;        // 1-indexed
    column: number;      // 0-indexed
}

export interface GraphNode {
    id: NodeId;
    kind: NodeKind;
    qualifiedName: string;       // display/label only — NOT the lookup key
    status: 'concrete' | 'gap' | 'external';
    language: SupportedLanguage;
    locator?: SourceLocator;     // absent for gap/external nodes
    label: string;               // short name
    visibility: Visibility;
    resolvedBy: ResolvedBy;
    confidence: Confidence;
    // Kind-specific metadata (not relationships — those are edges)
    containerKind?: ContainerKind; // 'container' nodes only
    pattern?: ModifierPattern;     // 'modifier' nodes only
}

export interface CallEdgeAttrs {
    targetKind: CallTargetKind;
    callSite?: { startIndex: number; line: number };
}

export interface GraphEdge {
    from: NodeId;
    to: NodeId;
    kind: EdgeKind;
    attrs?: CallEdgeAttrs | Record<string, unknown>;
}

export interface SerializedGraph {
    nodes: Record<NodeId, GraphNode>;
    edges: GraphEdge[];
}

/**
 * Property graph of program symbols and their relationships.
 * Nodes are identified by stable UUIDs (NodeId), not by name strings.
 * Maintains two locator indexes:
 *   _byLocator: "file:line:col" → NodeId  (exact, for adapter lookups)
 *   _byLine:    "file:line"     → NodeId  (line-only, for agent-provided resolutions)
 */
export class SymbolGraph {
    private _nodes = new Map<NodeId, GraphNode>();
    private _outEdges = new Map<NodeId, GraphEdge[]>();
    private _inEdges = new Map<NodeId, GraphEdge[]>();
    private _byLocator = new Map<string, NodeId>(); // "file:line:col" → NodeId
    private _byLine = new Map<string, NodeId>();    // "file:line" → NodeId
    private _byName = new Map<string, NodeId[]>();  // qualifiedName → NodeId[]

    addNode(node: GraphNode): void {
        this._nodes.set(node.id, node);
        const existing = this._byName.get(node.qualifiedName) ?? [];
        if (!existing.includes(node.id)) {
            this._byName.set(node.qualifiedName, [...existing, node.id]);
        }
        if (node.locator) {
            const { file, line, column } = node.locator;
            this._byLocator.set(`${file}:${line}:${column}`, node.id);
            this._byLine.set(`${file}:${line}`, node.id);
        }
    }

    addEdge(edge: GraphEdge): void {
        const out = this._outEdges.get(edge.from) ?? [];
        out.push(edge);
        this._outEdges.set(edge.from, out);
        const inList = this._inEdges.get(edge.to) ?? [];
        inList.push(edge);
        this._inEdges.set(edge.to, inList);
    }

    /** Update fields on an existing node. Maintains locator indexes. */
    updateNode(id: NodeId, updates: Partial<GraphNode>): void {
        const node = this._nodes.get(id);
        if (!node) return;
        if (updates.locator && !node.locator) {
            const { file, line, column } = updates.locator;
            this._byLocator.set(`${file}:${line}:${column}`, id);
            this._byLine.set(`${file}:${line}`, id);
        }
        Object.assign(node, updates);
    }

    /** Remove a node and all its incident edges. */
    removeNode(id: NodeId): void {
        const node = this._nodes.get(id);
        if (!node) return;
        const nameList = this._byName.get(node.qualifiedName) ?? [];
        this._byName.set(node.qualifiedName, nameList.filter(n => n !== id));
        if (node.locator) {
            const { file, line, column } = node.locator;
            this._byLocator.delete(`${file}:${line}:${column}`);
            this._byLine.delete(`${file}:${line}`);
        }
        for (const edge of (this._outEdges.get(id) ?? [])) {
            const inList = this._inEdges.get(edge.to) ?? [];
            this._inEdges.set(edge.to, inList.filter(e => e.from !== id));
        }
        for (const edge of (this._inEdges.get(id) ?? [])) {
            const outList = this._outEdges.get(edge.from) ?? [];
            this._outEdges.set(edge.from, outList.filter(e => e.to !== id));
        }
        this._outEdges.delete(id);
        this._inEdges.delete(id);
        this._nodes.delete(id);
    }

    getNode(id: NodeId): GraphNode | undefined { return this._nodes.get(id); }
    getOutEdges(id: NodeId): GraphEdge[] { return this._outEdges.get(id) ?? []; }
    getInEdges(id: NodeId): GraphEdge[] { return this._inEdges.get(id) ?? []; }

    /** Outgoing edges of a specific kind from a node. */
    getOutEdgesOfKind(id: NodeId, kind: EdgeKind): GraphEdge[] {
        return this.getOutEdges(id).filter(e => e.kind === kind);
    }

    /** Incoming edges of a specific kind to a node. */
    getInEdgesOfKind(id: NodeId, kind: EdgeKind): GraphEdge[] {
        return this.getInEdges(id).filter(e => e.kind === kind);
    }

    /** Members reached by outgoing `contains` edges from a container node. */
    getContainerMembers(containerId: NodeId): GraphNode[] {
        return this.getOutEdgesOfKind(containerId, 'contains')
            .map(e => this._nodes.get(e.to))
            .filter((n): n is GraphNode => !!n);
    }

    /** Container reached by incoming `contains` edge to a member node. */
    getContainerOf(memberId: NodeId): GraphNode | undefined {
        const edge = this.getInEdgesOfKind(memberId, 'contains')[0];
        return edge ? this._nodes.get(edge.from) : undefined;
    }

    /** BFS walk of outgoing `inherits` edges from a container. */
    getInheritanceChain(containerId: NodeId): GraphNode[] {
        const result: GraphNode[] = [];
        const visited = new Set<NodeId>();
        const queue = [containerId];
        while (queue.length > 0) {
            const id = queue.shift()!;
            for (const edge of this.getOutEdgesOfKind(id, 'inherits')) {
                if (visited.has(edge.to)) continue;
                visited.add(edge.to);
                const node = this._nodes.get(edge.to);
                if (node) {
                    result.push(node);
                    queue.push(edge.to);
                }
            }
        }
        return result;
    }

    /** Functions with incoming `writes` edges to a state variable node. */
    getWriters(stateVarId: NodeId): GraphNode[] {
        return this.getInEdgesOfKind(stateVarId, 'writes')
            .map(e => this._nodes.get(e.from))
            .filter((n): n is GraphNode => !!n);
    }

    /** Functions with incoming `reads` edges to a state variable node. */
    getReaders(stateVarId: NodeId): GraphNode[] {
        return this.getInEdgesOfKind(stateVarId, 'reads')
            .map(e => this._nodes.get(e.from))
            .filter((n): n is GraphNode => !!n);
    }

    /** Exact lookup by file + line + column. Used by adapters during identifyCalls. */
    findByLocatorExact(file: string, line: number, column: number): GraphNode | undefined {
        const id = this._byLocator.get(`${file}:${line}:${column}`);
        return id ? this._nodes.get(id) : undefined;
    }

    /** Line-only lookup. Used by gap resolution (agent provides file:line). */
    findByLine(file: string, line: number): GraphNode | undefined {
        const id = this._byLine.get(`${file}:${line}`);
        return id ? this._nodes.get(id) : undefined;
    }

    /** Line-only lookup returning NodeId. */
    findIdByLine(file: string, line: number): NodeId | undefined {
        return this._byLine.get(`${file}:${line}`);
    }

    findByName(qualifiedName: string): GraphNode[] {
        return (this._byName.get(qualifiedName) ?? [])
            .map(id => this._nodes.get(id)!)
            .filter(Boolean);
    }

    nodes(): IterableIterator<GraphNode> { return this._nodes.values(); }

    *edges(): IterableIterator<GraphEdge> {
        for (const edgeList of this._outEdges.values()) yield* edgeList;
    }

    get size(): number { return this._nodes.size; }

    /** Merge all nodes and edges from another graph. Skips duplicate node IDs. */
    merge(other: SymbolGraph): void {
        for (const node of other.nodes()) {
            if (!this._nodes.has(node.id)) this.addNode(node);
        }
        for (const edge of other.edges()) {
            const out = this._outEdges.get(edge.from) ?? [];
            if (!out.some(e => e.to === edge.to && e.kind === edge.kind)) this.addEdge(edge);
        }
    }

    toJSON(): SerializedGraph {
        const nodes: Record<NodeId, GraphNode> = {};
        for (const [id, node] of this._nodes) nodes[id] = node;
        const edges: GraphEdge[] = [];
        for (const edgeList of this._outEdges.values()) edges.push(...edgeList);
        return { nodes, edges };
    }

    static fromJSON(data: SerializedGraph): SymbolGraph {
        const graph = new SymbolGraph();
        for (const node of Object.values(data.nodes)) graph.addNode(node);
        for (const edge of data.edges) graph.addEdge(edge);
        return graph;
    }
}

// ==========================================
// Shared vocabulary
// ==========================================

export type ResolvedBy = 'static' | 'agent' | 'manual';
export type Confidence = 'high' | 'medium' | 'low';
export type ScanStatus = 'pending' | 'needs_resolution' | 'ready' | 'complete';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingKind = 'issue' | 'smell' | 'pointer';
export type RuleSource = 'shipped' | 'custom';

export type CallTargetKind =
    | 'internal'
    | 'cross_module'
    | 'interface_dispatch'
    | 'external_unknown';

export type GapType =
    | 'unresolved_callee'
    | 'interface_impl'
    | 'inherited_fn'
    | 'external_library'
    | 'dynamic_dispatch'
    | 'unknown_state_write';
export type GapPriority = 'high' | 'medium' | 'low';

export type LanguageDomain = 'on-chain' | 'off-chain';
export type InheritanceModel = 'classical' | 'trait-based' | 'none';

export const LANGUAGE_META: Record<SupportedLanguage, {
    domain: LanguageDomain;
    inheritanceModel: InheritanceModel;
}> = {
    [SupportedLanguage.Solidity]:   { domain: 'on-chain',  inheritanceModel: 'classical'   },
    [SupportedLanguage.Cairo]:      { domain: 'on-chain',  inheritanceModel: 'trait-based'  },
    [SupportedLanguage.Compact]:    { domain: 'on-chain',  inheritanceModel: 'none'         },
    [SupportedLanguage.Move]:       { domain: 'on-chain',  inheritanceModel: 'none'         },
    [SupportedLanguage.Noir]:       { domain: 'on-chain',  inheritanceModel: 'none'         },
    [SupportedLanguage.Tolk]:       { domain: 'on-chain',  inheritanceModel: 'none'         },
    [SupportedLanguage.Masm]:       { domain: 'on-chain',  inheritanceModel: 'none'         },
    [SupportedLanguage.Rust]:       { domain: 'off-chain', inheritanceModel: 'trait-based'  },
    [SupportedLanguage.Cpp]:        { domain: 'off-chain', inheritanceModel: 'classical'    },
    [SupportedLanguage.Java]:       { domain: 'off-chain', inheritanceModel: 'classical'    },
    [SupportedLanguage.Go]:         { domain: 'off-chain', inheritanceModel: 'none'         },
    [SupportedLanguage.TypeScript]: { domain: 'off-chain', inheritanceModel: 'classical'    },
    [SupportedLanguage.JavaScript]: { domain: 'off-chain', inheritanceModel: 'classical'    },
    [SupportedLanguage.Tsx]:        { domain: 'off-chain', inheritanceModel: 'classical'    },
    [SupportedLanguage.Flow]:       { domain: 'off-chain', inheritanceModel: 'classical'    },
    [SupportedLanguage.Python]:     { domain: 'off-chain', inheritanceModel: 'classical'    },
};

export type KnownFramework =
    | 'anchor' | 'solana-native' | 'cosmwasm' | 'substrate' | 'ink' | 'near'
    | 'starknet'
    | 'ape' | 'brownie'
    | (string & {});

export type ModifierPattern = 'explicit' | 'wrapper' | 'declarative';

export interface ModifierInfo {
    name: string;
    pattern: ModifierPattern;
}

export type BuiltinCategory = 'caller' | 'environment' | 'contract_state' | 'other';

export interface BuiltinContextValue {
    name: string;
    category: BuiltinCategory;
}

// ==========================================
// Language adapter interface
// ==========================================

export interface LanguageAdapter {
    languageId: SupportedLanguage;
    framework?: string;

    // Primary operation
    generateGraph(files: FileContent[]): Promise<SymbolGraph>;

    // Metrics/signatures (unchanged)
    extractSignatures(files: FileContent[]): Promise<Record<string, string[]>>;
    calculateMetrics(files: FileContent[]): Promise<FileMetrics[]>;
    calculateDiffMetrics(
        file: FileContent,
        addedLines: number[],
        removedLines: number[],
        status: 'added' | 'modified' | 'deleted'
    ): Promise<DiffFileMetrics>;

    // Node classifiers
    isFunctionDef(node: TreeSitterNode): boolean;
    isExternalCall(node: TreeSitterNode): boolean;
    isStateWrite(node: TreeSitterNode): boolean;
    isStateRead(node: TreeSitterNode): boolean;
    isAccessModifier(node: TreeSitterNode): boolean;
    isReturnStatement(node: TreeSitterNode): boolean;
    isPublicFn(node: TreeSitterNode): boolean;
    isEmitStatement(node: TreeSitterNode): boolean;

    // Extractors
    getFunctionName(node: TreeSitterNode): string | null;
    getCallTarget(node: TreeSitterNode): string | null;
    getWrittenVar(node: TreeSitterNode): string | null;
    getModifiers(node: TreeSitterNode): ModifierInfo[];
    getEventName(node: TreeSitterNode): string | null;

    // Resolution (used by engine, not walker)
    isBuiltinContextValue(node: TreeSitterNode): BuiltinContextValue | null;
}

// ==========================================
// Scan context
// ==========================================

export interface ScanContext {
    domainOverrides?: Partial<Record<SupportedLanguage, LanguageDomain>>;
    framework?: string;
}

export interface EffectiveLanguageMeta {
    domain: LanguageDomain;
    inheritanceModel: InheritanceModel;
    framework?: string;
}

// ==========================================
// Rule types
// ==========================================

export interface RuleApplicability {
    languages?: SupportedLanguage[];
    domains?: LanguageDomain[];
    inheritanceModels?: InheritanceModel[];
    frameworks?: string[];
}

export interface RuleContext {
    graph: SymbolGraph;
    trait: LanguageAdapter;
    effective: EffectiveLanguageMeta;
    sourceFiles: Map<string, string>;
    treeCache: Map<string, Tree>;
    currentFile: string;
    getTree(file: string): Promise<Tree>;
}

export interface FindingInstance {
    location: { file: string; line: number; col: number };
    snippet: string;
    executionPath?: string[];
}

export interface RuleFinding {
    ruleId: string;
    ruleSource: RuleSource;
    severity: Severity;
    kind: FindingKind;
    title: string;
    description: string;
    confidence: Confidence;
    resolvedBy: ResolvedBy;
    instances: FindingInstance[];
}

export interface Rule {
    id: string;
    severity: Severity;
    title: string;
    description: string;
    kind: FindingKind;
    appliesTo: RuleApplicability;

    /** Deep rules follow call edges during AST walk. */
    deep?: { maxDepth: number };

    enter?(node: TreeSitterNode, ctx: RuleContext): void;
    exit?(node: TreeSitterNode, ctx: RuleContext): void;
    finalize(ctx: RuleContext): FindingInstance[];
    reset(): void;
}

export interface MapRule {
    id: string;
    severity: Severity;
    title: string;
    description: string;
    kind: FindingKind;
    appliesTo: RuleApplicability;

    check(graph: SymbolGraph, ctx: RuleContext): FindingInstance[];
}
