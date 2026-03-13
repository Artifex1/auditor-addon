import {
    FileContent, SupportedLanguage, SymbolEntry, Visibility,
    SymbolMap, CallTargetKind, ModifierInfo, BuiltinContextValue
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

                // Body is in declaration_list (Cairo grammar specific)
                const bodyNode = implNode.children.find(c =>
                    c.type === 'declaration_list' || c.type === 'body'
                );
                if (!bodyNode) continue;

                const funcCaptures = functionQuery.captures(bodyNode);
                for (const funcCapture of funcCaptures) {
                    if (this.isNestedFunction(funcCapture.node, bodyNode)) continue;
                    const entry = this.createFunctionNode(funcCapture.node, file.path, containerName);
                    this.indexSymbol(entry);
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
                    this.indexSymbol(this.createFunctionNode(funcNode, file.path));
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

    private createFunctionNode(node: Node, file: string, container?: string): SymbolEntry {
        const fnName = this.extractFunctionName(node);
        const visibility = this.extractVisibility(node);
        const qualifiedName = container ? `${container}::${fnName}` : fnName;

        return this.createEntry({
            qualifiedName,
            label: fnName,
            file,
            node,
            visibility,
            contract: container,
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
                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                this.processCallQuery(simpleCallQuery, functionNode, symbol, 'simple');
                this.processCallQuery(scopedCallQuery, functionNode, symbol, 'scoped');
                if (methodCallQuery) {
                    this.processCallQuery(methodCallQuery, functionNode, symbol, 'method');
                }
            }
        }
    }

    private processCallQuery(
        query: Query,
        functionNode: Node,
        caller: SymbolEntry,
        callType: 'simple' | 'scoped' | 'method'
    ) {
        const captures = query.captures(functionNode);
        for (const capture of captures) {
            if (capture.name !== 'FUNC') continue;

            const callText = capture.node.text;
            const callee = this.resolveCall(callText, callType, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallee(caller.qualifiedName, this.makeCallee(callee.qualifiedName));
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
        return this.extractVisibility(node) === 'public' || this.extractVisibility(node) === 'external';
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
        // Dispatcher calls are cross-module
        if (node.type === 'call_expression' && node.text.includes('Dispatcher')) {
            return { qualifiedName: target, targetKind: 'cross_module' };
        }
        return null;
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

    override resolveScope(
        containerName: string,
        _sourceFiles: Map<string, string>
    ): string[] {
        return this.symbolsByContainer.has(containerName) ? [containerName] : [];
    }

    private resolveCall(callText: string, callType: 'simple' | 'scoped' | 'method', caller: SymbolEntry): SymbolEntry | undefined {
        if (callType === 'scoped') {
            // "module::func" → extract func name
            const parts = callText.split('::');
            const funcName = parts[parts.length - 1];
            const containerName = parts.slice(0, -1).join('::');

            const containerFuncs = this.symbolsByContainer.get(containerName);
            const match = containerFuncs?.find(n => n.label === funcName);
            if (match) return match;

            return this.symbolsByLabel.get(funcName)?.[0];
        }

        // simple or method call
        if (caller.contract) {
            const containerFuncs = this.symbolsByContainer.get(caller.contract);
            const match = containerFuncs?.find(n => n.label === callText);
            if (match) return match;
        }

        const freeFuncs = this.symbolsByLabel.get(callText);
        const free = freeFuncs?.find(n => !n.contract);
        if (free) return free;

        return this.symbolsByLabel.get(callText)?.[0];
    }

}
