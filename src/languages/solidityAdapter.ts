import {
    FileContent, SupportedLanguage, SymbolEntry, Visibility, ContainerKind,
    SymbolMap, CallTargetKind, ModifierInfo, BuiltinContextValue
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";

enum CallType {
    Simple,
    Member,
    This,
    Super
}

export class SolidityAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        CONTAINERS: `
            [(contract_declaration) (interface_declaration) (library_declaration)] @container
        `,
        INHERITANCE: `
            (inheritance_specifier ancestor: (user_defined_type (identifier) @parent))
        `,
        USING_FOR: `
            (using_directive (type_alias (identifier) @lib))
        `,
        FUNCTIONS: `
            [(function_definition) (fallback_receive_definition) (constructor_definition)] @function
        `,
        SUPER_CALL: `
            (call_expression function: (expression (member_expression object: (identifier) @RECV (#eq? @RECV "super") property: (identifier) @FUNC)))
        `,
        THIS_CALL: `
            (call_expression function: (expression (member_expression object: (identifier) @RECV (#eq? @RECV "this") property: (identifier) @FUNC)))
        `,
        MEMBER_CALL: `
            (call_expression function: (expression (member_expression object: (_) @RECV property: (identifier) @FUNC)))
        `,
        SIMPLE_CALL: `
            (call_expression function: (expression (identifier) @FUNC))
        `,
        ASSEMBLY_CALL: `
            (yul_function_call function: (yul_identifier) @FUNC)
        `,
        STATE_VARIABLES: `
            (state_variable_declaration) @statevar
        `
    } as const;

    constructor() {
        super({
            languageId: SupportedLanguage.Solidity,
            queries: {
                comments: '(comment) @comment',
                functions: `
                    (function_definition) @function
                    (fallback_receive_definition) @function
                `,
                branching: `
                    (if_statement) @branch
                    (for_statement) @branch
                    (while_statement) @branch
                    (do_while_statement) @branch
                    (catch_clause) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_definition) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 150,
                complexityMidpoint: 11,
                complexitySteepness: 8,
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 1.5,
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.35
            }
        });
    }

    private inheritanceGraph: Map<string, string[]> = new Map();
    private usingForMap: Map<string, string[]> = new Map();
    private static readonly BUILTIN_FUNCTIONS = new Set(['require', 'assert', 'revert', 'emit']);

    protected override resetState(): void {
        super.resetState();
        this.inheritanceGraph.clear();
        this.usingForMap.clear();
    }

    private findInContract(contract: string, label: string): SymbolEntry | undefined {
        return this.symbolsByContainer.get(contract)?.find(e => e.label === label);
    }

    protected override async identifyCalls(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);
        const parser = await service.createParser(SupportedLanguage.Solidity);
        const functionQuery = new Query(lang, SolidityAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const captures = functionQuery.captures(tree.rootNode);
            for (const capture of captures) {
                const functionNode = capture.node;
                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                await this.processCallType(functionNode, symbol, { callType: CallType.Super });
                await this.processCallType(functionNode, symbol, { callType: CallType.Member, extractMember: true });
                await this.processCallType(functionNode, symbol, { callType: CallType.This });
                await this.processCallType(functionNode, symbol, { callType: CallType.Simple });
                await this.processAssemblyCalls(functionNode, symbol);
            }
        }
    }

    private async processCallType(
        functionNode: Node,
        symbol: SymbolEntry,
        callConfig: { callType: CallType; extractMember?: boolean }
    ) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);
        const querySource = this.getQueryForCallType(callConfig.callType);
        const query = new Query(lang, querySource);
        const matches = query.matches(functionNode);

        for (const match of matches) {
            const functionCapture = match.captures.find(c => c.name === 'FUNC');
            if (!functionCapture) continue;

            const funcName = functionCapture.node.text;
            let memberName: string | undefined;

            if (callConfig.extractMember) {
                const recvCapture = match.captures.find(c => c.name === 'RECV');
                memberName = recvCapture?.node.text;
            }

            if (this.shouldSkipCall(funcName, memberName, callConfig.callType)) continue;

            const callee = this.resolveCallNode(callConfig.callType, funcName, memberName, symbol);
            if (callee) {
                const kind = this.determineEdgeKind(callConfig.callType, callee);
                this.addCallee(symbol.qualifiedName, this.makeCallee(callee.qualifiedName, kind));
            } else {
                const unresolvedName = memberName && callConfig.callType === CallType.Member
                    ? `${memberName}.${funcName}`
                    : funcName;
                this.addCallee(symbol.qualifiedName, this.makeCallee(unresolvedName, 'external_unknown'));
            }
        }
    }

    private getQueryForCallType(callType: CallType): string {
        switch (callType) {
            case CallType.Super: return SolidityAdapter.QUERIES.SUPER_CALL;
            case CallType.This: return SolidityAdapter.QUERIES.THIS_CALL;
            case CallType.Member: return SolidityAdapter.QUERIES.MEMBER_CALL;
            case CallType.Simple: return SolidityAdapter.QUERIES.SIMPLE_CALL;
        }
    }

    private determineEdgeKind(callType: CallType, callee: SymbolEntry): CallTargetKind {
        if (callType === CallType.This) return 'cross_module';
        if (callType === CallType.Super) return 'internal';
        if (callType === CallType.Simple) return 'internal';

        if (callee.containerKind === 'library') {
            return callee.visibility === 'internal' ? 'internal' : 'cross_module';
        }
        return 'cross_module';
    }

    private async processAssemblyCalls(functionNode: Node, symbol: SymbolEntry) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);
        const query = new Query(lang, SolidityAdapter.QUERIES.ASSEMBLY_CALL);
        const captures = query.captures(functionNode);

        for (const capture of captures) {
            const callName = capture.node.text;
            const callee = this.resolveCallNode(CallType.Simple, callName, undefined, symbol);
            if (callee) {
                this.addCallee(symbol.qualifiedName, this.makeCallee(callee.qualifiedName, 'internal'));
            }
        }
    }

    private shouldSkipCall(funcName: string, memberName: string | undefined, callType: CallType): boolean {
        if (SolidityAdapter.BUILTIN_FUNCTIONS.has(funcName)) return true;
        if (callType === CallType.Member && (memberName === 'super' || memberName === 'this')) return true;
        if (callType === CallType.Simple && funcName.includes('.')) return true;
        return false;
    }

    private resolveCallNode(type: CallType, name: string, memberName: string | undefined, caller: SymbolEntry): SymbolEntry | undefined {
        switch (type) {
            case CallType.Super: return this.resolveSuperCall(name, caller);
            case CallType.Member: return this.resolveMemberCall(name, memberName!, caller);
            case CallType.This:
            case CallType.Simple: return this.resolveLocalOrInheritedCall(name, caller);
        }
    }

    private resolveSuperCall(name: string, caller: SymbolEntry): SymbolEntry | undefined {
        if (!caller.contract) return undefined;
        const parents = this.inheritanceGraph.get(caller.contract);
        if (!parents?.length) return undefined;
        for (const parent of parents) {
            const func = this.findInContract(parent, name);
            if (func) return func;
        }
        return undefined;
    }

    private resolveMemberCall(name: string, memberName: string, caller: SymbolEntry): SymbolEntry | undefined {
        const func = this.findInContract(memberName, name);
        if (func) return func;

        if (caller.contract) {
            const libraries = this.usingForMap.get(caller.contract);
            if (libraries) {
                for (const lib of libraries) {
                    const libFunc = this.findInContract(lib, name);
                    if (libFunc) return libFunc;
                }
            }
        }
        return undefined;
    }

    private resolveLocalOrInheritedCall(name: string, caller: SymbolEntry): SymbolEntry | undefined {
        if (caller.contract) {
            const local = this.findInContract(caller.contract, name);
            if (local) return local;
            const inherited = this.resolveInheritedCall(name, caller.contract);
            if (inherited) return inherited;
        }
        const freeFuncs = this.symbolsByLabel.get(name);
        const free = freeFuncs?.find(e => !e.contract);
        if (free) return free;
        return this.symbolsByLabel.get(name)?.[0];
    }

    private resolveInheritedCall(name: string, contract: string, visited: Set<string> = new Set()): SymbolEntry | undefined {
        if (visited.has(contract)) return undefined;
        visited.add(contract);
        const parents = this.inheritanceGraph.get(contract);
        if (!parents) return undefined;
        for (const parent of parents) {
            const func = this.findInContract(parent, name);
            if (func) return func;
            const inherited = this.resolveInheritedCall(name, parent, visited);
            if (inherited) return inherited;
        }
        return undefined;
    }

    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);
        const parser = await service.createParser(SupportedLanguage.Solidity);
        const containerQuery = new Query(lang, SolidityAdapter.QUERIES.CONTAINERS);
        const inheritanceQuery = new Query(lang, SolidityAdapter.QUERIES.INHERITANCE);
        const usingQuery = new Query(lang, SolidityAdapter.QUERIES.USING_FOR);
        const functionQuery = new Query(lang, SolidityAdapter.QUERIES.FUNCTIONS);
        const stateVarQuery = new Query(lang, SolidityAdapter.QUERIES.STATE_VARIABLES);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const containerCaptures = containerQuery.captures(tree.rootNode);

            for (const capture of containerCaptures) {
                const containerNode = capture.node;
                const kind = containerNode.type.replace('_declaration', '') as ContainerKind;
                const nameNode = containerNode.childForFieldName('name');
                if (!nameNode) continue;
                const contractName = nameNode.text;

                const inheritanceCaptures = inheritanceQuery.captures(containerNode);
                const parentsText = inheritanceCaptures
                    .filter(c => c.name === 'parent')
                    .map(c => c.node.text);
                if (parentsText.length > 0) {
                    this.inheritanceGraph.set(contractName, parentsText);
                }

                const usingCaptures = usingQuery.captures(containerNode);
                const libs = usingCaptures
                    .filter(c => c.name === 'lib')
                    .map(c => c.node.text);
                if (libs.length > 0) {
                    this.usingForMap.set(contractName, libs);
                }

                const bodyNode = containerNode.childForFieldName('body');
                if (bodyNode) {
                    const functions = functionQuery.captures(bodyNode);
                    for (const fnCapture of functions) {
                        this.indexSymbol(this.createFunctionNode(fnCapture.node, file.path, kind, contractName));
                    }

                    const stateVars = stateVarQuery.captures(bodyNode);
                    for (const svCapture of stateVars) {
                        const entry = this.createStateVarEntry(svCapture.node, file.path, contractName, kind);
                        if (entry) this.indexSymbol(entry);
                    }
                }
            }

            for (const child of tree.rootNode.children) {
                if (child.type === 'function_definition' || child.type === 'fallback_receive_definition') {
                    this.indexSymbol(this.createFunctionNode(child, file.path));
                }
            }
        }
    }

    private createFunctionNode(
        node: Node,
        file: string,
        containerKind?: ContainerKind,
        contract?: string
    ): SymbolEntry {
        let fnName = 'unknown';
        let params = '';
        let visibility: Visibility | undefined;
        let modifiers: ModifierInfo[] = [];

        if (node.type === 'constructor_definition') {
            fnName = 'constructor';
            visibility = 'public';
        } else if (node.type === 'fallback_receive_definition') {
            fnName = node.text.trim().startsWith('receive') ? 'receive' : 'fallback';
            visibility = 'external';
        } else {
            const nameNode = node.childForFieldName('name');
            fnName = nameNode ? nameNode.text : 'unknown';

            const paramTexts: string[] = [];
            for (const child of node.children) {
                if (child.type === 'parameter') {
                    paramTexts.push(child.text);
                }
            }
            params = paramTexts.join(', ');

            visibility = this.extractVisibility(node);

            // Extract modifiers
            for (const child of node.children) {
                if (child.type === 'modifier_invocation') {
                    const name = child.child(0)?.text ?? child.text;
                    modifiers.push({ name, pattern: 'explicit' });
                }
            }
        }

        const signature = this.cleanSignature(`${fnName}(${params})`);
        const qualifiedName = contract ? `${contract}.${signature}` : signature;
        const finalVisibility: Visibility = visibility ??
            (containerKind === 'interface' ? 'external' : 'internal');

        return this.createEntry({
            qualifiedName,
            label: fnName,
            file,
            node,
            visibility: finalVisibility,
            contract,
            containerKind,
            modifiers,
        });
    }

    private createStateVarEntry(
        node: Node,
        file: string,
        contract: string,
        containerKind: ContainerKind,
    ): SymbolEntry | null {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return null;
        const varName = nameNode.text;
        const qualifiedName = `${contract}.${varName}`;
        const visibility = this.extractVisibility(node) ?? 'internal';

        const isConstant = node.children.some(c => c.type === 'constant');
        const isImmutable = node.children.some(c => c.type === 'immutable');
        const hasInitializer = node.childForFieldName('value') !== null;

        const entry: SymbolEntry = {
            qualifiedName,
            kind: 'state_variable',
            label: varName,
            file,
            line: node.startPosition.row + 1,
            language: this.languageId,
            writesState: [],
            readsState: [],
            callsExternal: false,
            callees: [],
            isPublic: visibility === 'public',
            hasAccessControl: false,
            modifiers: [],
            resolvedBy: 'static',
            confidence: 'high',
            contract,
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column },
            },
            visibility,
            containerKind,
        };

        // Stash constant/immutable/initializer as lightweight markers in modifiers
        // so rules can inspect without re-parsing
        if (isConstant) entry.modifiers.push({ name: 'constant', pattern: 'declarative' });
        if (isImmutable) entry.modifiers.push({ name: 'immutable', pattern: 'declarative' });
        if (hasInitializer) entry.modifiers.push({ name: 'has_initializer', pattern: 'declarative' });

        return entry;
    }

    private extractVisibility(node: Node): Visibility | undefined {
        for (const child of node.children) {
            if (child.type === 'visibility') {
                const text = child.text;
                if (text === 'public' || text === 'external' || text === 'internal' || text === 'private') {
                    return text;
                }
            }
        }
        const signatureText = node.text.split('{')[0];
        if (signatureText.includes(' external')) return 'external';
        if (signatureText.includes(' public')) return 'public';
        if (signatureText.includes(' internal')) return 'internal';
        if (signatureText.includes(' private')) return 'private';
        return undefined;
    }

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'function_definition' || node.type === 'fallback_receive_definition'
            || node.type === 'constructor_definition';
    }

    override getFunctionName(node: Node): string | null {
        if (node.type === 'constructor_definition') {
            return 'constructor';
        }
        if (node.type === 'fallback_receive_definition') {
            return node.text.trim().startsWith('receive') ? 'receive' : 'fallback';
        }
        if (node.type === 'function_definition') {
            return node.childForFieldName('name')?.text ?? null;
        }
        return null;
    }

    override isPublicFn(node: Node): boolean {
        const vis = this.extractVisibility(node);
        return vis === 'public' || vis === 'external';
    }

    override isExternalCall(node: Node): boolean {
        if (node.type !== 'call_expression') return false;
        const funcExpr = node.childForFieldName('function');
        if (!funcExpr) return false;
        const memberExpr = findDescendant(funcExpr, 'member_expression');
        if (!memberExpr) return false;
        const prop = lastIdentifier(memberExpr);
        return prop === 'call' || prop === 'delegatecall' || prop === 'staticcall'
            || prop === 'transfer' || prop === 'send';
    }

    override isStateWrite(node: Node): boolean {
        if (node.type === 'assignment_expression' || node.type === 'augmented_assignment_expression') {
            const lhs = node.childForFieldName('left') ?? node.children[0];
            if (!lhs) return false;
            // LHS may be wrapped in an 'expression' node
            const inner = lhs.type === 'expression' ? lhs.child(0) : lhs;
            if (!inner) return false;
            return inner.type === 'identifier' || inner.type === 'member_expression'
                || inner.type === 'subscript_expression' || inner.type === 'array_access';
        }
        return false;
    }

    override isStateRead(node: Node): boolean {
        if (node.type === 'identifier') {
            const parent = node.parent;
            if (parent?.type === 'assignment_expression' && parent.childForFieldName('left')?.id === node.id) {
                return false;
            }
            return true;
        }
        return false;
    }

    override isEmitStatement(node: Node): boolean {
        return node.type === 'emit_statement';
    }

    override isAccessModifier(node: Node): boolean {
        return node.type === 'modifier_invocation';
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_statement';
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'call_expression') return null;
        const funcExpr = node.childForFieldName('function');
        if (!funcExpr) return null;
        const inner = funcExpr.type === 'expression' ? funcExpr.child(0) : funcExpr;
        if (!inner) return null;
        if (inner.type === 'identifier') return inner.text;
        if (inner.type === 'member_expression') {
            return inner.childForFieldName('property')?.text ?? null;
        }
        return null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment_expression' && node.type !== 'augmented_assignment_expression') return null;
        const lhs = node.childForFieldName('left') ?? node.children[0];
        if (!lhs) return null;
        const inner = lhs.type === 'expression' ? lhs.child(0) : lhs;
        return inner?.text ?? null;
    }

    override getModifiers(node: Node): ModifierInfo[] {
        if (!this.isFunctionDef(node)) return [];
        const result: ModifierInfo[] = [];
        for (const child of node.children) {
            if (child.type === 'modifier_invocation') {
                const name = child.child(0)?.text ?? child.text;
                result.push({ name, pattern: 'explicit' });
            }
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
        if (this.isExternalCall(node)) {
            return { qualifiedName: target, targetKind: 'external_unknown' };
        }
        return null;
    }

    override resolveExtensionMethod(
        _receiverType: string,
        methodName: string,
        _sourceFiles: Map<string, string>
    ): string | null {
        for (const [_contract, libs] of this.usingForMap) {
            for (const lib of libs) {
                const entry = this.findInContract(lib, methodName);
                if (entry) return entry.qualifiedName;
            }
        }
        return null;
    }

    override resolveScope(
        containerName: string,
        _sourceFiles: Map<string, string>
    ): string[] {
        return this.inheritanceGraph.get(containerName) ?? [];
    }

    override isBuiltinContextValue(node: Node): BuiltinContextValue | null {
        if (node.type !== 'member_expression') return null;
        const obj = node.childForFieldName('object')?.text;
        const prop = node.childForFieldName('property')?.text;
        if (!obj || !prop) return null;

        const builtins: Record<string, Record<string, BuiltinContextValue>> = {
            msg: {
                sender: { name: 'msg.sender', category: 'caller' },
                value: { name: 'msg.value', category: 'caller' },
                data: { name: 'msg.data', category: 'caller' },
                sig: { name: 'msg.sig', category: 'caller' },
            },
            block: {
                timestamp: { name: 'block.timestamp', category: 'environment' },
                number: { name: 'block.number', category: 'environment' },
                coinbase: { name: 'block.coinbase', category: 'environment' },
                difficulty: { name: 'block.difficulty', category: 'environment' },
                gaslimit: { name: 'block.gaslimit', category: 'environment' },
                basefee: { name: 'block.basefee', category: 'environment' },
                chainid: { name: 'block.chainid', category: 'environment' },
                prevrandao: { name: 'block.prevrandao', category: 'environment' },
            },
            tx: {
                origin: { name: 'tx.origin', category: 'caller' },
                gasprice: { name: 'tx.gasprice', category: 'environment' },
            },
        };

        return builtins[obj]?.[prop] ?? null;
    }
}

/** Find the first descendant (DFS) of a given type. */
function findDescendant(node: Node, type: string): Node | null {
    if (node.type === type) return node;
    for (const child of node.children) {
        const found = findDescendant(child, type);
        if (found) return found;
    }
    return null;
}

/** Return the text of the last identifier child (used as property name in member_expression). */
function lastIdentifier(node: Node): string | null {
    let last: string | null = null;
    for (const child of node.children) {
        if (child.type === 'identifier') last = child.text;
    }
    return last;
}
