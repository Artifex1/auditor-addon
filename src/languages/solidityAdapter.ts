import { Entrypoint, FileContent, SupportedLanguage, CallGraph, GraphNode, GraphEdge } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";

enum CallType {
    Simple,
    Member,
    This,
    Super
}

export class SolidityAdapter extends BaseAdapter {
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

    async extractEntrypoints(files: FileContent[]): Promise<Entrypoint[]> {
        this.resetState();
        await this.buildSymbolTable(files);

        return Array.from(this.symbolTable.values())
            .filter(node => node.visibility === 'public' || node.visibility === 'external')
            .map(node => ({
                file: node.file,
                contract: node.contract || 'Unknown',
                name: node.label,
                signature: this.cleanSignature(node.id.includes('.') ? node.id.split('.').pop()! : node.id),
                visibility: node.visibility!,
                id: node.id
            }));
    }

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

    private resetState() {
        this.symbolTable.clear();
        this.inheritanceGraph.clear();
        this.usingForMap.clear();
        this.symbolsByContract.clear();
        this.symbolsByLabel.clear();
    }

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

        const functionQuery = new Query(lang, `
            [(function_definition) (fallback_receive_definition)] @function
        `);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const captures = functionQuery.captures(tree.rootNode);
            for (const capture of captures) {
                const fnNode = capture.node;

                // Find the corresponding GraphNode in our symbol table
                // We use the same ID generation logic as in buildSymbolTable/createFunctionNode
                // But wait, it's easier to just use the range to find the symbol.
                const symbol = this.findSymbolAtNode(fnNode, file.path);
                if (!symbol) continue;

                // Rule 1: Super calls
                await this.processCallType(fnNode, symbol, edges, {
                    callType: CallType.Super
                });

                // Rule 2: Member calls
                await this.processCallType(fnNode, symbol, edges, {
                    callType: CallType.Member,
                    extractMember: true
                });

                // Rule 3: This calls
                await this.processCallType(fnNode, symbol, edges, {
                    callType: CallType.This
                });

                // Rule 4: Simple calls
                await this.processCallType(fnNode, symbol, edges, {
                    callType: CallType.Simple
                });

                // Rule 5: Assembly calls
                await this.processAssemblyCalls(fnNode, symbol, edges);
            }
        }
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

    private async processCallType(
        tsNode: Node,
        symbol: GraphNode,
        edges: GraphEdge[],
        config: {
            callType: CallType;
            extractMember?: boolean;
        }
    ) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);

        const querySource = config.callType === CallType.Super
            ? '(call_expression function: (expression (member_expression object: (identifier) @RECV (#eq? @RECV "super") property: (identifier) @FUNC)))'
            : config.callType === CallType.This
                ? '(call_expression function: (expression (member_expression object: (identifier) @RECV (#eq? @RECV "this") property: (identifier) @FUNC)))'
                : config.callType === CallType.Member
                    ? '(call_expression function: (expression (member_expression object: (_) @RECV property: (identifier) @FUNC)))'
                    : '(call_expression function: (expression (identifier) @FUNC))';

        const query = new Query(lang, querySource);
        const matches = query.matches(tsNode);

        for (const match of matches) {
            const funcCapture = match.captures.find(c => c.name === 'FUNC');
            if (!funcCapture) continue;

            const funcName = funcCapture.node.text;
            let memberName: string | undefined;

            if (config.extractMember) {
                const recvCapture = match.captures.find(c => c.name === 'RECV');
                memberName = recvCapture?.node.text;
            }

            if (this.shouldSkipCall(funcName, memberName, config.callType)) continue;

            const calleeNode = this.resolveCallNode(config.callType, funcName, memberName, symbol);
            if (calleeNode) {
                const kind = this.determineEdgeKind(config.callType, calleeNode);
                edges.push({ from: symbol.id, to: calleeNode.id, kind });
            }
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

    private async processAssemblyCalls(tsNode: Node, symbol: GraphNode, edges: GraphEdge[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);

        const query = new Query(lang, '(yul_function_call function: (yul_identifier) @FUNC)');
        const captures = query.captures(tsNode);

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

    private async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);
        const parser = await service.createParser(SupportedLanguage.Solidity);

        const containerQuery = new Query(lang, `
            [(contract_declaration) (interface_declaration) (library_declaration)] @container
        `);

        const inheritanceQuery = new Query(lang, `
            (inheritance_specifier ancestor: (user_defined_type (identifier) @parent))
        `);

        const usingQuery = new Query(lang, `
            (using_directive (type_alias (identifier) @lib))
        `);

        const functionQuery = new Query(lang, `
            [(function_definition) (fallback_receive_definition)] @function
        `);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // 1. Find all containers
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

                // Track using-for
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

    private async createFunctionNode(node: Node, file: string, containerKind?: 'contract' | 'interface' | 'library', contract?: string): Promise<GraphNode> {
        let fnName = 'unknown';
        let params = '';
        let visibility: string | undefined;

        if (node.type === 'fallback_receive_definition') {
            fnName = node.text.trim().startsWith('receive') ? 'receive' : 'fallback';
            visibility = 'external';
        } else {
            const nameNode = node.childForFieldName('name');
            fnName = nameNode ? nameNode.text : 'unknown';

            // Parameters are direct children in this grammar
            const paramTexts: string[] = [];
            for (const child of node.children) {
                if (child.type === 'parameter') {
                    paramTexts.push(child.text);
                }
                if (child.type === 'visibility') {
                    visibility = child.text;
                }
            }
            params = paramTexts.join(', ');

            if (!visibility) {
                // FALLBACK: maybe visibility is not a direct child? 
                // In some versions it might be. Let's keep a query as backup or just check children.
                // Based on our debug AST, it IS a child.
            }
        }

        const signature = this.cleanSignature(`${fnName}(${params})`);
        const id = contract ? `${contract}.${signature}` : signature;

        const finalVisibility: 'public' | 'external' | 'internal' | 'private' = (visibility as any) ??
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
}
