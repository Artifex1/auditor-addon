import {
    FileContent, SupportedLanguage, GraphNode, NodeId, Visibility,
    ModifierInfo
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


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
        'min', 'max', 'clear',
        // Type conversions / primitives
        'string', 'int', 'int8', 'int16', 'int32', 'int64',
        'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
        'float32', 'float64', 'complex64', 'complex128',
        'byte', 'rune', 'bool', 'error',
    ]);

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
                baseRateNlocPerDay: 250,
                complexityMidpoint: 12,
                complexitySteepness: 9,
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.9,
                commentFullBenefitDensity: 15,
                commentBenefitCap: 0.25
            }
        });
    }

    protected override async buildSymbolTable(files: FileContent[]) {
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
                this.addNode(this.createFunctionNode(capture.node, file.path));
            }

            // 2. Find all methods
            const methodCaptures = methodQuery.captures(tree.rootNode);
            for (const capture of methodCaptures) {
                const receiverType = this.extractReceiverType(capture.node);
                if (receiverType && !this._containerNodesByName.has(receiverType)) {
                    this.addContainerNode({
                        name: receiverType,
                        containerKind: 'struct',
                        visibility: 'public',
                        node: capture.node,
                        file: file.path,
                    });
                }
                this.addNode(this.createMethodNode(capture.node, file.path), receiverType);
            }
        }
    }

    private createFunctionNode(node: Node, file: string): GraphNode {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';
        const visibility = this.extractVisibility(fnName);

        return this.createNode({
            qualifiedName: fnName,
            label: fnName,
            file,
            node,
            visibility,
        });
    }

    private createMethodNode(node: Node, file: string): GraphNode {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';
        const receiverType = this.extractReceiverType(node);
        const visibility = this.extractVisibility(fnName);
        const qualifiedName = receiverType ? `${receiverType}.${fnName}` : fnName;

        return this.createNode({
            qualifiedName,
            label: fnName,
            file,
            node,
            visibility,
        });
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

    protected override async identifyCalls(files: FileContent[]) {
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
                const callerNode = this.findNodeAtPosition(functionNode, file.path);
                if (!callerNode) continue;

                this.processCallsInFunction(functionNode, callerNode, simpleCallQuery, selectorCallQuery);
            }

            // Process method declarations
            const methodCaptures = methodQuery.captures(tree.rootNode);
            for (const capture of methodCaptures) {
                const methodNode = capture.node;
                const callerNode = this.findNodeAtPosition(methodNode, file.path);
                if (!callerNode) continue;

                this.processCallsInFunction(methodNode, callerNode, simpleCallQuery, selectorCallQuery);
            }
        }
    }

    private processCallsInFunction(
        functionNode: Node,
        caller: GraphNode,
        simpleCallQuery: Query,
        selectorCallQuery: Query
    ) {
        // Process simple calls: foo()
        const simpleCaptures = simpleCallQuery.captures(functionNode);
        for (const capture of simpleCaptures) {
            if (capture.name !== 'FUNC') continue;

            const callNode = capture.node;
            const callName = callNode.text;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const resolved = this.resolveSimpleCall(callName);
            if (resolved && resolved.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, resolved.qualifiedName, 'internal', callSite);
            } else if (!resolved) {
                this.addCallEdge(caller.id, callName, 'external_unknown', callSite);
            }
        }

        // Process selector calls: obj.Method()
        const selectorCaptures = selectorCallQuery.captures(functionNode);
        for (const capture of selectorCaptures) {
            if (capture.name !== 'FUNC') continue;

            const callNode = capture.node;
            const methodName = callNode.text;
            const receiver = callNode.parent?.childForFieldName('operand')?.text;
            const fullName = receiver ? `${receiver}.${methodName}` : methodName;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const resolved = this.resolveSelectorCall(methodName, caller);
            if (resolved && resolved.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, resolved.qualifiedName, 'internal', callSite);
            } else if (!resolved) {
                this.addCallEdge(caller.id, fullName, 'external_unknown', callSite);
            }
        }
    }

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'function_declaration' || node.type === 'method_declaration';
    }

    override getFunctionName(node: Node): string | null {
        if (this.isFunctionDef(node)) {
            return node.childForFieldName('name')?.text ?? null;
        }
        return null;
    }

    override isPublicFn(node: Node): boolean {
        const name = this.getFunctionName(node);
        if (!name) return false;
        return this.extractVisibility(name) === 'public';
    }

    override isExternalCall(node: Node): boolean {
        // Go: calls via selector on an imported package (pkg.Func())
        // Without import resolution, approximate by checking if call target
        // has a selector with uppercase receiver (convention for package-level calls)
        if (node.type !== 'call_expression') return false;
        const funcExpr = node.childForFieldName('function');
        if (funcExpr?.type === 'selector_expression') {
            const obj = funcExpr.childForFieldName('operand');
            // Package names are lowercase identifiers
            if (obj?.type === 'identifier') {
                const name = obj.text;
                // Heuristic: if the receiver is lowercase and not 'self'/'this',
                // it's likely a package call
                return name.length > 0 && name[0] === name[0].toLowerCase()
                    && name !== 'self' && name !== 'this';
            }
        }
        return false;
    }

    override isStateWrite(node: Node): boolean {
        return node.type === 'assignment_statement'
            || node.type === 'short_var_declaration';
    }

    override isStateRead(node: Node): boolean {
        if (node.type === 'selector_expression') return true;
        if (node.type === 'identifier') {
            const parent = node.parent;
            if (parent?.type === 'assignment_statement'
                && parent.childForFieldName('left')?.id === node.id) {
                return false;
            }
            return true;
        }
        return false;
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_statement';
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'call_expression') return null;
        const funcExpr = node.childForFieldName('function');
        if (!funcExpr) return null;
        if (funcExpr.type === 'identifier') return funcExpr.text;
        if (funcExpr.type === 'selector_expression') {
            return funcExpr.childForFieldName('field')?.text ?? null;
        }
        return null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment_statement'
            && node.type !== 'short_var_declaration') return null;
        return node.childForFieldName('left')?.text
            ?? node.children[0]?.text ?? null;
    }

    private resolveSimpleCall(callName: string): GraphNode | undefined {
        // 1. Try same package (all functions without receiver)
        const allByName = this._graph.findByName(callName);
        const packageFunc = allByName.find(n => !this.getContainerName(n.id) && n.status === 'concrete');
        if (packageFunc) return packageFunc;

        // 2. Any match
        return allByName.find(n => n.status === 'concrete');
    }

    private static readonly STDLIB_PREFIXES = new Set([
        'fmt', 'log', 'os', 'io', 'errors', 'strings', 'strconv', 'sync', 'context',
        'time', 'net', 'math', 'sort', 'encoding', 'bytes', 'bufio', 'http', 'json',
        'regexp', 'filepath', 'path', 'unicode', 'utf8', 'atomic', 'rand', 'flag',
        'reflect', 'runtime', 'unsafe', 'testing', 'hex', 'base64', 'ioutil', 'exec',
        'signal', 'url', 'crypto', 'tls', 'x509', 'sha256', 'sha512', 'md5', 'hmac',
        // net/http subpackages
        'httptest', 'httputil', 'cookiejar', 'httptrace',
        // text/html/template
        'template', 'html', 'tabwriter', 'csv', 'xml',
        // common third-party used like stdlib
        'render', 'chi', 'mux',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        const dot = name.indexOf('.');
        if (dot !== -1) {
            const pkg = name.slice(0, dot);
            if (GoAdapter.STDLIB_PREFIXES.has(pkg)) return true;
            // Single or 2-char lowercase identifiers are Go receiver variables (t, r, w, wg, etc.),
            // not package names. Go package names are conventional full words.
            if (pkg.length <= 2 && /^[a-z]+$/.test(pkg)) return true;
        }
        return GoAdapter.BUILTIN_FUNCTIONS.has(name);
    }

    private resolveSelectorCall(methodName: string, caller: GraphNode): GraphNode | undefined {
        // For selector calls like s.Method() or obj.Method()
        // Try to resolve within caller's receiver type first
        const callerContainer = this.getContainerName(caller.id);
        if (callerContainer) {
            const match = this.findInContainer(callerContainer, methodName);
            if (match) return match;
        }

        // Fallback: any method with that name
        return this._graph.findByName(methodName).find(n => n.status === 'concrete');
    }

}
