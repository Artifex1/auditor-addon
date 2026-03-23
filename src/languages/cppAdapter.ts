import {
    FileContent, SupportedLanguage, GraphNode, NodeId, Visibility,
    ModifierInfo
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class CppAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        CLASSES: `(class_specifier) @class`,
        FUNCTIONS: `(function_definition) @function`,
        SIMPLE_CALL: `(call_expression function: (identifier) @FUNC)`,
        FIELD_CALL: `(call_expression function: (field_expression field: (field_identifier) @FUNC))`,
        // Qualified calls: Namespace::func() or Class::method()
        SCOPED_CALL: `(call_expression function: (qualified_identifier name: (identifier) @FUNC))`
    } as const;

    // Visibility declared in class body (covers forward-declaration-only classes)
    private declaredVisibility: Map<string, Visibility> = new Map();

    constructor() {
        super({
            languageId: SupportedLanguage.Cpp,
            queries: {
                comments: '(comment) @comment',
                functions: '(function_definition) @function',
                branching: `
                    (if_statement) @branch
                    (for_statement) @branch
                    (while_statement) @branch
                    (do_statement) @branch
                    (switch_statement) @branch
                    (catch_clause) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_definition) @norm
                    (initializer_list) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 225,
                // Moderate structural complexity is "normal" C++: branches, loops,
                // RAII, exceptions, templates, etc. We only start penalizing above that.
                complexityMidpoint: 15,
                // Complexity ramp is gradual. You need to be ~10–20 CC above/below
                // the midpoint before you hit most of the penalty/benefit.
                complexitySteepness: 9,
                // High complexity can slow review down by up to ~120% (2.2x time),
                // while very simple code can at best give ~30% speedup. In security
                // audits, complexity hurts more than simplicity helps.
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 1.2,
                // Slightly higher "normal" comment density to explain invariants,
                // ownership rules, perf hacks. Around 18%+ unlocks most of the
                // documentation benefit (up to ~30%).
                commentFullBenefitDensity: 18,
                commentBenefitCap: 0.3
            }
        });
    }

    protected override resetState(): void {
        super.resetState();
        this.declaredVisibility.clear();
    }

    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Cpp);
        const parser = await service.createParser(SupportedLanguage.Cpp);
        const classQuery = new Query(lang, CppAdapter.QUERIES.CLASSES);
        const functionQuery = new Query(lang, CppAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const classCaptures = classQuery.captures(tree.rootNode);

            // 1. Index class methods, respecting access specifiers
            for (const capture of classCaptures) {
                const classNode = capture.node;
                const className = classNode.children.find(c => c.type === 'type_identifier')?.text ?? 'unknown';

                this.addContainerNode({
                    name: className,
                    containerKind: 'class',
                    visibility: 'public',
                    node: classNode,
                    file: file.path,
                });

                const bodyNode = classNode.childForFieldName('body');
                if (!bodyNode) continue;

                // C++ access specifiers apply section-by-section; track the current one
                let currentVisibility: Visibility = 'private'; // default in class

                for (const child of bodyNode.children) {
                    if (child.type === 'access_specifier') {
                        currentVisibility = this.parseAccessSpecifier(child.text);
                    } else if (child.type === 'function_definition') {
                        const node = this.createMethodNode(child, file.path, className, currentVisibility);
                        if (node) this.addNode(node, className);
                    } else if (child.type === 'field_declaration') {
                        // Forward declaration — record visibility for out-of-line body lookup
                        const nameNode = child.childForFieldName('declarator')
                            ?.children.find(c => c.type === 'field_identifier');
                        if (nameNode) {
                            this.declaredVisibility.set(`${className}::${nameNode.text}`, currentVisibility);
                        }
                    }
                }
            }

            // 2. Index top-level functions (free functions and out-of-line method definitions)
            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const funcNode = capture.node;
                if (this.isInsideClass(funcNode, classCaptures)) continue;

                const declarator = funcNode.childForFieldName('declarator');
                const qualifiedId = declarator?.children.find(c => c.type === 'qualified_identifier');

                if (qualifiedId) {
                    // Out-of-line definition: int Calculator::add(...) { ... }
                    const className = qualifiedId.children.find(c => c.type === 'namespace_identifier')?.text;
                    const methodName = qualifiedId.children.find(c => c.type === 'identifier')?.text;
                    if (className && methodName) {
                        const key = `${className}::${methodName}`;
                        const existing = this.findInContainer(className, methodName);
                        if (!existing) {
                            // Not already indexed from an inline definition — index it now
                            const visibility = this.declaredVisibility.get(key) ?? 'public';
                            this.addNode(this.createNode({
                                qualifiedName: key,
                                label: methodName,
                                file: file.path,
                                node: funcNode,
                                visibility,
                            }), className);
                        }
                    }
                } else {
                    const node = this.createFreeFunctionNode(funcNode, file.path);
                    if (node) this.addNode(node);
                }
            }
        }
    }

    private parseAccessSpecifier(text: string): Visibility {
        if (text.startsWith('public')) return 'public';
        if (text.startsWith('protected')) return 'internal';
        return 'private';
    }

    private createMethodNode(
        node: Node,
        file: string,
        className: string,
        visibility: Visibility
    ): GraphNode | undefined {
        // function_definition inside class: declarator has field_identifier for name
        const declarator = node.childForFieldName('declarator');
        if (!declarator) return undefined;

        const nameNode = declarator.children.find(c =>
            c.type === 'field_identifier' || c.type === 'identifier'
        );
        if (!nameNode) return undefined;

        const fnName = nameNode.text;
        const qualifiedName = `${className}::${fnName}`;

        return this.createNode({
            qualifiedName,
            label: fnName,
            file,
            node,
            visibility,
        });
    }

    private createFreeFunctionNode(node: Node, file: string): GraphNode | undefined {
        const declarator = node.childForFieldName('declarator');
        if (!declarator) return undefined;

        const nameNode = declarator.children.find(c => c.type === 'identifier');
        if (!nameNode) return undefined;

        const fnName = nameNode.text;

        return this.createNode({
            qualifiedName: fnName,
            label: fnName,
            file,
            node,
            visibility: 'public',
        });
    }

    private isInsideClass(node: Node, classCaptures: { node: Node }[]): boolean {
        for (const capture of classCaptures) {
            const classNode = capture.node;
            if (node.startIndex >= classNode.startIndex && node.endIndex <= classNode.endIndex) {
                return true;
            }
        }
        return false;
    }

    protected override async identifyCalls(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Cpp);
        const parser = await service.createParser(SupportedLanguage.Cpp);
        const functionQuery = new Query(lang, CppAdapter.QUERIES.FUNCTIONS);
        const simpleCallQuery = new Query(lang, CppAdapter.QUERIES.SIMPLE_CALL);
        const fieldCallQuery = new Query(lang, CppAdapter.QUERIES.FIELD_CALL);
        const scopedCallQuery = new Query(lang, CppAdapter.QUERIES.SCOPED_CALL);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);

            for (const capture of funcCaptures) {
                const funcNode = capture.node;
                const callerNode = this.findNodeAtPosition(funcNode, file.path);
                if (!callerNode) continue;

                this.processCallsInNode(funcNode, callerNode, simpleCallQuery, fieldCallQuery, scopedCallQuery);
            }
        }
    }

    private processCallsInNode(
        node: Node,
        caller: GraphNode,
        simpleCallQuery: Query,
        fieldCallQuery: Query,
        scopedCallQuery: Query
    ) {
        // Simple calls: func()
        for (const capture of simpleCallQuery.captures(node)) {
            if (capture.name !== 'FUNC') continue;
            const callNode = capture.node;
            const calleeName = callNode.text;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const callee = this.resolveCall(calleeName, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, callee.qualifiedName, 'internal', callSite);
            } else if (!callee) {
                this.addCallEdge(caller.id, calleeName, 'external_unknown', callSite);
            }
        }

        // Field/method calls: obj.method()
        for (const capture of fieldCallQuery.captures(node)) {
            if (capture.name !== 'FUNC') continue;
            const callNode = capture.node;
            const methodName = callNode.text;
            const receiver = callNode.parent?.childForFieldName('object')?.text
                ?? callNode.parent?.childForFieldName('argument')?.text;
            const fullName = receiver ? `${receiver}.${methodName}` : methodName;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const callee = this.resolveMemberCall(methodName, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, callee.qualifiedName, 'internal', callSite);
            } else if (!callee) {
                this.addCallEdge(caller.id, fullName, 'external_unknown', callSite);
            }
        }

        // Scoped calls: Class::method() or Namespace::func()
        for (const capture of scopedCallQuery.captures(node)) {
            if (capture.name !== 'FUNC') continue;
            const callNode = capture.node;
            const funcName = callNode.text;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const callee = this.resolveCall(funcName, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, callee.qualifiedName, 'internal', callSite);
            } else if (!callee) {
                this.addCallEdge(caller.id, funcName, 'external_unknown', callSite);
            }
        }
    }

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'function_definition';
    }

    override getFunctionName(node: Node): string | null {
        if (node.type !== 'function_definition') return null;
        const declarator = node.childForFieldName('declarator');
        if (!declarator) return null;
        const nameNode = declarator.children.find(c =>
            c.type === 'field_identifier' || c.type === 'identifier'
        );
        return nameNode?.text ?? null;
    }

    override isPublicFn(node: Node): boolean {
        // For class methods, we'd need to check access_specifier context
        // For free functions, they're always public
        if (node.type !== 'function_definition') return false;
        // If inside a class, check the tracked visibility
        const declarator = node.childForFieldName('declarator');
        const qualifiedId = declarator?.children.find(c => c.type === 'qualified_identifier');
        if (qualifiedId) {
            const className = qualifiedId.children.find(c => c.type === 'namespace_identifier')?.text;
            const methodName = qualifiedId.children.find(c => c.type === 'identifier')?.text;
            if (className && methodName) {
                const key = `${className}::${methodName}`;
                return this.declaredVisibility.get(key) === 'public';
            }
        }
        // Free functions are public by default
        return true;
    }

    override isExternalCall(node: Node): boolean {
        // C++: system(), dlopen/dlsym, virtual dispatch through pointers
        if (node.type !== 'call_expression') return false;
        const func = node.childForFieldName('function');
        if (func?.type === 'identifier') {
            const name = func.text;
            return name === 'system' || name === 'popen' || name === 'exec'
                || name === 'execl' || name === 'execv' || name === 'dlsym';
        }
        return false;
    }

    override isStateWrite(node: Node): boolean {
        return node.type === 'assignment_expression'
            || node.type === 'compound_assignment_expr'
            || node.type === 'update_expression';
    }

    override isStateRead(node: Node): boolean {
        if (node.type === 'field_expression') return true;
        if (node.type === 'identifier') {
            const parent = node.parent;
            if (parent?.type === 'assignment_expression'
                && parent.childForFieldName('left')?.id === node.id) {
                return false;
            }
            return true;
        }
        return false;
    }

    override isAccessModifier(node: Node): boolean {
        return node.type === 'access_specifier';
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_statement';
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'call_expression') return null;
        const func = node.childForFieldName('function');
        if (!func) return null;
        if (func.type === 'identifier') return func.text;
        if (func.type === 'field_expression') {
            return func.childForFieldName('field')?.text ?? null;
        }
        if (func.type === 'qualified_identifier') {
            return func.childForFieldName('name')?.text ?? null;
        }
        return null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment_expression'
            && node.type !== 'compound_assignment_expr') return null;
        return node.childForFieldName('left')?.text ?? null;
    }

    private resolveCall(name: string, caller: GraphNode): GraphNode | undefined {
        const callerContainer = this.getContainerName(caller.id);
        // 1. Same class
        if (callerContainer) {
            const match = this.findInContainer(callerContainer, name);
            if (match) return match;
        }
        // 2. Free function or any match
        const candidates = this._graph.findByName(name);
        return candidates.find(n => !this.getContainerName(n.id) && n.status === 'concrete') ?? candidates.find(n => n.status === 'concrete');
    }

    private resolveMemberCall(name: string, caller: GraphNode): GraphNode | undefined {
        const callerContainer = this.getContainerName(caller.id);
        // 1. Same class (this->method() pattern)
        if (callerContainer) {
            const match = this.findInContainer(callerContainer, name);
            if (match) return match;
        }
        // 2. Any class with that method name
        return this._graph.findByName(name).find(n => n.status === 'concrete');
    }

    private static readonly STDLIB_PREFIXES = new Set([
        'std', 'boost', '__builtin', '__atomic', 'assert', 'printf', 'fprintf',
        'sprintf', 'snprintf', 'scanf', 'sscanf', 'malloc', 'calloc', 'realloc', 'free',
        'memcpy', 'memmove', 'memset', 'memcmp', 'strlen', 'strcpy', 'strncpy',
        'strcmp', 'strncmp', 'strcat', 'strncat', 'strchr', 'strstr',
        'fopen', 'fclose', 'fread', 'fwrite', 'fgets', 'fputs', 'feof', 'fseek', 'ftell',
        'exit', 'abort', 'atexit', 'system', 'getenv', 'rand', 'srand', 'abs',
        'new', 'delete',
    ]);

    private static readonly STDLIB_METHODS = new Set([
        'push_back', 'pop_back', 'push_front', 'pop_front', 'insert', 'erase', 'clear',
        'begin', 'end', 'rbegin', 'rend', 'cbegin', 'cend',
        'size', 'empty', 'capacity', 'reserve', 'resize', 'shrink_to_fit',
        'find', 'count', 'at', 'front', 'back', 'data',
        'get', 'set', 'reset', 'swap', 'emplace', 'emplace_back',
        'make_shared', 'make_unique', 'make_pair', 'make_tuple',
        'to_string', 'stoi', 'stol', 'stof', 'stod',
        'c_str', 'length', 'substr', 'append', 'assign',
        'open', 'close', 'read', 'write', 'getline', 'eof', 'fail', 'good',
        'lock', 'unlock', 'try_lock', 'notify_one', 'notify_all', 'wait',
        'first', 'second',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        if (CppAdapter.STDLIB_METHODS.has(name)) return true;
        const sep = name.indexOf('::');
        if (sep !== -1 && CppAdapter.STDLIB_PREFIXES.has(name.slice(0, sep))) return true;
        const dot = name.indexOf('.');
        if (dot !== -1 && CppAdapter.STDLIB_METHODS.has(name.slice(dot + 1))) return true;
        if (CppAdapter.STDLIB_PREFIXES.has(name)) return true;
        return false;
    }
}
