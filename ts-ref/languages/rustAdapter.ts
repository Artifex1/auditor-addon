import {
    FileContent, SupportedLanguage, GraphNode, NodeId, Visibility,
    ModifierInfo
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


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
                baseRateNlocPerDay: 225,
                complexityMidpoint: 16,
                complexitySteepness: 10,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 1.2,
                commentFullBenefitDensity: 18,
                commentBenefitCap: 0.35
            }
        });
    }

    protected override async buildSymbolTable(files: FileContent[]) {
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

                this.addContainerNode({
                    name: containerName,
                    containerKind: 'impl',
                    visibility: 'public',
                    node: implNode,
                    file: file.path,
                });

                // Find functions inside impl block
                const bodyNode = implNode.childForFieldName('body');
                if (bodyNode) {
                    const funcCaptures = functionQuery.captures(bodyNode);
                    for (const funcCapture of funcCaptures) {
                        if (this.isNestedFunction(funcCapture.node, bodyNode)) continue;
                        const node = this.createFunctionNode(
                            funcCapture.node,
                            file.path,
                            containerName
                        );
                        this.addNode(node, containerName);
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
                        this.addNode(this.createFunctionNode(child, file.path));
                    }
                }

                // 3. Find functions inside mod blocks
                if (child.type === 'mod_item') {
                    this.processModItem(child, file.path, functionQuery);
                }
            }
        }
    }

    private processModItem(modNode: Node, filePath: string, functionQuery: Query) {
        const modName = modNode.childForFieldName('name')?.text;
        const bodyNode = modNode.childForFieldName('body');

        if (bodyNode && modName) {
            this.addContainerNode({
                name: modName,
                containerKind: 'module',
                visibility: 'public',
                node: modNode,
                file: filePath,
            });
            const funcCaptures = functionQuery.captures(bodyNode);
            for (const funcCapture of funcCaptures) {
                if (this.isNestedFunction(funcCapture.node, bodyNode)) continue;
                const node = this.createFunctionNode(
                    funcCapture.node,
                    filePath,
                    modName
                );
                this.addNode(node, modName);
            }
        }
    }

    private isNestedFunction(funcNode: Node, containerBody: Node): boolean {
        let current = funcNode.parent;
        while (current && current.id !== containerBody.id) {
            if (current.type === 'function_item') return true;
            current = current.parent;
        }
        return false;
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

    private createFunctionNode(
        node: Node,
        file: string,
        container?: string
    ): GraphNode {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';

        const visibility = this.extractVisibility(node);
        const qualifiedName = container ? `${container}::${fnName}` : fnName;

        return this.createNode({
            qualifiedName,
            label: fnName,
            file,
            node,
            visibility,
        });
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

    protected override async identifyCalls(files: FileContent[]) {
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
                const callerNode = this.findNodeAtPosition(functionNode, file.path);
                if (!callerNode) continue;

                // Process different call types
                this.processCallQuery(simpleCallQuery, functionNode, callerNode, 'simple');
                this.processCallQuery(methodCallQuery, functionNode, callerNode, 'method');
                this.processCallQuery(scopedCallQuery, functionNode, callerNode, 'scoped');
                this.processCallQuery(genericCallQuery, functionNode, callerNode, 'simple');
                this.processCallQuery(genericScopedCallQuery, functionNode, callerNode, 'scoped');
            }
        }
    }

    private processCallQuery(
        query: Query,
        functionNode: Node,
        caller: GraphNode,
        callType: 'simple' | 'method' | 'scoped'
    ) {
        const captures = query.captures(functionNode);

        for (const capture of captures) {
            if (capture.name !== 'FUNC') continue;

            const callNode = capture.node;
            const callText = callNode.text;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };

            // Skip macro invocations (they end with !)
            if (this.isMacroCall(callNode)) continue;

            const resolved = this.resolveCall(callText, callType, caller);
            if (resolved && resolved.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, resolved.qualifiedName, 'internal', callSite);
            } else if (!resolved) {
                this.addCallEdge(caller.id, callText, 'external_unknown', callSite);
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

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'function_item';
    }

    override getFunctionName(node: Node): string | null {
        if (node.type === 'function_item') {
            return node.childForFieldName('name')?.text ?? null;
        }
        return null;
    }

    override isPublicFn(node: Node): boolean {
        return this.extractVisibility(node) === 'public';
    }

    override isExternalCall(node: Node): boolean {
        // unsafe block containing a call, or FFI-style extern calls
        if (node.type === 'call_expression') {
            let current: Node | null = node;
            while (current) {
                if (current.type === 'unsafe_block') return true;
                current = current.parent;
            }
        }
        return false;
    }

    override isStateWrite(node: Node): boolean {
        return node.type === 'assignment_expression'
            || node.type === 'compound_assignment_expr';
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
        return node.type === 'attribute_item';
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_expression';
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'call_expression') return null;
        const funcExpr = node.childForFieldName('function');
        if (!funcExpr) return null;
        if (funcExpr.type === 'identifier') return funcExpr.text;
        if (funcExpr.type === 'field_expression') {
            return funcExpr.childForFieldName('field')?.text ?? null;
        }
        if (funcExpr.type === 'scoped_identifier') {
            const parts = funcExpr.text.split('::');
            return parts[parts.length - 1];
        }
        return null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment_expression'
            && node.type !== 'compound_assignment_expr') return null;
        return node.childForFieldName('left')?.text ?? null;
    }

    override getModifiers(node: Node): ModifierInfo[] {
        if (!this.isFunctionDef(node)) return [];
        const result: ModifierInfo[] = [];
        // Rust attributes on functions: #[test], #[cfg(...)], proc macros
        let prev = node.previousSibling;
        while (prev && prev.type === 'attribute_item') {
            const text = prev.text.replace(/^#\[/, '').replace(/\]$/, '');
            const name = text.split('(')[0].trim();
            result.push({ name, pattern: 'declarative' });
            prev = prev.previousSibling;
        }
        return result;
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
            const match = this.findInContainer(containerName, funcName);
            if (match) return match;

            // Fallback to any function with that name
            return this._graph.findByName(funcName).find(n => n.status === 'concrete');
        }

        const callerContainer = this.getContainerName(caller.id);

        if (callType === 'method') {
            // Method calls: self.method() or obj.method()
            // Try to resolve within the same container first
            if (callerContainer) {
                const match = this.findInContainer(callerContainer, callText);
                if (match) return match;
            }

            // Fallback to any function with that label
            return this._graph.findByName(callText).find(n => n.status === 'concrete');
        }

        // Simple calls
        // 1. Try same container
        if (callerContainer) {
            const match = this.findInContainer(callerContainer, callText);
            if (match) return match;
        }

        // 2. Try free functions
        const allByName = this._graph.findByName(callText);
        const free = allByName.find(n => !this.getContainerName(n.id) && n.status === 'concrete');
        if (free) return free;

        // 3. Any match
        return allByName.find(n => n.status === 'concrete');
    }

    private static readonly STDLIB_PREFIXES = new Set([
        'std', 'core', 'alloc', 'fmt', 'io', 'fs', 'str', 'slice', 'iter', 'ops',
        'cmp', 'mem', 'ptr', 'sync', 'thread', 'collections', 'convert', 'clone',
        'hash', 'marker', 'rc', 'cell', 'env', 'process', 'path', 'net', 'time',
        'error', 'panic', 'any', 'borrow', 'boxed', 'vec', 'string', 'char', 'array',
        'future', 'pin', 'task', 'stream', 'num',
    ]);

    private static readonly STDLIB_NAMES = new Set([
        'Some', 'None', 'Ok', 'Err', 'Box', 'Vec', 'String', 'Option', 'Result',
        'map', 'filter', 'collect', 'iter', 'into_iter', 'iter_mut', 'fold', 'reduce',
        'flat_map', 'flatten', 'zip', 'enumerate', 'take', 'skip', 'chain', 'any', 'all',
        'find', 'position', 'count', 'sum', 'product', 'min', 'max', 'cloned', 'copied',
        'rev', 'peekable', 'nth', 'last', 'unwrap', 'unwrap_or', 'unwrap_or_else',
        'expect', 'is_some', 'is_none', 'is_ok', 'is_err', 'ok', 'err', 'map_err',
        'and_then', 'or_else', 'into', 'from', 'as_ref', 'as_mut', 'clone', 'default',
        'to_string', 'to_owned', 'push', 'pop', 'len', 'is_empty', 'contains', 'get',
        'insert', 'remove', 'retain', 'extend', 'drain', 'split', 'join', 'trim',
        'println', 'eprintln', 'print', 'eprint', 'format', 'write', 'writeln',
        'assert', 'assert_eq', 'assert_ne', 'panic', 'todo', 'unimplemented', 'unreachable',
        'drop', 'swap', 'replace', 'take', 'transmute', 'size_of', 'align_of',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        if (RustAdapter.STDLIB_NAMES.has(name)) return true;
        const sep = name.indexOf('::');
        if (sep !== -1 && RustAdapter.STDLIB_PREFIXES.has(name.slice(0, sep))) return true;
        // method chains: receiver.method — check just the method part
        const dot = name.lastIndexOf('.');
        if (dot !== -1 && RustAdapter.STDLIB_NAMES.has(name.slice(dot + 1))) return true;
        return false;
    }

}
