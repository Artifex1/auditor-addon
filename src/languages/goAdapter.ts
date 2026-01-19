import { FileContent, SupportedLanguage, CallGraph, GraphNode, GraphEdge } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";

type Visibility = 'public' | 'external' | 'internal' | 'private';

export class GoAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        FUNCTIONS: `
            (function_declaration) @function
        `,
        METHODS: `
            (method_declaration) @method
        `,
        SIMPLE_CALL: `
            (call_expression function: (identifier) @FUNC)
        `,
        SELECTOR_CALL: `
            (call_expression function: (selector_expression field: (field_identifier) @FUNC))
        `
    } as const;

    private static readonly BUILTIN_FUNCTIONS = new Set([
        'make', 'new', 'len', 'cap', 'append', 'copy', 'close', 'delete',
        'complex', 'real', 'imag', 'panic', 'recover', 'print', 'println',
        'min', 'max', 'clear'
    ]);

    private symbolTable: Map<string, GraphNode> = new Map();
    private symbolsByLabel: Map<string, GraphNode[]> = new Map();
    private symbolsByReceiver: Map<string, GraphNode[]> = new Map();

    constructor() {
        super({
            languageId: SupportedLanguage.Go,
            queries: {
                comments: '(comment) @comment',
                functions: `
                    (function_declaration) @function
                    (method_declaration) @function
                `,
                branching: `
                    (if_statement) @branch
                    (for_statement) @branch
                    (expression_switch_statement) @branch
                    (type_switch_statement) @branch
                    (select_statement) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_declaration) @norm
                    (method_declaration) @norm
                    (composite_literal) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 400,
                complexityMidpoint: 12,
                complexitySteepness: 9,
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.50,
                commentFullBenefitDensity: 15,
                commentBenefitCap: 0.25
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
        this.symbolsByReceiver.clear();
    }

    private indexSymbol(node: GraphNode) {
        this.symbolTable.set(node.id, node);

        const labelNodes = this.symbolsByLabel.get(node.label) || [];
        labelNodes.push(node);
        this.symbolsByLabel.set(node.label, labelNodes);

        if (node.contract) {
            const receiverNodes = this.symbolsByReceiver.get(node.contract) || [];
            receiverNodes.push(node);
            this.symbolsByReceiver.set(node.contract, receiverNodes);
        }
    }

    private async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Go);
        const parser = await service.createParser(SupportedLanguage.Go);

        const functionQuery = new Query(lang, GoAdapter.QUERIES.FUNCTIONS);
        const methodQuery = new Query(lang, GoAdapter.QUERIES.METHODS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // 1. Find all package-level functions
            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const node = this.createFunctionNode(capture.node, file.path);
                this.indexSymbol(node);
            }

            // 2. Find all methods
            const methodCaptures = methodQuery.captures(tree.rootNode);
            for (const capture of methodCaptures) {
                const node = this.createMethodNode(capture.node, file.path);
                this.indexSymbol(node);
            }
        }
    }

    private createFunctionNode(node: Node, file: string): GraphNode {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';

        const visibility = this.extractVisibility(fnName);
        const id = fnName;

        return {
            id,
            label: fnName,
            file,
            visibility,
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column }
            },
            text: node.text
        };
    }

    private createMethodNode(node: Node, file: string): GraphNode {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';

        const receiverType = this.extractReceiverType(node);
        const visibility = this.extractVisibility(fnName);
        const id = receiverType ? `${receiverType}.${fnName}` : fnName;

        return {
            id,
            label: fnName,
            file,
            contract: receiverType,
            visibility,
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column }
            },
            text: node.text
        };
    }

    private extractReceiverType(node: Node): string | undefined {
        const receiverNode = node.childForFieldName('receiver');
        if (!receiverNode) return undefined;

        // receiver is a parameter_list like (s *Server) or (s Server)
        // We need to find the type name
        const text = receiverNode.text;

        // Match patterns like (s *Type), (s Type), (*Type), (Type)
        const match = text.match(/\(\s*\w*\s*\*?\s*(\w+)\s*\)/);
        return match?.[1];
    }

    private extractVisibility(name: string): Visibility {
        // In Go, exported names start with uppercase
        if (name.length === 0) return 'private';
        const firstChar = name.charAt(0);
        return firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()
            ? 'public'
            : 'private';
    }

    private async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Go);
        const parser = await service.createParser(SupportedLanguage.Go);

        const functionQuery = new Query(lang, GoAdapter.QUERIES.FUNCTIONS);
        const methodQuery = new Query(lang, GoAdapter.QUERIES.METHODS);
        const simpleCallQuery = new Query(lang, GoAdapter.QUERIES.SIMPLE_CALL);
        const selectorCallQuery = new Query(lang, GoAdapter.QUERIES.SELECTOR_CALL);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // Process function declarations
            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const functionNode = capture.node;
                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                await this.processCallsInFunction(functionNode, symbol, edges, simpleCallQuery, selectorCallQuery);
            }

            // Process method declarations
            const methodCaptures = methodQuery.captures(tree.rootNode);
            for (const capture of methodCaptures) {
                const methodNode = capture.node;
                const symbol = this.findSymbolAtNode(methodNode, file.path);
                if (!symbol) continue;

                await this.processCallsInFunction(methodNode, symbol, edges, simpleCallQuery, selectorCallQuery);
            }
        }
    }

    private async processCallsInFunction(
        functionNode: Node,
        caller: GraphNode,
        edges: GraphEdge[],
        simpleCallQuery: Query,
        selectorCallQuery: Query
    ) {
        // Process simple calls: foo()
        const simpleCaptures = simpleCallQuery.captures(functionNode);
        for (const capture of simpleCaptures) {
            if (capture.name !== 'FUNC') continue;

            const callName = capture.node.text;
            if (GoAdapter.BUILTIN_FUNCTIONS.has(callName)) continue;

            const callee = this.resolveSimpleCall(callName, caller);
            if (callee && callee.id !== caller.id) {
                this.addEdge(edges, caller.id, callee.id);
            }
        }

        // Process selector calls: obj.Method()
        const selectorCaptures = selectorCallQuery.captures(functionNode);
        for (const capture of selectorCaptures) {
            if (capture.name !== 'FUNC') continue;

            const methodName = capture.node.text;
            const callee = this.resolveSelectorCall(methodName, caller);
            if (callee && callee.id !== caller.id) {
                this.addEdge(edges, caller.id, callee.id);
            }
        }
    }

    private addEdge(edges: GraphEdge[], from: string, to: string) {
        const exists = edges.some(e => e.from === from && e.to === to);
        if (!exists) {
            edges.push({ from, to, kind: 'internal' });
        }
    }

    private resolveSimpleCall(callName: string, caller: GraphNode): GraphNode | undefined {
        // 1. Try same package (all functions without receiver)
        const packageFuncs = this.symbolsByLabel.get(callName);
        const packageFunc = packageFuncs?.find(n => !n.contract);
        if (packageFunc) return packageFunc;

        // 2. Any match
        return packageFuncs?.[0];
    }

    private resolveSelectorCall(methodName: string, caller: GraphNode): GraphNode | undefined {
        // For selector calls like s.Method() or obj.Method()
        // Try to resolve within caller's receiver type first
        if (caller.contract) {
            const receiverMethods = this.symbolsByReceiver.get(caller.contract);
            const match = receiverMethods?.find(n => n.label === methodName);
            if (match) return match;
        }

        // Fallback: any method with that name
        const methods = this.symbolsByLabel.get(methodName);
        return methods?.[0];
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
