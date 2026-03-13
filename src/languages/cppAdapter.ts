import {
    FileContent, SupportedLanguage, SymbolEntry, Visibility,
    SymbolMap, CallTargetKind, ModifierInfo
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
                const bodyNode = classNode.childForFieldName('body');
                if (!bodyNode) continue;

                // C++ access specifiers apply section-by-section; track the current one
                let currentVisibility: Visibility = 'private'; // default in class

                for (const child of bodyNode.children) {
                    if (child.type === 'access_specifier') {
                        currentVisibility = this.parseAccessSpecifier(child.text);
                    } else if (child.type === 'function_definition') {
                        const entry = this.createMethodNode(child, file.path, className, currentVisibility);
                        if (entry) this.indexSymbol(entry);
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
                        const existing = this.symbolsByContainer.get(className)?.find(n => n.label === methodName);
                        if (!existing) {
                            // Not already indexed from an inline definition — index it now
                            const visibility = this.declaredVisibility.get(key) ?? 'public';
                            this.indexSymbol(this.createEntry({
                                qualifiedName: key,
                                label: methodName,
                                file: file.path,
                                node: funcNode,
                                visibility,
                                contract: className,
                            }));
                        }
                    }
                } else {
                    const entry = this.createFreeFunctionNode(funcNode, file.path);
                    if (entry) this.indexSymbol(entry);
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
    ): SymbolEntry | undefined {
        // function_definition inside class: declarator has field_identifier for name
        const declarator = node.childForFieldName('declarator');
        if (!declarator) return undefined;

        const nameNode = declarator.children.find(c =>
            c.type === 'field_identifier' || c.type === 'identifier'
        );
        if (!nameNode) return undefined;

        const fnName = nameNode.text;
        const qualifiedName = `${className}::${fnName}`;

        return this.createEntry({
            qualifiedName,
            label: fnName,
            file,
            node,
            visibility,
            contract: className,
        });
    }

    private createFreeFunctionNode(node: Node, file: string): SymbolEntry | undefined {
        const declarator = node.childForFieldName('declarator');
        if (!declarator) return undefined;

        const nameNode = declarator.children.find(c => c.type === 'identifier');
        if (!nameNode) return undefined;

        const fnName = nameNode.text;

        return this.createEntry({
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
                const symbol = this.findSymbolAtNode(funcNode, file.path);
                if (!symbol) continue;

                this.processCallsInNode(funcNode, symbol, simpleCallQuery, fieldCallQuery, scopedCallQuery);
            }
        }
    }

    private processCallsInNode(
        node: Node,
        caller: SymbolEntry,
        simpleCallQuery: Query,
        fieldCallQuery: Query,
        scopedCallQuery: Query
    ) {
        // Simple calls: func()
        for (const capture of simpleCallQuery.captures(node)) {
            if (capture.name !== 'FUNC') continue;
            const calleeName = capture.node.text;
            const callee = this.resolveCall(calleeName, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallee(caller.qualifiedName, this.makeCallee(callee.qualifiedName));
            }
        }

        // Field/method calls: obj.method()
        for (const capture of fieldCallQuery.captures(node)) {
            if (capture.name !== 'FUNC') continue;
            const methodName = capture.node.text;
            // Try same class first, then any match
            const callee = this.resolveMemberCall(methodName, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallee(caller.qualifiedName, this.makeCallee(callee.qualifiedName));
            }
        }

        // Scoped calls: Class::method() or Namespace::func()
        for (const capture of scopedCallQuery.captures(node)) {
            if (capture.name !== 'FUNC') continue;
            const funcName = capture.node.text;
            const callee = this.resolveCall(funcName, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallee(caller.qualifiedName, this.makeCallee(callee.qualifiedName));
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

    override resolveCallee(
        node: Node,
        symbolMap: SymbolMap,
        _sourceFiles: Map<string, string>
    ): { qualifiedName: string; targetKind: CallTargetKind } | null {
        const target = this.getCallTarget(node);
        if (!target) return null;
        for (const [qn, entry] of symbolMap) {
            if (entry.label === target) {
                return { qualifiedName: qn, targetKind: 'internal' };
            }
        }
        return null;
    }

    private resolveCall(name: string, caller: SymbolEntry): SymbolEntry | undefined {
        // 1. Same class
        if (caller.contract) {
            const classNodes = this.symbolsByContainer.get(caller.contract);
            const match = classNodes?.find(n => n.label === name);
            if (match) return match;
        }
        // 2. Free function or any match
        const candidates = this.symbolsByLabel.get(name);
        return candidates?.find(n => !n.contract) ?? candidates?.[0];
    }

    private resolveMemberCall(name: string, caller: SymbolEntry): SymbolEntry | undefined {
        // 1. Same class (this->method() pattern)
        if (caller.contract) {
            const classNodes = this.symbolsByContainer.get(caller.contract);
            const match = classNodes?.find(n => n.label === name);
            if (match) return match;
        }
        // 2. Any class with that method name
        return this.symbolsByLabel.get(name)?.[0];
    }
}
