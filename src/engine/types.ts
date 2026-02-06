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

export interface GraphNode {
    id: string; // Fully qualified signature (e.g., "MyContract.myFunc(uint256)")
    label: string; // Function name
    file: string;
    contract?: string;
    range?: Range;
    visibility: 'public' | 'external' | 'internal' | 'private';
    text?: string;
    containerKind?: 'contract' | 'interface' | 'library';
}

export interface GraphEdge {
    from: string; // node id
    to: string; // node id
    kind?: 'internal' | 'external';
}

export interface CallGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

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
    generateCallGraph(files: FileContent[]): Promise<CallGraph>;
    extractSignatures(files: FileContent[]): Promise<Record<string, string[]>>;
    calculateMetrics(files: FileContent[]): Promise<FileMetrics[]>;
    calculateDiffMetrics(
        file: FileContent,
        addedLines: number[],
        removedLines: number[],
        status: 'added' | 'modified' | 'deleted'
    ): Promise<DiffFileMetrics>;
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
