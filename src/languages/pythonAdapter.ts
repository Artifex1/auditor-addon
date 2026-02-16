import { FileContent, SupportedLanguage, CallGraph, GraphNode, GraphEdge } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";

type Visibility = 'public' | 'external' | 'internal' | 'private';

// TODO: Test peek
export class PythonAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        CLASSES: `
            (class_definition) @class
        `,
        INHERITANCE: `
            (class_definition superclasses: (argument_list (identifier) @parent))
        `,
        FUNCTIONS: `
            (function_definition) @function
        `,
        SIMPLE_CALL: `
            (call function: (identifier) @FUNC)
        `,
        ATTRIBUTE_CALL: `
            (call function: (attribute attribute: (identifier) @FUNC))
        `,
        SUPER_CALL: `
            (call function: (attribute object: (call function: (identifier) @super_call (#eq? @super_call "super")) attribute: (identifier) @FUNC))
        `
    } as const;

    private static readonly BUILTIN_FUNCTIONS = new Set([
        'print', 'len', 'range', 'int', 'str', 'float', 'list', 'dict',
        'set', 'tuple', 'type', 'isinstance', 'issubclass', 'hasattr',
        'getattr', 'setattr', 'super', 'property', 'staticmethod',
        'classmethod', 'enumerate', 'zip', 'map', 'filter', 'sorted',
        'reversed', 'min', 'max', 'sum', 'abs', 'round', 'open', 'input',
        'bool', 'bytes', 'bytearray', 'memoryview', 'object', 'id',
        'hash', 'repr', 'format', 'vars', 'dir', 'callable', 'iter',
        'next', 'slice', 'frozenset', 'chr', 'ord', 'hex', 'oct', 'bin',
        'pow', 'divmod', 'any', 'all', 'breakpoint', 'compile', 'eval',
        'exec', 'globals', 'locals', 'help', 'ascii'
    ]);

    private symbolTable: Map<string, GraphNode> = new Map();
    private symbolsByLabel: Map<string, GraphNode[]> = new Map();
    private symbolsByClass: Map<string, GraphNode[]> = new Map();
    private inheritanceGraph: Map<string, string[]> = new Map();

    constructor() {
        super({
            languageId: SupportedLanguage.Python,
            queries: {
                comments: '(comment) @comment',
                functions: `
                    (function_definition) @function
                `,
                branching: `
                    (if_statement) @branch
                    (for_statement) @branch
                    (while_statement) @branch
                    (conditional_expression) @branch
                    (try_statement) @branch
                    (except_clause) @branch
                `,
                normalization: `
                    (call) @norm
                    (function_definition) @norm
                    (list) @norm
                    (dictionary) @norm
                `
            },
            constants: {
                // Python is highly readable; review throughput is similar to JS/TS.
                baseRateNlocPerDay: 450,
                // Moderate complexity threshold — Python's indentation-based scoping
                // makes nesting very visible, but deeply nested code is still costly.
                complexityMidpoint: 12,
                complexitySteepness: 9,
                // Simple, flat Python code can speed up review by ~25%; heavy nesting
                // and complex control flow can cost up to ~55% more.
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.55,
                // Docstrings and inline comments are idiomatic Python; most benefit
                // is realized around ~15% comment density.
                commentFullBenefitDensity: 15,
                commentBenefitCap: 0.25
            }
        });
    }

    async generateCallGraph(files: FileContent[]): Promise<CallGraph> {
        this.resetState();
        const edges: GraphEdge[] = [];

        // Phase 1: Build symbol table (including inheritance map)
        await this.buildSymbolTable(files);

        // Phase 2: Identify calls
        await this.identifyCalls(edges, files);

        const nodes: GraphNode[] = Array.from(this.symbolTable.values());
        return { nodes, edges };
    }

    private resetState() {
        this.symbolTable.clear();
        this.symbolsByLabel.clear();
        this.symbolsByClass.clear();
        this.inheritanceGraph.clear();
    }

    private indexSymbol(node: GraphNode) {
        this.symbolTable.set(node.id, node); // Set the node in the symbol table

        const labelNodes = this.symbolsByLabel.get(node.label) || []; // Register this node under the function name 
        labelNodes.push(node);
        this.symbolsByLabel.set(node.label, labelNodes);

        if (node.contract) {  // Node.contract is set if this node is a method within a class
            const classNodes = this.symbolsByClass.get(node.contract) || []; // If it is, push this method within the nodes of this class
            classNodes.push(node);
            this.symbolsByClass.set(node.contract, classNodes);
        }
    }

    private async buildSymbolTable(files: FileContent[]) {
        // Set up TreeSitter, choose language, create parser
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Python);
        const parser = await service.createParser(SupportedLanguage.Python);

        // Set up Queries to run on TreeSitter
        const classQuery = new Query(lang, PythonAdapter.QUERIES.CLASSES);
        const inheritanceQuery = new Query(lang, PythonAdapter.QUERIES.INHERITANCE);
        const functionQuery = new Query(lang, PythonAdapter.QUERIES.FUNCTIONS);

        for (const file of files) { // For each file
            const tree = parser.parse(file.content); // Parse it into an Abstract Syntax Tree, and return if it failed
            if (!tree) continue;

            // 1. Find all classes, their methods, and inheritance relationships
            const classCaptures = classQuery.captures(tree.rootNode); // Find all the classes within the AST
            for (const capture of classCaptures) { // For each class
                const classNode = capture.node;
                const className = classNode.childForFieldName('name')?.text ?? 'unknown';

                // Extract parent classes
                const parentCaptures = inheritanceQuery.captures(classNode); // Capture all the parents of this class
                const parents = parentCaptures
                    .filter(c => c.name === 'parent')
                    .map(c => c.node.text);
                if (parents.length > 0) { // If any parents, add them to the inheritance graph
                    this.inheritanceGraph.set(className, parents);
                }

                // Find methods inside this class
                const bodyNode = classNode.childForFieldName('body'); // Get the body of the class
                if (!bodyNode) continue;

                const methodCaptures = functionQuery.captures(bodyNode); // Get all methods within the class 
                for (const methodCapture of methodCaptures) { // For each method
                    // Skip nested functions (functions defined inside other functions within the class)
                    // TODO: why skip nested functions?
                    if (this.isNestedFunction(methodCapture.node, bodyNode)) continue;

                    const node = this.createMethodNode(methodCapture.node, file.path, className); // Record it as a method, within that class and within that file
                    this.indexSymbol(node); // Register it as a symbol
                }
            }

            // 2. Find top-level functions (not inside a class)
            const funcCaptures = functionQuery.captures(tree.rootNode); // Captures functions within the whole file
            for (const capture of funcCaptures) { // For each file
                if (this.isInsideClass(capture.node, classCaptures)) continue; // Skip it if it is inside a class
                // Skip nested functions (functions inside other functions)
                if (this.isNestedInFunction(capture.node, tree.rootNode)) continue; // Skip it if it is nested

                const node = this.createFunctionNode(capture.node, file.path); // Record it as a function, within that class and within that file
                this.indexSymbol(node); // Register it as a symbol
            }
        }
    }

    private isNestedFunction(funcNode: Node, classBody: Node): boolean {
        // A function is nested if its parent function_definition is also inside the class body
        let current = funcNode.parent;
        while (current && current.id !== classBody.id) {
            if (current.type === 'function_definition' && current.id !== funcNode.id) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    private isInsideClass(funcNode: Node, classCaptures: { node: Node }[]): boolean {
        for (const classCapture of classCaptures) {
            const classNode = classCapture.node;
            if (funcNode.startIndex >= classNode.startIndex && funcNode.endIndex <= classNode.endIndex) {
                return true;
            }
        }
        return false;
    }

    private isNestedInFunction(funcNode: Node, root: Node): boolean {
        // Check if this function is inside another function (but not inside a class)
        let current = funcNode.parent;
        while (current && current.id !== root.id) {
            if (current.type === 'function_definition') {
                return true;
            }
            if (current.type === 'class_definition') {
                return false; // It's inside a class, handled separately
            }
            current = current.parent;
        }
        return false;
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

    private createMethodNode(node: Node, file: string, className: string): GraphNode {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';

        const visibility = this.extractVisibility(fnName);
        const id = `${className}.${fnName}`;

        return {
            id,
            label: fnName,
            file,
            contract: className,
            visibility,
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column }
            },
            text: node.text
        };
    }

    private extractVisibility(name: string): Visibility {
        if (name.length === 0) return 'private';
        // Dunder methods (__init__, __str__, etc.) are public
        if (name.startsWith('__') && name.endsWith('__')) return 'public';
        // Single underscore prefix = private by convention
        if (name.startsWith('_')) return 'private';
        return 'public';
    }

    private findInClass(className: string, methodName: string): GraphNode | undefined {
        const methods = this.symbolsByClass.get(className);
        return methods?.find(n => n.label === methodName);
    }

    private resolveInheritedCall(name: string, className: string, visited: Set<string> = new Set()): GraphNode | undefined {
        if (visited.has(className)) return undefined;
        visited.add(className);

        const parents = this.inheritanceGraph.get(className);
        if (!parents) return undefined;

        for (const parent of parents) {
            const func = this.findInClass(parent, name);
            if (func) return func;

            const inherited = this.resolveInheritedCall(name, parent, visited);
            if (inherited) return inherited;
        }
        return undefined;
    }

    private async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Python);
        const parser = await service.createParser(SupportedLanguage.Python);

        const functionQuery = new Query(lang, PythonAdapter.QUERIES.FUNCTIONS);
        const simpleCallQuery = new Query(lang, PythonAdapter.QUERIES.SIMPLE_CALL);
        const attributeCallQuery = new Query(lang, PythonAdapter.QUERIES.ATTRIBUTE_CALL);
        const superCallQuery = new Query(lang, PythonAdapter.QUERIES.SUPER_CALL);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // Process all function definitions
            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const functionNode = capture.node;
                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                this.processCallsInFunction(functionNode, symbol, edges, simpleCallQuery, attributeCallQuery, superCallQuery);
            }
        }
    }

    private processCallsInFunction(
        functionNode: Node,
        caller: GraphNode,
        edges: GraphEdge[],
        simpleCallQuery: Query,
        attributeCallQuery: Query,
        superCallQuery: Query
    ) {
        // Process super calls first: super().method()
        const superCaptures = superCallQuery.captures(functionNode);
        const superMethodNames = new Set<string>();
        for (const capture of superCaptures) {
            if (capture.name !== 'FUNC') continue;

            const methodName = capture.node.text;
            superMethodNames.add(methodName);
            const callee = this.resolveSuperCall(methodName, caller);
            if (callee && callee.id !== caller.id) {
                this.addEdge(edges, caller.id, callee.id);
            }
        }

        // Process simple calls: foo()
        const simpleCaptures = simpleCallQuery.captures(functionNode);
        for (const capture of simpleCaptures) {
            if (capture.name !== 'FUNC') continue;

            const callName = capture.node.text;
            if (PythonAdapter.BUILTIN_FUNCTIONS.has(callName)) continue;

            const callee = this.resolveSimpleCall(callName, caller);
            if (callee && callee.id !== caller.id) {
                this.addEdge(edges, caller.id, callee.id);
            }
        }

        // Process attribute calls: obj.method() / self.method()
        // Skip methods already resolved as super() calls
        const attrCaptures = attributeCallQuery.captures(functionNode);
        for (const capture of attrCaptures) {
            if (capture.name !== 'FUNC') continue;

            const methodName = capture.node.text;
            if (PythonAdapter.BUILTIN_FUNCTIONS.has(methodName)) continue;

            const callee = this.resolveAttributeCall(methodName, caller);
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

    private resolveSuperCall(name: string, caller: GraphNode): GraphNode | undefined {
        if (!caller.contract) return undefined;
        return this.resolveInheritedCall(name, caller.contract);
    }

    private resolveSimpleCall(callName: string, caller: GraphNode): GraphNode | undefined {
        // 1. Try same class methods first
        if (caller.contract) {
            const local = this.findInClass(caller.contract, callName);
            if (local) return local;

            // 2. Try inherited methods
            const inherited = this.resolveInheritedCall(callName, caller.contract);
            if (inherited) return inherited;
        }

        // 3. Try free functions (no container)
        const candidates = this.symbolsByLabel.get(callName);
        const freeFunc = candidates?.find(n => !n.contract);
        if (freeFunc) return freeFunc;

        // 4. Any match
        return candidates?.[0];
    }

    private resolveAttributeCall(methodName: string, caller: GraphNode): GraphNode | undefined {
        // 1. Try caller's own class first (self.method())
        if (caller.contract) {
            const local = this.findInClass(caller.contract, methodName);
            if (local) return local;

            // 2. Try inherited methods (self.inherited_method())
            const inherited = this.resolveInheritedCall(methodName, caller.contract);
            if (inherited) return inherited;
        }

        // 3. Fallback: any class with that method name
        const candidates = this.symbolsByLabel.get(methodName);
        return candidates?.find(n => !!n.contract);
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
