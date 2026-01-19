import { FileContent, SupportedLanguage, CallGraph, GraphNode, GraphEdge } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";

type Visibility = 'public' | 'external' | 'internal' | 'private';

export class RustAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        IMPL_BLOCKS: `
            (impl_item) @impl
        `,
        FUNCTIONS: `
            (function_item) @function
        `,
        SIMPLE_CALL: `
            (call_expression function: (identifier) @FUNC)
        `,
        METHOD_CALL: `
            (call_expression function: (field_expression field: (field_identifier) @FUNC))
        `,
        SCOPED_CALL: `
            (call_expression function: (scoped_identifier) @FUNC)
        `,
        GENERIC_CALL: `
            (call_expression function: (generic_function function: (identifier) @FUNC))
        `,
        GENERIC_SCOPED_CALL: `
            (call_expression function: (generic_function function: (scoped_identifier) @FUNC))
        `
    } as const;

    private symbolTable: Map<string, GraphNode> = new Map();
    private symbolsByLabel: Map<string, GraphNode[]> = new Map();
    private symbolsByContainer: Map<string, GraphNode[]> = new Map();

    constructor() {
        super({
            languageId: SupportedLanguage.Rust,
            queries: {
                comments: `
                    (line_comment) @comment
                    (block_comment) @comment
                `,
                functions: '(function_item) @function',
                branching: `
                    (if_expression) @branch
                    (for_expression) @branch
                    (while_expression) @branch
                    (loop_expression) @branch
                    (match_expression) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_item) @norm
                    (array_expression) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 400,
                complexityMidpoint: 16,
                complexitySteepness: 10,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 0.7,
                commentFullBenefitDensity: 18,
                commentBenefitCap: 0.35
            }
        });
    }

    async generateCallGraph(files: FileContent[]): Promise<CallGraph> {
        this.resetState();
        const edges: GraphEdge[] = [];

        // Phase 1: Build symbol table
        await this.buildSymbolTable(files);

        // Phase 2: Identify calls
        await this.identifyCalls(edges, files);

        const nodes: GraphNode[] = Array.from(this.symbolTable.values());
        return { nodes, edges };
    }

    private resetState() {
        this.symbolTable.clear();
        this.symbolsByLabel.clear();
        this.symbolsByContainer.clear();
    }

    private indexSymbol(node: GraphNode) {
        this.symbolTable.set(node.id, node);

        const labelNodes = this.symbolsByLabel.get(node.label) || [];
        labelNodes.push(node);
        this.symbolsByLabel.set(node.label, labelNodes);

        if (node.contract) {
            const containerNodes = this.symbolsByContainer.get(node.contract) || [];
            containerNodes.push(node);
            this.symbolsByContainer.set(node.contract, containerNodes);
        }
    }

    private async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Rust);
        const parser = await service.createParser(SupportedLanguage.Rust);

        const implQuery = new Query(lang, RustAdapter.QUERIES.IMPL_BLOCKS);
        const functionQuery = new Query(lang, RustAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // 1. Find all impl blocks and their functions
            const implCaptures = implQuery.captures(tree.rootNode);
            for (const capture of implCaptures) {
                const implNode = capture.node;
                const containerName = this.extractImplTypeName(implNode);

                // Find functions inside impl block
                const bodyNode = implNode.childForFieldName('body');
                if (bodyNode) {
                    const funcCaptures = functionQuery.captures(bodyNode);
                    for (const funcCapture of funcCaptures) {
                        const node = await this.createFunctionNode(
                            funcCapture.node,
                            file.path,
                            containerName
                        );
                        this.indexSymbol(node);
                    }
                }
            }

            // 2. Find free functions (not inside impl blocks)
            for (const child of tree.rootNode.children) {
                if (child.type === 'function_item') {
                    // Check if this function is inside an impl block
                    const isInImpl = implCaptures.some(c => {
                        const body = c.node.childForFieldName('body');
                        return body &&
                            child.startIndex >= body.startIndex &&
                            child.endIndex <= body.endIndex;
                    });

                    if (!isInImpl) {
                        const node = await this.createFunctionNode(child, file.path);
                        this.indexSymbol(node);
                    }
                }

                // 3. Find functions inside mod blocks
                if (child.type === 'mod_item') {
                    await this.processModItem(child, file.path, functionQuery);
                }
            }
        }
    }

    private async processModItem(modNode: Node, filePath: string, functionQuery: Query) {
        const modName = modNode.childForFieldName('name')?.text;
        const bodyNode = modNode.childForFieldName('body');

        if (bodyNode && modName) {
            const funcCaptures = functionQuery.captures(bodyNode);
            for (const funcCapture of funcCaptures) {
                const node = await this.createFunctionNode(
                    funcCapture.node,
                    filePath,
                    modName
                );
                this.indexSymbol(node);
            }
        }
    }

    private extractImplTypeName(implNode: Node): string {
        // impl Type { ... } -> "Type"
        // impl Trait for Type { ... } -> "Type"
        const typeNode = implNode.childForFieldName('type');
        if (typeNode) {
            // Handle generic types: extract base name
            if (typeNode.type === 'generic_type') {
                const typeName = typeNode.childForFieldName('type');
                return typeName?.text ?? typeNode.text;
            }
            return typeNode.text;
        }
        return 'unknown';
    }

    private async createFunctionNode(
        node: Node,
        file: string,
        container?: string
    ): Promise<GraphNode> {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';

        const visibility = this.extractVisibility(node);
        const id = container ? `${container}::${fnName}` : fnName;

        return {
            id,
            label: fnName,
            file,
            contract: container,
            visibility,
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column }
            },
            text: node.text
        };
    }

    private extractVisibility(node: Node): Visibility {
        for (const child of node.children) {
            if (child.type === 'visibility_modifier') {
                const text = child.text;
                if (text === 'pub') return 'public';
                if (text.startsWith('pub(crate)')) return 'internal';
                if (text.startsWith('pub(super)')) return 'internal';
                if (text.startsWith('pub(in')) return 'internal';
                return 'public';
            }
        }
        return 'private';
    }

    private async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Rust);
        const parser = await service.createParser(SupportedLanguage.Rust);

        const functionQuery = new Query(lang, RustAdapter.QUERIES.FUNCTIONS);
        const simpleCallQuery = new Query(lang, RustAdapter.QUERIES.SIMPLE_CALL);
        const methodCallQuery = new Query(lang, RustAdapter.QUERIES.METHOD_CALL);
        const scopedCallQuery = new Query(lang, RustAdapter.QUERIES.SCOPED_CALL);
        const genericCallQuery = new Query(lang, RustAdapter.QUERIES.GENERIC_CALL);
        const genericScopedCallQuery = new Query(lang, RustAdapter.QUERIES.GENERIC_SCOPED_CALL);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);

            for (const capture of funcCaptures) {
                const functionNode = capture.node;
                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                // Process different call types
                await this.processCallQuery(simpleCallQuery, functionNode, symbol, edges, 'simple');
                await this.processCallQuery(methodCallQuery, functionNode, symbol, edges, 'method');
                await this.processCallQuery(scopedCallQuery, functionNode, symbol, edges, 'scoped');
                await this.processCallQuery(genericCallQuery, functionNode, symbol, edges, 'simple');
                await this.processCallQuery(genericScopedCallQuery, functionNode, symbol, edges, 'scoped');
            }
        }
    }

    private async processCallQuery(
        query: Query,
        functionNode: Node,
        caller: GraphNode,
        edges: GraphEdge[],
        callType: 'simple' | 'method' | 'scoped'
    ) {
        const captures = query.captures(functionNode);

        for (const capture of captures) {
            if (capture.name !== 'FUNC') continue;

            const callText = capture.node.text;

            // Skip macro invocations (they end with !)
            if (this.isMacroCall(capture.node)) continue;

            const callee = this.resolveCall(callText, callType, caller);
            if (callee && callee.id !== caller.id) {
                // Avoid duplicate edges
                const exists = edges.some(e => e.from === caller.id && e.to === callee.id);
                if (!exists) {
                    edges.push({
                        from: caller.id,
                        to: callee.id,
                        kind: 'internal'
                    });
                }
            }
        }
    }

    private isMacroCall(node: Node): boolean {
        // Check if the parent is a macro_invocation
        let current = node.parent;
        while (current) {
            if (current.type === 'macro_invocation') return true;
            if (current.type === 'call_expression') return false;
            current = current.parent;
        }
        return false;
    }

    private resolveCall(
        callText: string,
        callType: 'simple' | 'method' | 'scoped',
        caller: GraphNode
    ): GraphNode | undefined {
        if (callType === 'scoped') {
            // Handle qualified calls like Type::method or module::function
            const parts = callText.split('::');
            const funcName = parts[parts.length - 1];
            const containerName = parts.slice(0, -1).join('::');

            // Try to find in the specified container
            const containerFuncs = this.symbolsByContainer.get(containerName);
            const match = containerFuncs?.find(n => n.label === funcName);
            if (match) return match;

            // Fallback to any function with that name
            return this.symbolsByLabel.get(funcName)?.[0];
        }

        if (callType === 'method') {
            // Method calls: self.method() or obj.method()
            // Try to resolve within the same container first
            if (caller.contract) {
                const containerFuncs = this.symbolsByContainer.get(caller.contract);
                const match = containerFuncs?.find(n => n.label === callText);
                if (match) return match;
            }

            // Fallback to any function with that label
            return this.symbolsByLabel.get(callText)?.[0];
        }

        // Simple calls
        // 1. Try same container
        if (caller.contract) {
            const containerFuncs = this.symbolsByContainer.get(caller.contract);
            const match = containerFuncs?.find(n => n.label === callText);
            if (match) return match;
        }

        // 2. Try free functions
        const freeFuncs = this.symbolsByLabel.get(callText);
        const free = freeFuncs?.find(n => !n.contract);
        if (free) return free;

        // 3. Any match
        return this.symbolsByLabel.get(callText)?.[0];
    }

    private findSymbolAtNode(node: Node, filePath: string): GraphNode | undefined {
        const line = node.startPosition.row + 1;
        const col = node.startPosition.column;

        return Array.from(this.symbolTable.values()).find(s =>
            s.file === filePath &&
            s.range?.start.line === line &&
            s.range?.start.column === col
        );
    }
}
