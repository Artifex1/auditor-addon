import { FileContent, SupportedLanguage, GraphNode, GraphEdge, Visibility } from "../engine/types.js";
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

    private symbolsByClass: Map<string, GraphNode[]> = new Map();
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
        this.symbolsByClass.clear();
        this.declaredVisibility.clear();
    }

    protected override indexSymbol(node: GraphNode): void {
        super.indexSymbol(node);
        if (node.contract) {
            const classNodes = this.symbolsByClass.get(node.contract) ?? [];
            classNodes.push(node);
            this.symbolsByClass.set(node.contract, classNodes);
        }
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
                        const node = this.createMethodNode(child, file.path, className, currentVisibility);
                        if (node) this.indexSymbol(node);
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
                        const existing = this.symbolsByClass.get(className)?.find(n => n.label === methodName);
                        if (!existing) {
                            // Not already indexed from an inline definition — index it now
                            const visibility = this.declaredVisibility.get(key) ?? 'public';
                            this.indexSymbol({
                                id: key,
                                label: methodName,
                                file: file.path,
                                contract: className,
                                visibility,
                                range: {
                                    start: { line: funcNode.startPosition.row + 1, column: funcNode.startPosition.column },
                                    end: { line: funcNode.endPosition.row + 1, column: funcNode.endPosition.column }
                                },
                                text: funcNode.text
                            });
                        }
                    }
                } else {
                    const node = this.createFreeFunctionNode(funcNode, file.path);
                    if (node) this.indexSymbol(node);
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
        const id = `${className}::${fnName}`;

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

    private createFreeFunctionNode(node: Node, file: string): GraphNode | undefined {
        const declarator = node.childForFieldName('declarator');
        if (!declarator) return undefined;

        const nameNode = declarator.children.find(c => c.type === 'identifier');
        if (!nameNode) return undefined;

        const fnName = nameNode.text;

        return {
            id: fnName,
            label: fnName,
            file,
            visibility: 'public',
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column }
            },
            text: node.text
        };
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

    protected override async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
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

                this.processCallsInNode(funcNode, symbol, edges, simpleCallQuery, fieldCallQuery, scopedCallQuery);
            }
        }
    }

    private processCallsInNode(
        node: Node,
        caller: GraphNode,
        edges: GraphEdge[],
        simpleCallQuery: Query,
        fieldCallQuery: Query,
        scopedCallQuery: Query
    ) {
        // Simple calls: func()
        for (const capture of simpleCallQuery.captures(node)) {
            if (capture.name !== 'FUNC') continue;
            const calleeName = capture.node.text;
            const callee = this.resolveCall(calleeName, caller);
            if (callee && callee.id !== caller.id) {
                this.addEdge(edges, caller.id, callee.id);
            }
        }

        // Field/method calls: obj.method()
        for (const capture of fieldCallQuery.captures(node)) {
            if (capture.name !== 'FUNC') continue;
            const methodName = capture.node.text;
            // Try same class first, then any match
            const callee = this.resolveMemberCall(methodName, caller);
            if (callee && callee.id !== caller.id) {
                this.addEdge(edges, caller.id, callee.id);
            }
        }

        // Scoped calls: Class::method() or Namespace::func()
        for (const capture of scopedCallQuery.captures(node)) {
            if (capture.name !== 'FUNC') continue;
            const funcName = capture.node.text;
            const callee = this.resolveCall(funcName, caller);
            if (callee && callee.id !== caller.id) {
                this.addEdge(edges, caller.id, callee.id);
            }
        }
    }

    private resolveCall(name: string, caller: GraphNode): GraphNode | undefined {
        // 1. Same class
        if (caller.contract) {
            const classNodes = this.symbolsByClass.get(caller.contract);
            const match = classNodes?.find(n => n.label === name);
            if (match) return match;
        }
        // 2. Free function or any match
        const candidates = this.symbolsByLabel.get(name);
        return candidates?.find(n => !n.contract) ?? candidates?.[0];
    }

    private resolveMemberCall(name: string, caller: GraphNode): GraphNode | undefined {
        // 1. Same class (this->method() pattern)
        if (caller.contract) {
            const classNodes = this.symbolsByClass.get(caller.contract);
            const match = classNodes?.find(n => n.label === name);
            if (match) return match;
        }
        // 2. Any class with that method name
        return this.symbolsByLabel.get(name)?.[0];
    }
}
