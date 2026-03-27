import {
    FileContent, SupportedLanguage, GraphNode, NodeId, Visibility,
    ModifierInfo, BuiltinContextValue
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class CairoAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        IMPL_BLOCKS: `(impl_item) @impl`,
        FUNCTIONS: `
            (function_item) @function
            (external_function_item) @function
        `,
        // Cairo: call_expression has a 'function' field containing identifier or scoped_identifier
        SIMPLE_CALL: `(call_expression function: (identifier) @FUNC)`,
        SCOPED_CALL: `(call_expression (scoped_identifier) @FUNC)`,
        // Method calls: self.method() → field_expression with field_identifier
        METHOD_CALL: `(call_expression (field_expression (field_identifier) @FUNC))`
    } as const;

    constructor() {
        super({
            languageId: SupportedLanguage.Cairo,
            queries: {
                comments: '(line_comment) @comment',
                functions: `
                    (function_item) @function
                    (function_signature_item) @function
                    (external_function_item) @function
                `,
                branching: `
                    (if_expression) @branch
                    (loop_expression) @branch
                    (while_expression) @branch
                    (for_expression) @branch
                    (match_expression) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_item) @norm
                    (function_signature_item) @norm
                    (external_function_item) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 200,
                complexityMidpoint: 12,
                complexitySteepness: 8,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 1.2,
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.3
            }
        });
    }

    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Cairo);
        const parser = await service.createParser(SupportedLanguage.Cairo);

        const implQuery = new Query(lang, CairoAdapter.QUERIES.IMPL_BLOCKS);
        const functionQuery = new Query(lang, CairoAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // 1. Find all impl blocks and index their functions
            const implCaptures = implQuery.captures(tree.rootNode);
            for (const capture of implCaptures) {
                const implNode = capture.node;
                const containerName = this.extractImplName(implNode);

                this.addContainerNode({
                    name: containerName,
                    containerKind: 'impl',
                    visibility: 'public',
                    node: implNode,
                    file: file.path,
                });

                // Body is in declaration_list (Cairo grammar specific)
                const bodyNode = implNode.children.find(c =>
                    c.type === 'declaration_list' || c.type === 'body'
                );
                if (!bodyNode) continue;

                const funcCaptures = functionQuery.captures(bodyNode);
                for (const funcCapture of funcCaptures) {
                    if (this.isNestedFunction(funcCapture.node, bodyNode)) continue;
                    const node = this.createFunctionNode(funcCapture.node, file.path, containerName);
                    this.addNode(node, containerName);
                }
            }

            // 2. Find free functions (not inside impl blocks)
            const allFuncCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of allFuncCaptures) {
                const funcNode = capture.node;
                const isInImpl = implCaptures.some(c => {
                    const body = c.node.children.find(ch =>
                        ch.type === 'declaration_list' || ch.type === 'body'
                    );
                    return body &&
                        funcNode.startIndex >= body.startIndex &&
                        funcNode.endIndex <= body.endIndex;
                });

                if (!isInImpl) {
                    this.addNode(this.createFunctionNode(funcNode, file.path));
                }
            }
        }
    }

    /**
     * Extracts the impl block name from an impl_item node.
     * Cairo syntax: impl FooImpl of FooTrait { ... }
     * The first identifier is the impl name.
     */
    private extractImplName(implNode: Node): string {
        // First identifier child = impl name (e.g., "FooImpl")
        const nameNode = implNode.children.find(c => c.type === 'identifier');
        return nameNode?.text ?? 'unknown';
    }

    private isNestedFunction(funcNode: Node, containerBody: Node): boolean {
        let current = funcNode.parent;
        while (current && current.id !== containerBody.id) {
            if (current.type === 'function_item' || current.type === 'external_function_item') return true;
            current = current.parent;
        }
        return false;
    }

    /**
     * Extracts the function name from a function_item node.
     * Cairo grammar: function_item → function child → identifier
     */
    private extractFunctionName(node: Node): string {
        // Cairo: function_item has a 'function' child (signature node) containing the identifier
        const funcChild = node.children.find(c => c.type === 'function');
        if (funcChild) {
            const nameNode = funcChild.children.find(c => c.type === 'identifier');
            if (nameNode) return nameNode.text;
        }
        // Fallback: try direct identifier child or name field
        return node.childForFieldName('name')?.text ??
            node.children.find(c => c.type === 'identifier')?.text ??
            'unknown';
    }

    private createFunctionNode(node: Node, file: string, container?: string): GraphNode {
        const fnName = this.extractFunctionName(node);
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
        // Check for pub modifier in children
        for (const child of node.children) {
            if (child.type === 'visibility_modifier') return 'public';
            if (child.text === 'pub') return 'public';
        }
        // Check function signature child for pub
        const funcChild = node.children.find(c => c.type === 'function');
        if (funcChild) {
            for (const child of funcChild.children) {
                if (child.type === 'visibility_modifier') return 'public';
                if (child.text === 'pub') return 'public';
            }
        }
        if (node.type === 'external_function_item') return 'external';
        return 'private';
    }

    protected override async identifyCalls(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Cairo);
        const parser = await service.createParser(SupportedLanguage.Cairo);

        const functionQuery = new Query(lang, CairoAdapter.QUERIES.FUNCTIONS);
        const simpleCallQuery = new Query(lang, CairoAdapter.QUERIES.SIMPLE_CALL);
        const scopedCallQuery = new Query(lang, CairoAdapter.QUERIES.SCOPED_CALL);

        let methodCallQuery: Query | null = null;
        try {
            methodCallQuery = new Query(lang, CairoAdapter.QUERIES.METHOD_CALL);
        } catch {
            // Method call query not supported in this grammar version
        }

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const functionNode = capture.node;
                const callerNode = this.findNodeAtPosition(functionNode, file.path);
                if (!callerNode) continue;

                this.processCallQuery(simpleCallQuery, functionNode, callerNode, 'simple');
                this.processCallQuery(scopedCallQuery, functionNode, callerNode, 'scoped');
                if (methodCallQuery) {
                    this.processCallQuery(methodCallQuery, functionNode, callerNode, 'method');
                }
            }
        }
    }

    private processCallQuery(
        query: Query,
        functionNode: Node,
        caller: GraphNode,
        callType: 'simple' | 'scoped' | 'method'
    ) {
        const captures = query.captures(functionNode);
        for (const capture of captures) {
            if (capture.name !== 'FUNC') continue;

            const callNode = capture.node;
            const callText = callNode.text;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const callee = this.resolveCall(callText, callType, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, callee.qualifiedName, 'internal', callSite);
            } else if (!callee) {
                this.addCallEdge(caller.id, callText, 'external_unknown', callSite);
            }
        }
    }

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'function_item' || node.type === 'external_function_item';
    }

    override getFunctionName(node: Node): string | null {
        if (this.isFunctionDef(node)) {
            return this.extractFunctionName(node) ?? null;
        }
        return null;
    }

    override isPublicFn(node: Node): boolean {
        const vis = this.extractVisibility(node);
        return vis === 'public' || vis === 'external';
    }

    override isEmitStatement(node: Node): boolean {
        // Cairo emit: self.emit(EventName { ... })
        if (node.type !== 'call_expression') return false;
        const funcNode = node.childForFieldName('function');
        if (!funcNode) return false;
        if (funcNode.type === 'field_expression') {
            const field = funcNode.children.find(c => c.type === 'field_identifier');
            if (field?.text === 'emit') return true;
        }
        return false;
    }

    override getEventName(node: Node): string | null {
        // self.emit(EventName { ... }) → extract EventName
        if (!this.isEmitStatement(node)) return null;
        const args = node.childForFieldName('arguments');
        if (args) {
            // First identifier in arguments is the event struct name
            for (const child of args.children) {
                if (child.type === 'struct_expression') {
                    const name = child.children.find(c => c.type === 'identifier' || c.type === 'scoped_identifier');
                    if (name) return name.text.split('::').pop() ?? null;
                }
                if (child.type === 'identifier') return child.text;
            }
        }
        return null;
    }

    override isExternalCall(node: Node): boolean {
        // Cairo external calls: dispatcher patterns or syscalls
        if (node.type !== 'call_expression') return false;
        const text = node.text;
        return text.includes('Dispatcher') || text.includes('syscall');
    }

    override isStateWrite(node: Node): boolean {
        if (node.type === 'assignment_expression') return true;
        // Cairo storage write: self.storage_var.write(...)
        if (node.type === 'call_expression') {
            const text = node.text;
            return text.includes('.write(');
        }
        return false;
    }

    override isStateRead(node: Node): boolean {
        // Cairo storage read: self.storage_var.read()
        if (node.type === 'call_expression') {
            const text = node.text;
            return text.includes('.read(');
        }
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
        const funcNode = node.childForFieldName('function');
        if (funcNode) {
            if (funcNode.type === 'identifier') return funcNode.text;
            if (funcNode.type === 'scoped_identifier') {
                const parts = funcNode.text.split('::');
                return parts[parts.length - 1];
            }
            if (funcNode.type === 'field_expression') {
                const field = funcNode.children.find(c => c.type === 'field_identifier');
                return field?.text ?? null;
            }
        }
        // Fallback: first identifier child
        const idChild = node.children.find(c => c.type === 'identifier');
        return idChild?.text ?? null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment_expression') return null;
        return node.childForFieldName('left')?.text ?? null;
    }

    override getModifiers(node: Node): ModifierInfo[] {
        if (!this.isFunctionDef(node)) return [];
        const result: ModifierInfo[] = [];
        let prev = node.previousSibling;
        while (prev && prev.type === 'attribute_item') {
            const text = prev.text.replace(/^#\[/, '').replace(/\]$/, '');
            const name = text.split('(')[0].trim();
            // Cairo attributes are declarative metadata (#[external(v0)], #[storage], etc.)
            result.push({ name, pattern: 'declarative' });
            prev = prev.previousSibling;
        }
        return result;
    }

    override isBuiltinContextValue(node: Node): BuiltinContextValue | null {
        if (node.type !== 'call_expression') return null;
        const text = node.text;
        if (text.includes('get_caller_address')) {
            return { name: 'get_caller_address()', category: 'caller' };
        }
        if (text.includes('get_block_timestamp')) {
            return { name: 'get_block_timestamp()', category: 'environment' };
        }
        if (text.includes('get_block_number')) {
            return { name: 'get_block_number()', category: 'environment' };
        }
        if (text.includes('get_contract_address')) {
            return { name: 'get_contract_address()', category: 'contract_state' };
        }
        return null;
    }

    private resolveCall(callText: string, callType: 'simple' | 'scoped' | 'method', caller: GraphNode): GraphNode | undefined {
        if (callType === 'scoped') {
            // "module::func" → extract func name
            const parts = callText.split('::');
            const funcName = parts[parts.length - 1];
            const containerName = parts.slice(0, -1).join('::');

            const match = this.findInContainer(containerName, funcName);
            if (match) return match;

            return this._graph.findByName(funcName).find(n => n.status === 'concrete');
        }

        // simple or method call
        const callerContainer = this.getContainerName(caller.id);
        if (callerContainer) {
            const match = this.findInContainer(callerContainer, callText);
            if (match) return match;
        }

        const candidates = this._graph.findByName(callText);
        const free = candidates.find(n => !this.getContainerName(n.id) && n.status === 'concrete');
        if (free) return free;

        return candidates.find(n => n.status === 'concrete');
    }

    private static readonly STDLIB_PREFIXES = new Set([
        'starknet', 'core', 'array', 'dict', 'option', 'result', 'box', 'nullable',
        'integer', 'felt252', 'bool', 'bytes31', 'byte_array', 'pedersen', 'poseidon',
        'ec', 'ecdsa', 'keccak', 'sha256', 'secp256k1', 'secp256r1',
        'contract_address', 'class_hash', 'storage', 'syscalls',
        'traits', 'zeroable', 'clone', 'drop', 'serde', 'hash', 'default',
        'into', 'try_into', 'fmt', 'debug', 'print', 'testing',
        'alexandria', 'openzeppelin',
    ]);

    private static readonly STDLIB_NAMES = new Set([
        'assert', 'panic', 'panic_with_felt252', 'array', 'into', 'try_into',
        'unwrap', 'expect', 'is_some', 'is_none', 'is_ok', 'is_err',
        'append', 'pop_front', 'pop_front_consume', 'get', 'at', 'len', 'is_empty',
        'span', 'clone', 'drop', 'copy', 'print', 'new',
        'emit', 'read', 'write',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        if (CairoAdapter.STDLIB_NAMES.has(name)) return true;
        const sep = name.indexOf('::');
        if (sep !== -1 && CairoAdapter.STDLIB_PREFIXES.has(name.slice(0, sep))) return true;
        // method call suffix check
        const lastSep = name.lastIndexOf('::');
        if (lastSep !== -1 && CairoAdapter.STDLIB_NAMES.has(name.slice(lastSep + 2))) return true;
        return false;
    }

}
