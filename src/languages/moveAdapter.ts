import {
    FileContent, SupportedLanguage, SymbolEntry, Visibility,
    SymbolMap, CallTargetKind, ModifierInfo, BuiltinContextValue
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class MoveAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        MODULES: `(module) @module`,
        FUNCTIONS: `(function_decl) @function`,
        CALLS: `(call_expr) @call`
    } as const;

    constructor() {
        super({
            languageId: SupportedLanguage.Move,
            queries: {
                comments: `
                    (line_comment) @comment
                    (block_comment) @comment
                `,
                functions: '(function_decl) @function',
                branching: `
                    (if_expr) @branch
                    (while_expr) @branch
                    (loop_expr) @branch
                    (for_loop_expr) @branch
                    (match_expr) @branch
                    (abort_expr) @branch
                `,
                normalization: `
                    (call_expr) @norm
                    (function_decl) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 200,
                complexityMidpoint: 12,
                complexitySteepness: 8,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 1.0,
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.3
            }
        });
    }

    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Move);
        const parser = await service.createParser(SupportedLanguage.Move);

        const moduleQuery = new Query(lang, MoveAdapter.QUERIES.MODULES);
        const functionQuery = new Query(lang, MoveAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const moduleCaptures = moduleQuery.captures(tree.rootNode);

            // 1. Functions inside module definitions
            for (const capture of moduleCaptures) {
                const moduleNode = capture.node;
                const moduleName = this.extractModuleName(moduleNode);

                // Functions are wrapped in (declaration) children of the module
                for (const child of moduleNode.children) {
                    if (child.type !== 'declaration') continue;
                    const funcDecl = child.children.find(c => c.type === 'function_decl');
                    if (!funcDecl) continue;
                    const visibility = this.extractVisibilityFromDecl(child);
                    this.indexSymbol(this.createFunctionNode(funcDecl, file.path, moduleName, visibility));
                }
            }

            // 2. Free functions not inside any module
            const allFuncCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of allFuncCaptures) {
                const funcNode = capture.node;
                const isInModule = moduleCaptures.some(c =>
                    funcNode.startIndex >= c.node.startIndex &&
                    funcNode.endIndex <= c.node.endIndex
                );
                if (!isInModule) {
                    const visibility = this.extractVisibilityFromDecl(funcNode.parent ?? null);
                    this.indexSymbol(this.createFunctionNode(funcNode, file.path, undefined, visibility));
                }
            }
        }
    }

    /**
     * Move module syntax: module 0xADDR::name { ... }
     * The last (identifier) child before '{' is the module name.
     */
    private extractModuleName(moduleNode: Node): string {
        const identifiers: string[] = [];
        for (const child of moduleNode.children) {
            if (child.type === 'identifier') identifiers.push(child.text);
        }
        return identifiers[identifiers.length - 1] ?? 'unknown';
    }

    /**
     * Visibility lives in (module_member_modifier) child of (declaration),
     * not inside (function_decl) itself.
     * public entry fun → 'external'
     * public(friend) fun → 'internal'
     * public fun → 'public'
     * fun → 'private'
     */
    private extractVisibilityFromDecl(declNode: Node | null): Visibility {
        if (!declNode) return 'private';
        // entry keyword takes priority
        if (/\bentry\b/.test(declNode.text)) return 'external';
        const modifier = declNode.children.find(c => c.type === 'module_member_modifier');
        if (modifier) {
            const visNode = modifier.children.find(c => c.type === 'visibility');
            if (visNode) {
                if (visNode.text.includes('friend')) return 'internal';
                return 'public';
            }
        }
        return 'private';
    }

    private createFunctionNode(
        node: Node,
        file: string,
        module?: string,
        visibility: Visibility = 'private'
    ): SymbolEntry {
        // function_decl → first (identifier) child = function name
        const nameNode = node.children.find(c => c.type === 'identifier');
        const fnName = nameNode?.text ?? 'unknown';
        const qualifiedName = module ? `${module}::${fnName}` : fnName;

        return this.createEntry({
            qualifiedName,
            label: fnName,
            file,
            node,
            visibility,
            contract: module,
        });
    }

    protected override async identifyCalls(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Move);
        const parser = await service.createParser(SupportedLanguage.Move);

        const functionQuery = new Query(lang, MoveAdapter.QUERIES.FUNCTIONS);
        const callQuery = new Query(lang, MoveAdapter.QUERIES.CALLS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const functionNode = capture.node;
                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                const callCaptures = callQuery.captures(functionNode);
                for (const callCapture of callCaptures) {
                    const callee = this.resolveCallNode(callCapture.node, symbol);
                    if (callee && callee.qualifiedName !== symbol.qualifiedName) {
                        this.addCallee(symbol.qualifiedName, this.makeCallee(callee.qualifiedName));
                    } else if (!callee) {
                        // Use extracted name (module::func), not the full call text
                        const callName = this.extractCallName(callCapture.node);
                        if (!callName) continue;
                        this.addCallee(symbol.qualifiedName, this.makeCallee(callName, 'external_unknown'));
                    }
                }
            }
        }
    }

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'function_decl';
    }

    override getFunctionName(node: Node): string | null {
        if (node.type === 'function_decl') {
            return node.children.find(c => c.type === 'identifier')?.text ?? null;
        }
        return null;
    }

    override isPublicFn(node: Node): boolean {
        const parent = node.parent;
        const vis = this.extractVisibilityFromDecl(parent ?? null);
        return vis === 'public' || vis === 'external';
    }

    override isEmitStatement(node: Node): boolean {
        // Move event::emit(...)
        if (node.type !== 'call_expr') return false;
        const nameChain = node.children.find(c => c.type === 'name_access_chain');
        if (!nameChain) return false;
        return nameChain.text.includes('emit');
    }

    override isExternalCall(node: Node): boolean {
        // Move cross-module calls: module_name::func()
        if (node.type !== 'call_expr') return false;
        const nameChain = node.children.find(c => c.type === 'name_access_chain');
        if (!nameChain) return false;
        const ids = nameChain.children.filter(c => c.type === 'identifier');
        // Qualified call with module prefix = cross-module
        return ids.length >= 2;
    }

    override isStateWrite(node: Node): boolean {
        if (node.type === 'assignment') return true;
        // Move global storage writes: move_to, borrow_global_mut
        if (node.type === 'call_expr') {
            const text = node.text;
            return text.includes('move_to') || text.includes('borrow_global_mut')
                || text.includes('move_from');
        }
        return false;
    }

    override isStateRead(node: Node): boolean {
        // Move global storage reads: borrow_global, exists
        if (node.type === 'call_expr') {
            const text = node.text;
            return text.includes('borrow_global') || text.includes('exists<');
        }
        return false;
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_expr';
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'call_expr') return null;
        const nameChain = node.children.find(c => c.type === 'name_access_chain');
        if (!nameChain) return null;
        const ids = nameChain.children.filter(c => c.type === 'identifier');
        return ids.length > 0 ? ids[ids.length - 1].text : null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment') return null;
        return node.childForFieldName('left')?.text
            ?? node.children[0]?.text ?? null;
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
        // Qualified cross-module calls
        if (this.isExternalCall(node)) {
            return { qualifiedName: target, targetKind: 'cross_module' };
        }
        return null;
    }

    override resolveScope(
        containerName: string,
        _sourceFiles: Map<string, string>
    ): string[] {
        return this.symbolsByContainer.has(containerName) ? [containerName] : [];
    }

    // Extract module::function name from a call_expr node (no arguments).
    private extractCallName(callNode: Node): string | null {
        const nameChain = callNode.children.find(c => c.type === 'name_access_chain');
        if (!nameChain) return null;
        const ids = nameChain.children.filter(c => c.type === 'identifier').map(c => c.text);
        if (ids.length === 0) return null;
        // Return last two identifiers joined with :: for qualified calls, or just the last for bare calls
        return ids.length >= 2 ? ids.slice(-2).join('::') : ids[ids.length - 1];
    }

    private resolveCallNode(callNode: Node, caller: SymbolEntry): SymbolEntry | undefined {
        // call_expr → name_access_chain → (identifier (:: identifier)*)
        const nameChain = callNode.children.find(c => c.type === 'name_access_chain');
        if (!nameChain) return undefined;

        const identifiers = nameChain.children
            .filter(c => c.type === 'identifier')
            .map(c => c.text);

        if (identifiers.length === 0) return undefined;

        const funcName = identifiers[identifiers.length - 1];
        // Second-to-last identifier is the module name for qualified calls
        const moduleName = identifiers.length >= 2 ? identifiers[identifiers.length - 2] : null;

        if (moduleName) {
            const moduleFuncs = this.symbolsByContainer.get(moduleName);
            const match = moduleFuncs?.find(n => n.label === funcName);
            if (match) return match;
        }

        // Same-module lookup
        if (caller.contract) {
            const moduleFuncs = this.symbolsByContainer.get(caller.contract);
            const match = moduleFuncs?.find(n => n.label === funcName);
            if (match) return match;
        }

        const free = this.symbolsByLabel.get(funcName)?.find(n => !n.contract);
        if (free) return free;

        return this.symbolsByLabel.get(funcName)?.[0];
    }

    private static readonly STDLIB_PREFIXES = new Set([
        // Aptos stdlib / framework modules
        'aptos_framework', 'aptos_std', 'aptos_token', 'aptos_token_objects',
        'std', 'vector', 'string', 'option', 'error', 'signer', 'hash',
        'coin', 'fungible_asset', 'primary_fungible_store', 'object', 'event',
        'table', 'table_with_length', 'account', 'timestamp', 'type_info',
        'math64', 'math128', 'math_fixed', 'math_fixed64', 'bcs', 'from_bcs',
        'copyable_any', 'comparator', 'fixed_point32', 'fixed_point64',
        'transaction_context', 'chain_id', 'system_addresses', 'util',
        'resource_account', 'multisig_account', 'code', 'block', 'stake',
        'staking_config', 'governance', 'voting', 'storage_gas',
        // Additional Aptos framework modules seen in practice
        'features', 'ed25519', 'multi_ed25519', 'bls12381', 'crypto_algebra',
        'secp256k1', 'secp256r1', 'single_key', 'multi_key', 'aptos_hash',
        'cmp', 'pool_u64', 'pool_u64_unbound', 'big_vector', 'smart_vector',
        'smart_table', 'string_utils', 'bcs_stream', 'ordered_map',
        'dispatchable_fungible_asset', 'function_info', 'aggregator',
        'aggregator_v2', 'optional_aggregator', 'permissioned_signer',
        'delegation_pool', 'staking_proxy', 'genesis', 'randomness',
        // Sui stdlib
        'sui', 'transfer', 'tx_context', 'balance', 'pay', 'bag', 'vec_map', 'vec_set',
    ]);

    private static readonly STDLIB_FUNS = new Set([
        'assert', 'abort', 'move_to', 'move_from', 'borrow_global', 'borrow_global_mut',
        'exists', 'freeze', 'destroy_empty', 'emit',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        const sep = name.indexOf('::');
        if (sep !== -1 && MoveAdapter.STDLIB_PREFIXES.has(name.slice(0, sep))) return true;
        // Bare function names — check with startsWith to handle type params like borrow_global<T>
        for (const fn of MoveAdapter.STDLIB_FUNS) {
            if (name === fn || name.startsWith(fn + '<') || name.startsWith(fn + '(')) return true;
        }
        return false;
    }

}
