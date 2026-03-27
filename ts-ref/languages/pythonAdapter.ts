import {
    FileContent, SupportedLanguage, GraphNode, NodeId, Visibility,
    ModifierInfo
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


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

    private static readonly BUILTINS = new Set([
        'print', 'len', 'range', 'int', 'str', 'float', 'list', 'dict',
        'set', 'tuple', 'type', 'isinstance', 'issubclass', 'hasattr',
        'getattr', 'setattr', 'delattr', 'super', 'property', 'staticmethod',
        'classmethod', 'enumerate', 'zip', 'map', 'filter', 'sorted',
        'reversed', 'min', 'max', 'sum', 'abs', 'round', 'open', 'input',
        'bool', 'bytes', 'bytearray', 'memoryview', 'object', 'id',
        'hash', 'repr', 'format', 'vars', 'dir', 'callable', 'iter',
        'next', 'slice', 'frozenset', 'chr', 'ord', 'hex', 'oct', 'bin',
        'pow', 'divmod', 'any', 'all', 'breakpoint', 'compile', 'eval',
        'exec', 'globals', 'locals', 'help', 'ascii', 'assert',
    ]);

    private static readonly STDLIB_MODULE_PREFIXES = new Set([
        'os', 'sys', 're', 'json', 'math', 'datetime', 'time', 'logging', 'pathlib',
        'hashlib', 'base64', 'urllib', 'collections', 'functools', 'itertools', 'io',
        'random', 'struct', 'typing', 'abc', 'copy', 'pickle', 'socket', 'threading',
        'subprocess', 'shutil', 'tempfile', 'glob', 'fnmatch', 'signal', 'traceback',
        'warnings', 'contextlib', 'dataclasses', 'enum', 'inspect', 'operator',
        'string', 'textwrap', 'unittest', 'pytest', 'csv', 'xml', 'html', 'http',
        'uuid', 'decimal', 'fractions', 'statistics', 'zlib', 'gzip', 'bz2', 'lzma',
        'tarfile', 'zipfile', 'configparser', 'argparse', 'pprint', 'reprlib',
    ]);

    private static readonly COMMON_METHODS = new Set([
        'append', 'extend', 'pop', 'push', 'insert', 'remove', 'clear', 'copy',
        'update', 'keys', 'values', 'items', 'get', 'setdefault', 'count', 'index',
        'split', 'join', 'strip', 'lstrip', 'rstrip', 'replace', 'find', 'startswith',
        'endswith', 'upper', 'lower', 'capitalize', 'encode', 'decode', 'format',
        'read', 'write', 'close', 'seek', 'tell', 'flush', 'readline', 'readlines',
    ]);

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
                baseRateNlocPerDay: 275,
                // Moderate complexity threshold — Python's indentation-based scoping
                // makes nesting very visible, but deeply nested code is still costly.
                complexityMidpoint: 12,
                complexitySteepness: 9,
                // Simple, flat Python code can speed up review by ~25%; heavy nesting
                // and complex control flow can cost up to ~90% more.
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.9,
                // Docstrings and inline comments are idiomatic Python; most benefit
                // is realized around ~15% comment density.
                commentFullBenefitDensity: 15,
                commentBenefitCap: 0.25
            }
        });
    }

    protected override resetState(): void {
        super.resetState();
        this.inheritanceGraph.clear();
    }

    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Python);
        const parser = await service.createParser(SupportedLanguage.Python);

        const classQuery = new Query(lang, PythonAdapter.QUERIES.CLASSES);
        const inheritanceQuery = new Query(lang, PythonAdapter.QUERIES.INHERITANCE);
        const functionQuery = new Query(lang, PythonAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // 1. Find all classes, their methods, and inheritance relationships
            const classCaptures = classQuery.captures(tree.rootNode);
            for (const capture of classCaptures) {
                const classNode = capture.node;
                const className = classNode.childForFieldName('name')?.text ?? 'unknown';

                this.addContainerNode({
                    name: className,
                    containerKind: 'class',
                    visibility: 'public',
                    node: classNode,
                    file: file.path,
                });

                // Extract parent classes
                const parentCaptures = inheritanceQuery.captures(classNode);
                const parents = parentCaptures
                    .filter(c => c.name === 'parent')
                    .map(c => c.node.text);
                if (parents.length > 0) {
                    this.inheritanceGraph.set(className, parents);
                    for (const parent of parents) {
                        this.addInheritsEdge(className, parent);
                    }
                }

                // Find methods inside this class
                const bodyNode = classNode.childForFieldName('body');
                if (!bodyNode) continue;

                const methodCaptures = functionQuery.captures(bodyNode);
                for (const methodCapture of methodCaptures) {
                    // Skip nested functions (functions defined inside other functions within the class)
                    if (this.isNestedFunction(methodCapture.node, bodyNode)) continue;

                    this.addNode(this.createMethodEntry(methodCapture.node, file.path, className), className);
                }
            }

            // 2. Find top-level functions (not inside a class)
            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                if (this.isInsideClass(capture.node, classCaptures)) continue;
                if (this.isNestedInFunction(capture.node, tree.rootNode)) continue;

                this.addNode(this.createFunctionEntry(capture.node, file.path));
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

    private createFunctionEntry(node: Node, file: string): GraphNode {
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

    private createMethodEntry(node: Node, file: string, className: string): GraphNode {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';
        const visibility = this.extractVisibility(fnName);

        return this.createNode({
            qualifiedName: `${className}.${fnName}`,
            label: fnName,
            file,
            node,
            visibility,
        });
    }

    private extractVisibility(name: string): Visibility {
        if (name.length === 0) return 'private';
        // Dunder methods (__init__, __str__, etc.) are public
        if (name.startsWith('__') && name.endsWith('__')) return 'public';
        // Single underscore prefix = private by convention
        if (name.startsWith('_')) return 'private';
        return 'public';
    }

    private resolveInheritedCall(name: string, className: string, visited: Set<string> = new Set()): GraphNode | undefined {
        if (visited.has(className)) return undefined;
        visited.add(className);

        const parents = this.inheritanceGraph.get(className);
        if (!parents) return undefined;

        for (const parent of parents) {
            const func = this.findInContainer(parent, name);
            if (func) return func;

            const inherited = this.resolveInheritedCall(name, parent, visited);
            if (inherited) return inherited;
        }
        return undefined;
    }

    protected override async identifyCalls(files: FileContent[]) {
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
                const callerNode = this.findNodeAtPosition(functionNode, file.path);
                if (!callerNode) continue;

                this.processCallsInFunction(functionNode, callerNode, simpleCallQuery, attributeCallQuery, superCallQuery);
            }
        }
    }

    private processCallsInFunction(
        functionNode: Node,
        caller: GraphNode,
        simpleCallQuery: Query,
        attributeCallQuery: Query,
        superCallQuery: Query
    ) {
        // Process super calls first: super().method()
        const superCaptures = superCallQuery.captures(functionNode);
        const superMethodNames = new Set<string>();
        for (const capture of superCaptures) {
            if (capture.name !== 'FUNC') continue;

            const callNode = capture.node;
            const methodName = callNode.text;
            superMethodNames.add(methodName);
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const resolved = this.resolveSuperCall(methodName, caller);
            if (resolved && resolved.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, resolved.qualifiedName, 'internal', callSite);
            }
        }

        // Process simple calls: foo()
        const simpleCaptures = simpleCallQuery.captures(functionNode);
        for (const capture of simpleCaptures) {
            if (capture.name !== 'FUNC') continue;

            const callNode = capture.node;
            const callName = callNode.text;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const resolved = this.resolveSimpleCall(callName, caller);
            if (resolved && resolved.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, resolved.qualifiedName, 'internal', callSite);
            } else if (!resolved) {
                this.addCallEdge(caller.id, callName, 'external_unknown', callSite);
            }
        }

        // Process attribute calls: obj.method() / self.method()
        // Skip methods already resolved as super() calls
        const attrCaptures = attributeCallQuery.captures(functionNode);
        for (const capture of attrCaptures) {
            if (capture.name !== 'FUNC') continue;

            const callNode = capture.node;
            const methodName = callNode.text;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const resolved = this.resolveAttributeCall(methodName, caller);
            if (resolved && resolved.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, resolved.qualifiedName, 'internal', callSite);
            } else if (!resolved && !superMethodNames.has(methodName)) {
                const receiver = callNode.parent?.childForFieldName('object')?.text;
                const fullName = receiver && receiver !== 'self' && receiver !== 'cls'
                    ? `${receiver}.${methodName}`
                    : methodName;
                this.addCallEdge(caller.id, fullName, 'external_unknown', callSite);
            }
        }
    }

    private resolveSuperCall(name: string, caller: GraphNode): GraphNode | undefined {
        const callerContainer = this.getContainerName(caller.id);
        if (!callerContainer) return undefined;
        return this.resolveInheritedCall(name, callerContainer);
    }

    private resolveSimpleCall(callName: string, caller: GraphNode): GraphNode | undefined {
        const callerContainer = this.getContainerName(caller.id);
        // 1. Try same class methods first
        if (callerContainer) {
            const local = this.findInContainer(callerContainer, callName);
            if (local) return local;

            // 2. Try inherited methods
            const inherited = this.resolveInheritedCall(callName, callerContainer);
            if (inherited) return inherited;
        }

        // 3. Try free functions (no container)
        const allByName = this._graph.findByName(callName);
        const freeFunc = allByName.find(n => !this.getContainerName(n.id) && n.status === 'concrete');
        if (freeFunc) return freeFunc;

        // 4. Any match
        return allByName.find(n => n.status === 'concrete');
    }

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'function_definition';
    }

    override getFunctionName(node: Node): string | null {
        if (node.type === 'function_definition') {
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
        // Python: subprocess, os.system, socket, urllib, requests
        if (node.type !== 'call') return false;
        const text = node.text;
        return text.includes('subprocess') || text.includes('os.system')
            || text.includes('os.popen') || text.includes('socket.')
            || text.includes('urllib') || text.includes('requests.');
    }

    override isStateWrite(node: Node): boolean {
        return node.type === 'assignment'
            || node.type === 'augmented_assignment';
    }

    override isStateRead(node: Node): boolean {
        // self.x access
        if (node.type === 'attribute') {
            return node.text.startsWith('self.');
        }
        return false;
    }

    override isAccessModifier(node: Node): boolean {
        return node.type === 'decorator';
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_statement';
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'call') return null;
        const func = node.childForFieldName('function');
        if (!func) return null;
        if (func.type === 'identifier') return func.text;
        if (func.type === 'attribute') {
            return func.childForFieldName('attribute')?.text ?? null;
        }
        return null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment' && node.type !== 'augmented_assignment') return null;
        const lhs = node.childForFieldName('left') ?? node.children[0];
        return lhs?.text ?? null;
    }

    override getModifiers(node: Node): ModifierInfo[] {
        if (!this.isFunctionDef(node)) return [];
        const result: ModifierInfo[] = [];
        // Decorators appear as previous siblings or special child nodes
        let prev = node.previousSibling;
        while (prev && prev.type === 'decorator') {
            const nameNode = prev.children.find(c =>
                c.type === 'identifier' || c.type === 'attribute' || c.type === 'call'
            );
            const name = nameNode?.text ?? prev.text.replace('@', '');
            result.push({ name, pattern: 'wrapper' });
            prev = prev.previousSibling;
        }
        return result;
    }

    private resolveAttributeCall(methodName: string, caller: GraphNode): GraphNode | undefined {
        const callerContainer = this.getContainerName(caller.id);
        // 1. Try caller's own class first (self.method())
        if (callerContainer) {
            const local = this.findInContainer(callerContainer, methodName);
            if (local) return local;

            // 2. Try inherited methods (self.inherited_method())
            const inherited = this.resolveInheritedCall(methodName, callerContainer);
            if (inherited) return inherited;
        }

        // 3. Fallback: any class with that method name
        return this._graph.findByName(methodName).find(n => !!this.getContainerName(n.id) && n.status === 'concrete');
    }

    protected override isKnownStdlib(name: string): boolean {
        if (PythonAdapter.BUILTINS.has(name)) return true;
        if (PythonAdapter.COMMON_METHODS.has(name)) return true;
        const dot = name.indexOf('.');
        if (dot !== -1) {
            const prefix = name.slice(0, dot);
            const method = name.slice(dot + 1);
            if (PythonAdapter.STDLIB_MODULE_PREFIXES.has(prefix)) return true;
            if (PythonAdapter.COMMON_METHODS.has(method)) return true;
        }
        return false;
    }

}
