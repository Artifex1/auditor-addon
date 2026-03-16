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

export interface Position {
    line: number;
    column: number;
}

export interface Range {
    start: Position;
    end: Position;
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

export interface LanguageAdapter {
    languageId: SupportedLanguage;
    framework?: string;

    // Primary operations
    generateSymbolMap(files: FileContent[]): Promise<SymbolMap>;
    extractSignatures(files: FileContent[]): Promise<Record<string, string[]>>;
    calculateMetrics(files: FileContent[]): Promise<FileMetrics[]>;
    calculateDiffMetrics(
        file: FileContent,
        addedLines: number[],
        removedLines: number[],
        status: 'added' | 'modified' | 'deleted'
    ): Promise<DiffFileMetrics>;

    // Node classifiers
    isFunctionDef(node: import("web-tree-sitter").Node): boolean;
    isExternalCall(node: import("web-tree-sitter").Node): boolean;
    isStateWrite(node: import("web-tree-sitter").Node): boolean;
    isStateRead(node: import("web-tree-sitter").Node): boolean;
    isAccessModifier(node: import("web-tree-sitter").Node): boolean;
    isReturnStatement(node: import("web-tree-sitter").Node): boolean;
    isPublicFn(node: import("web-tree-sitter").Node): boolean;
    isEmitStatement(node: import("web-tree-sitter").Node): boolean;

    // Extractors
    getFunctionName(node: import("web-tree-sitter").Node): string | null;
    getCallTarget(node: import("web-tree-sitter").Node): string | null;
    getWrittenVar(node: import("web-tree-sitter").Node): string | null;
    getModifiers(node: import("web-tree-sitter").Node): ModifierInfo[];

    // Resolution
    resolveCallee(
        node: import("web-tree-sitter").Node,
        symbolMap: SymbolMap,
        sourceFiles: Map<string, string>
    ): { qualifiedName: string; targetKind: CallTargetKind } | null;
    resolveExtensionMethod(
        receiverType: string,
        methodName: string,
        sourceFiles: Map<string, string>
    ): string | null;
    resolveScope(
        containerName: string,
        sourceFiles: Map<string, string>
    ): string[];
    isBuiltinContextValue(
        node: import("web-tree-sitter").Node
    ): BuiltinContextValue | null;
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
// SAiST types — SymbolMap data model (spec §3, §4, §6, §7)
// ==========================================

import type { Node as TreeSitterNode, Tree } from "web-tree-sitter";
export type { TreeSitterNode as SyntaxNode };
export type { Tree };

// --- Resolution provenance (§3) ---
export type ResolvedBy = 'static' | 'agent' | 'manual';
export type Confidence = 'high' | 'medium' | 'low';
export type ScanStatus = 'pending' | 'needs_resolution' | 'ready' | 'complete';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingKind = 'issue' | 'smell' | 'pointer';
export type RuleSource = 'shipped' | 'custom';

// --- Call target classification (§3) ---
export type CallTargetKind =
    | 'internal'
    | 'cross_module'
    | 'interface_dispatch'
    | 'external_unknown';

// --- Gap types (§3) ---
export type GapType =
    | 'unresolved_callee'
    | 'interface_impl'
    | 'inherited_fn'
    | 'external_library'
    | 'dynamic_dispatch'
    | 'unknown_state_write';
export type GapPriority = 'high' | 'medium' | 'low';

// --- Language metadata (§3) ---
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

// --- Modifier pattern (§6) ---
export type ModifierPattern = 'explicit' | 'wrapper' | 'declarative';

export interface ModifierInfo {
    name: string;
    pattern: ModifierPattern;
}

// --- Builtin context values (§6) ---
export type BuiltinCategory = 'caller' | 'environment' | 'contract_state' | 'other';

export interface BuiltinContextValue {
    name: string;
    category: BuiltinCategory;
}

// --- Symbol kind discriminator ---
export type SymbolKind = 'function' | 'state_variable';

// --- Symbol table (§4.1) ---
export interface CalleeEntry {
    qualifiedName: string;
    targetKind: CallTargetKind;
}

export interface SymbolEntry {
    qualifiedName: string;
    kind: SymbolKind;
    file: string;
    line: number;
    language: SupportedLanguage;
    writesState: string[];
    readsState: string[];
    callsExternal: boolean;
    callees: CalleeEntry[];
    isPublic: boolean;
    hasAccessControl: boolean;
    modifiers: ModifierInfo[];
    resolvedBy: ResolvedBy;
    confidence: Confidence;
    // Retained for call graph compat
    label: string;
    contract?: string;
    range?: Range;
    visibility: Visibility;
    containerKind?: ContainerKind;
}

export type SymbolMap = Map<string, SymbolEntry>;

// --- Scan context (§4.4) ---
export interface ScanContext {
    domainOverrides?: Partial<Record<SupportedLanguage, LanguageDomain>>;
    framework?: string;
}

export interface EffectiveLanguageMeta {
    domain: LanguageDomain;
    inheritanceModel: InheritanceModel;
    framework?: string;
}

// --- Rule types (§7.1) ---
export interface RuleApplicability {
    languages?: SupportedLanguage[];
    domains?: LanguageDomain[];
    inheritanceModels?: InheritanceModel[];
    frameworks?: string[];
}

export interface RuleContext {
    symbolMap: SymbolMap;
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

// --- Rule (§7 — unified rule interface) ---
export interface Rule {
    id: string;
    severity: Severity;
    title: string;
    description: string;
    kind: FindingKind;
    appliesTo: RuleApplicability;

    /** Deep rules follow call edges during AST walk. */
    deep?: { maxDepth: number };

    /** Called on every AST node during traversal (enter phase of DFS). */
    enter?(node: TreeSitterNode, ctx: RuleContext): void;
    /** Called when leaving an AST node (exit phase of DFS). */
    exit?(node: TreeSitterNode, ctx: RuleContext): void;

    /** Return accumulated findings. Called after each unit of work. */
    finalize(ctx: RuleContext): FindingInstance[];
    /** Clear all internal state. Called before each unit of work. */
    reset(): void;
}

// --- MapRule (§7 — post-processing over the completed SymbolMap) ---
export interface MapRule {
    id: string;
    severity: Severity;
    title: string;
    description: string;
    kind: FindingKind;
    appliesTo: RuleApplicability;

    /** Run once against the full symbol table. */
    check(symbolMap: SymbolMap, ctx: RuleContext): FindingInstance[];
}
