import { Entrypoint, FileContent, SupportedLanguage, CallGraph, GraphNode, GraphEdge } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";

/**
 * Represents the type of function call being analyzed.
 * - Simple: Direct function call (e.g., `foo()`)
 * - Member: Member access call (e.g., `obj.foo()`)
 * - This: Explicit this call (e.g., `this.foo()`)
 * - Super: Parent contract call (e.g., `super.foo()`)
 */
enum CallType {
    Simple,
    Member,
    This,
    Super
}

type Visibility = 'public' | 'external' | 'internal' | 'private';

/**
 * Language adapter for Solidity smart contracts.
 * Handles entrypoint extraction, call graph generation, and metrics calculation.
 */
export class SolidityAdapter extends BaseAdapter {
    // Tree-sitter query strings
    private static readonly QUERIES = {
        CONTAINERS: `
            [(contract_declaration) (interface_declaration) (library_declaration)] @container
        `,
        INHERITANCE: `
            (inheritance_specifier ancestor: (user_defined_type (identifier) @parent))
        `,
        USING_FOR: `
            (using_directive (type_alias (identifier) @lib))
        `,
        FUNCTIONS: `
            [(function_definition) (fallback_receive_definition)] @function
        `,
        SUPER_CALL: `
            (call_expression function: (expression (member_expression object: (identifier) @RECV (#eq? @RECV "super") property: (identifier) @FUNC)))
        `,
        THIS_CALL: `
            (call_expression function: (expression (member_expression object: (identifier) @RECV (#eq? @RECV "this") property: (identifier) @FUNC)))
        `,
        MEMBER_CALL: `
            (call_expression function: (expression (member_expression object: (_) @RECV property: (identifier) @FUNC)))
        `,
        SIMPLE_CALL: `
            (call_expression function: (expression (identifier) @FUNC))
        `,
        ASSEMBLY_CALL: `
            (yul_function_call function: (yul_identifier) @FUNC)
        `
    } as const;

    constructor() {
        super({
            languageId: SupportedLanguage.Solidity,
            queries: {
                comments: '(comment) @comment',
                functions: `
                    (function_definition) @function
                    (fallback_receive_definition) @function
                `,
                branching: `
                    (if_statement) @branch
                    (for_statement) @branch
                    (while_statement) @branch
                    (do_while_statement) @branch
                    (catch_clause) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_definition) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 250,
                // Smart contracts should be structurally simple. Even moderate CC
                // density is already risky, so the neutral point is low.
                complexityMidpoint: 11,
                // Complexity penalties ramp quickly: a small increase above midpoint
                // (loops, nested branches, tricky control flow) should strongly
                // impact audit time.
                complexitySteepness: 8,
                // Complex Solidity (value transfers, reentrancy, upgradeability,
                // gas edge cases) can easily cost up to ~75% more review time.
                // Simplicity helps, but we cap its benefit at ~25%.
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.75,
                // NatSpec-style docs and invariants/role explanations are highly
                // valuable. Rich documentation can improve throughput by up to ~35%,
                // especially for protocol-level contracts.
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.35
            }
        });
    }

    private symbolTable: Map<string, GraphNode> = new Map();
    private inheritanceGraph: Map<string, string[]> = new Map(); // child -> parents
    private usingForMap: Map<string, string[]> = new Map(); // contract -> libraries

    // Optimization: Index symbols for faster lookups
    private symbolsByContract: Map<string, GraphNode[]> = new Map();
    private symbolsByLabel: Map<string, GraphNode[]> = new Map();

    private static readonly BUILTIN_FUNCTIONS = new Set(['require', 'assert', 'revert', 'emit']);

    /**
     * Generates a complete call graph for Solidity contracts.
     * Includes nodes for all functions and edges representing function calls.
     * Handles inheritance, super calls, library usage, and assembly calls.
     * 
     * @param files - Array of Solidity source files to analyze
     * @returns Call graph with nodes and edges
     */
    async generateCallGraph(files: FileContent[]): Promise<CallGraph> {
        this.resetState();
        const edges: GraphEdge[] = [];

        // Phase 1: Symbol Table & Inheritance Generation
        await this.buildSymbolTable(files);

        // Phase 2: Call Identification
        await this.identifyCalls(edges, files);

        // Return nodes
        const nodes: GraphNode[] = Array.from(this.symbolTable.values());

        return { nodes, edges };
    }

    /**
     * Resets all internal state (symbol table, inheritance graph, etc.).
     * Called at the start of each analysis operation.
     */
    private resetState() {
        this.symbolTable.clear();
        this.inheritanceGraph.clear();
        this.usingForMap.clear();
        this.symbolsByContract.clear();
        this.symbolsByLabel.clear();
    }

    /**
     * Indexes a symbol in the symbol table and optimization indices.
     * 
     * @param node - GraphNode to index
     */
    private indexSymbol(node: GraphNode) {
        this.symbolTable.set(node.id, node);

        if (node.contract) {
            const nodes = this.symbolsByContract.get(node.contract) || [];
            nodes.push(node);
            this.symbolsByContract.set(node.contract, nodes);
        }

        const nodes = this.symbolsByLabel.get(node.label) || [];
        nodes.push(node);
        this.symbolsByLabel.set(node.label, nodes);
    }

    private findInContract(contract: string, label: string): GraphNode | undefined {
        return this.symbolsByContract.get(contract)?.find(n => n.label === label);
    }

    private async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);
        const parser = await service.createParser(SupportedLanguage.Solidity);

        const functionQuery = new Query(lang, SolidityAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const captures = functionQuery.captures(tree.rootNode);
            for (const capture of captures) {
                const functionNode = capture.node;

                // Find the corresponding GraphNode in our symbol table
                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                // Rule 1: Super calls
                await this.processCallType(functionNode, symbol, edges, {
                    callType: CallType.Super
                });

                // Rule 2: Member calls
                await this.processCallType(functionNode, symbol, edges, {
                    callType: CallType.Member,
                    extractMember: true
                });

                // Rule 3: This calls
                await this.processCallType(functionNode, symbol, edges, {
                    callType: CallType.This
                });

                // Rule 4: Simple calls
                await this.processCallType(functionNode, symbol, edges, {
                    callType: CallType.Simple
                });

                // Rule 5: Assembly calls
                await this.processAssemblyCalls(functionNode, symbol, edges);
            }
        }
    }

    /**
     * Finds a GraphNode in the symbol table matching a tree-sitter node's position.
     * 
     * @param node - Tree-sitter node to locate
     * @param filePath - File path containing the node
     * @returns Matching GraphNode or undefined
     */
    private findSymbolAtNode(node: Node, filePath: string): GraphNode | undefined {
        const line = node.startPosition.row + 1;
        const col = node.startPosition.column;

        return Array.from(this.symbolTable.values()).find(s =>
            s.file === filePath &&
            s.range?.start.line === line &&
            s.range?.start.column === col
        );
    }

    /**
     * Processes function calls of a specific type within a function node.
     * 
     * @param functionNode - The tree-sitter node representing the function
     * @param symbol - The GraphNode representing this function in the symbol table
     * @param edges - Array to collect discovered call edges
     * @param callConfig - Configuration specifying the call type and options
     */
    private async processCallType(
        functionNode: Node,
        symbol: GraphNode,
        edges: GraphEdge[],
        callConfig: {
            callType: CallType;
            extractMember?: boolean;
        }
    ) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);

        const querySource = this.getQueryForCallType(callConfig.callType);
        const query = new Query(lang, querySource);
        const matches = query.matches(functionNode);

        for (const match of matches) {
            const functionCapture = match.captures.find(c => c.name === 'FUNC');
            if (!functionCapture) continue;

            const funcName = functionCapture.node.text;
            let memberName: string | undefined;

            if (callConfig.extractMember) {
                const recvCapture = match.captures.find(c => c.name === 'RECV');
                memberName = recvCapture?.node.text;
            }

            if (this.shouldSkipCall(funcName, memberName, callConfig.callType)) continue;

            const calleeNode = this.resolveCallNode(callConfig.callType, funcName, memberName, symbol);
            if (calleeNode) {
                const kind = this.determineEdgeKind(callConfig.callType, calleeNode);
                edges.push({ from: symbol.id, to: calleeNode.id, kind });
            }
        }
    }

    /**
     * Returns the appropriate tree-sitter query string for a given call type.
     */
    private getQueryForCallType(callType: CallType): string {
        switch (callType) {
            case CallType.Super:
                return SolidityAdapter.QUERIES.SUPER_CALL;
            case CallType.This:
                return SolidityAdapter.QUERIES.THIS_CALL;
            case CallType.Member:
                return SolidityAdapter.QUERIES.MEMBER_CALL;
            case CallType.Simple:
                return SolidityAdapter.QUERIES.SIMPLE_CALL;
        }
    }


    private determineEdgeKind(callType: CallType, callee: GraphNode): 'internal' | 'external' {
        if (callType === CallType.This) return 'external';
        if (callType === CallType.Super) return 'internal';
        if (callType === CallType.Simple) {
            return 'internal';
        }

        if (callee.containerKind === 'library') {
            return callee.visibility === 'internal' ? 'internal' : 'external';
        }

        return 'external';
    }

    private async processAssemblyCalls(functionNode: Node, symbol: GraphNode, edges: GraphEdge[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);

        const query = new Query(lang, SolidityAdapter.QUERIES.ASSEMBLY_CALL);
        const captures = query.captures(functionNode);

        for (const capture of captures) {
            const callName = capture.node.text;
            const calleeNode = this.resolveCallNode(CallType.Simple, callName, undefined, symbol);
            if (calleeNode) {
                edges.push({ from: symbol.id, to: calleeNode.id, kind: 'internal' });
            }
        }
    }

    private shouldSkipCall(funcName: string, memberName: string | undefined, callType: CallType): boolean {
        if (SolidityAdapter.BUILTIN_FUNCTIONS.has(funcName)) return true;
        if (callType === CallType.Member && memberName === 'super') return true;
        if (callType === CallType.Simple && funcName.includes('.')) return true;
        return false;
    }

    private resolveCallNode(type: CallType, name: string, memberName: string | undefined, caller: GraphNode): GraphNode | undefined {
        switch (type) {
            case CallType.Super:
                return this.resolveSuperCall(name, caller);
            case CallType.Member:
                return this.resolveMemberCall(name, memberName!, caller);
            case CallType.This:
            case CallType.Simple:
                return this.resolveLocalOrInheritedCall(name, caller);
        }
        return undefined;
    }

    private resolveSuperCall(name: string, caller: GraphNode): GraphNode | undefined {
        if (!caller.contract) return undefined;
        const parents = this.inheritanceGraph.get(caller.contract);
        if (!parents?.length) return undefined;

        for (const parent of parents) {
            const func = this.findInContract(parent, name);
            if (func) return func;
        }
        return undefined;
    }

    private resolveMemberCall(name: string, memberName: string, caller: GraphNode): GraphNode | undefined {
        const func = this.findInContract(memberName, name);
        if (func) return func;

        if (caller.contract) {
            const libraries = this.usingForMap.get(caller.contract);
            if (libraries) {
                for (const lib of libraries) {
                    const libFunc = this.findInContract(lib, name);
                    if (libFunc) return libFunc;
                }
            }
        }
        return undefined;
    }

    private resolveLocalOrInheritedCall(name: string, caller: GraphNode): GraphNode | undefined {
        if (caller.contract) {
            const local = this.findInContract(caller.contract, name);
            if (local) return local;

            const inherited = this.resolveInheritedCall(name, caller.contract);
            if (inherited) return inherited;
        }

        const freeFuncs = this.symbolsByLabel.get(name);
        const free = freeFuncs?.find(n => !n.contract);
        if (free) return free;

        const any = this.symbolsByLabel.get(name)?.[0];
        return any;
    }

    private resolveInheritedCall(name: string, contract: string, visited: Set<string> = new Set()): GraphNode | undefined {
        if (visited.has(contract)) return undefined;
        visited.add(contract);

        const parents = this.inheritanceGraph.get(contract);
        if (!parents) return undefined;

        for (const parent of parents) {
            const func = this.findInContract(parent, name);
            if (func) return func;

            const inherited = this.resolveInheritedCall(name, parent, visited);
            if (inherited) return inherited;
        }
        return undefined;
    }

    /**
     * Builds the complete symbol table for all contracts, interfaces, and libraries.
     * Also populates inheritance and using-for mappings.
     * 
     * @param files - Array of Solidity source files to analyze
     */
    private async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);
        const parser = await service.createParser(SupportedLanguage.Solidity);

        const containerQuery = new Query(lang, SolidityAdapter.QUERIES.CONTAINERS);
        const inheritanceQuery = new Query(lang, SolidityAdapter.QUERIES.INHERITANCE);
        const usingQuery = new Query(lang, SolidityAdapter.QUERIES.USING_FOR);
        const functionQuery = new Query(lang, SolidityAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // 1. Find all containers (contracts, interfaces, libraries)
            const containerCaptures = containerQuery.captures(tree.rootNode);

            for (const capture of containerCaptures) {
                const containerNode = capture.node;
                const kind = containerNode.type.replace('_declaration', '') as 'contract' | 'interface' | 'library';
                const nameNode = containerNode.childForFieldName('name');
                if (!nameNode) continue;
                const contractName = nameNode.text;

                // Handle Inheritance
                const inheritanceCaptures = inheritanceQuery.captures(containerNode);
                const parentsText = inheritanceCaptures
                    .filter(c => c.name === 'parent')
                    .map(c => c.node.text);

                if (parentsText.length > 0) {
                    this.inheritanceGraph.set(contractName, parentsText);
                }

                // Track using-for directives
                const usingCaptures = usingQuery.captures(containerNode);
                const libs = usingCaptures
                    .filter(c => c.name === 'lib')
                    .map(c => c.node.text);

                if (libs.length > 0) {
                    this.usingForMap.set(contractName, libs);
                }

                // Find functions inside container
                const bodyNode = containerNode.childForFieldName('body');
                if (bodyNode) {
                    const functions = functionQuery.captures(bodyNode);
                    for (const fnCapture of functions) {
                        this.indexSymbol(await this.createFunctionNode(fnCapture.node, file.path, kind, contractName));
                    }
                }
            }

            // 2. Find free functions (not inside a container)
            for (const child of tree.rootNode.children) {
                if (child.type === 'function_definition' || child.type === 'fallback_receive_definition') {
                    this.indexSymbol(await this.createFunctionNode(child, file.path));
                }
            }
        }
    }

    /**
     * Creates a GraphNode from a tree-sitter function node.
     * Handles regular functions, fallback, and receive functions.
     * 
     * @param node - Tree-sitter node representing the function
     * @param file - File path containing this function
     * @param containerKind - Type of container (contract, interface, library)
     * @param contract - Name of the containing contract
     * @returns GraphNode representing this function
     */
    private async createFunctionNode(node: Node, file: string, containerKind?: 'contract' | 'interface' | 'library', contract?: string): Promise<GraphNode> {
        let fnName = 'unknown';
        let params = '';
        let visibility: Visibility | undefined;

        if (node.type === 'fallback_receive_definition') {
            fnName = node.text.trim().startsWith('receive') ? 'receive' : 'fallback';
            visibility = 'external';
        } else {
            const nameNode = node.childForFieldName('name');
            fnName = nameNode ? nameNode.text : 'unknown';

            // Extract parameters from direct children
            const paramTexts: string[] = [];
            for (const child of node.children) {
                if (child.type === 'parameter') {
                    paramTexts.push(child.text);
                }
            }
            params = paramTexts.join(', ');

            // Extract visibility - check direct children for visibility node
            visibility = this.extractVisibility(node);
        }

        const signature = this.cleanSignature(`${fnName}(${params})`);
        const id = contract ? `${contract}.${signature}` : signature;

        const finalVisibility: Visibility = visibility ??
            (containerKind === 'interface' ? 'external' : 'internal');

        return {
            id,
            label: fnName,
            file,
            contract,
            containerKind,
            visibility: finalVisibility,
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column }
            },
            text: node.text
        };
    }

    /**
     * Extracts visibility from a function node by checking its children.
     * Handles various grammar structures robustly.
     * 
     * @param node - Function definition node
     * @returns Visibility string or undefined if not found
     */
    private extractVisibility(node: Node): Visibility | undefined {
        // First, check for a direct 'visibility' child
        for (const child of node.children) {
            if (child.type === 'visibility') {
                const text = child.text;
                if (text === 'public' || text === 'external' || text === 'internal' || text === 'private') {
                    return text;
                }
            }
        }

        // Fallback: some grammar versions might have visibility as text in other nodes
        // Check for common visibility keywords in the function signature
        const signatureText = node.text.split('{')[0]; // Get everything before the body
        if (signatureText.includes(' external')) return 'external';
        if (signatureText.includes(' public')) return 'public';
        if (signatureText.includes(' internal')) return 'internal';
        if (signatureText.includes(' private')) return 'private';

        return undefined;
    }
}
