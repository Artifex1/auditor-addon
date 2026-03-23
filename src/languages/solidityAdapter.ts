import {
    FileContent, SupportedLanguage, GraphNode, Visibility, ContainerKind,
    CallTargetKind, ModifierInfo, BuiltinContextValue
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
        `,
        EVENT_DEFINITIONS: `
            (event_definition) @event
        `,
        MODIFIER_DEFINITIONS: `
            (modifier_definition) @modifier
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
    private static readonly BUILTIN_FUNCTIONS = new Set([
        // Control flow
        'require', 'assert', 'revert', 'emit',
        // Cryptographic
        'keccak256', 'sha256', 'sha3', 'ripemd160', 'ecrecover',
        // Math / misc globals
        'addmod', 'mulmod', 'gasleft', 'blockhash', 'blobhash',
        'selfdestruct', 'suicide',
        // Type conversion / ABI globals (bare names — abi.* handled via BUILTIN_RECEIVERS)
        'bytes', 'string', 'address', 'uint', 'int',
    ]);

    private static readonly BUILTIN_RECEIVERS = new Set([
        'abi', 'block', 'msg', 'tx', 'type',
    ]);

    private static readonly BUILTIN_MEMBER_FUNCTIONS = new Set([
        'push', 'pop', 'length', 'call', 'delegatecall', 'staticcall',
        'balance', 'code', 'codehash',
        'encode', 'encodePacked', 'encodeWithSelector', 'encodeWithSignature',
        'encodeCall', 'decode',
    ]);

    protected override resetState(): void {
        super.resetState();
        this.inheritanceGraph.clear();
        this.usingForMap.clear();
    }

    protected override async identifyCalls(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Solidity);
        const parser = await service.createParser(SupportedLanguage.Solidity);
        const functionQuery = new Query(lang, SolidityAdapter.QUERIES.FUNCTIONS);

        // Build call queries once — reused across all files and functions
        const callQueries = {
            [CallType.Super]: new Query(lang, SolidityAdapter.QUERIES.SUPER_CALL),
            [CallType.Member]: new Query(lang, SolidityAdapter.QUERIES.MEMBER_CALL),
            [CallType.This]: new Query(lang, SolidityAdapter.QUERIES.THIS_CALL),
            [CallType.Simple]: new Query(lang, SolidityAdapter.QUERIES.SIMPLE_CALL),
        };
        const assemblyQuery = new Query(lang, SolidityAdapter.QUERIES.ASSEMBLY_CALL);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const captures = functionQuery.captures(tree.rootNode);
            for (const capture of captures) {
                const functionNode = capture.node;
                const callerNode = this.findNodeAtPosition(functionNode, file.path);
                if (!callerNode) continue;

                this.processCallType(functionNode, callerNode, callQueries[CallType.Super], { callType: CallType.Super });
                this.processCallType(functionNode, callerNode, callQueries[CallType.Member], { callType: CallType.Member, extractMember: true });
                this.processCallType(functionNode, callerNode, callQueries[CallType.This], { callType: CallType.This });
                this.processCallType(functionNode, callerNode, callQueries[CallType.Simple], { callType: CallType.Simple });
                this.processAssemblyCalls(functionNode, callerNode, assemblyQuery);
                if (functionNode.type === 'constructor_definition') {
                    this.processConstructorChains(functionNode, callerNode);
                }
            }
        }
    }

    private processCallType(
        functionNode: Node,
        callerNode: GraphNode,
        query: Query,
        callConfig: { callType: CallType; extractMember?: boolean }
    ) {
        const matches = query.matches(functionNode);

        for (const match of matches) {
            const functionCapture = match.captures.find(c => c.name === 'FUNC');
            if (!functionCapture) continue;

            const callNode = functionCapture.node;
            const funcName = callNode.text;
            let memberName: string | undefined;

            if (callConfig.extractMember) {
                const recvCapture = match.captures.find(c => c.name === 'RECV');
                memberName = recvCapture?.node.text;
            }

            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const resolved = this.resolveCallNode(callConfig.callType, funcName, memberName, callerNode);
            if (resolved) {
                const kind = this.determineEdgeKind(callConfig.callType, resolved);
                this.addCallEdge(callerNode.id, resolved.qualifiedName, kind, callSite);
            } else {
                const unresolvedName = memberName && callConfig.callType === CallType.Member
                    ? `${memberName}.${funcName}`
                    : funcName;
                this.addCallEdge(callerNode.id, unresolvedName, 'external_unknown', callSite);
            }
        }
    }

    private determineEdgeKind(callType: CallType, callee: GraphNode): CallTargetKind {
        if (callType === CallType.This) return 'cross_module';
        if (callType === CallType.Super) return 'internal';
        if (callType === CallType.Simple) return 'internal';

        const calleeContainer = this._graph.getContainerOf(callee.id);
        if (calleeContainer?.containerKind === 'library') {
            return callee.visibility === 'internal' ? 'internal' : 'cross_module';
        }
        return 'cross_module';
    }

    private processAssemblyCalls(functionNode: Node, callerNode: GraphNode, query: Query) {
        const captures = query.captures(functionNode);

        for (const capture of captures) {
            const callNode = capture.node;
            const callName = callNode.text;
            const resolved = this.resolveCallNode(CallType.Simple, callName, undefined, callerNode);
            if (resolved) {
                this.addCallEdge(callerNode.id, resolved.qualifiedName, 'internal',
                    { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 });
            }
        }
    }

    private processConstructorChains(constructorNode: Node, callerNode: GraphNode): void {
        const callerContainer = this.getContainerName(callerNode.id);
        if (!callerContainer) return;
        const parents = this.inheritanceGraph.get(callerContainer);
        if (!parents?.length) return;
        const parentSet = new Set(parents);

        for (const child of constructorNode.children) {
            if (child.type !== 'modifier_invocation') continue;
            const baseName = child.child(0)?.text ?? child.text.split('(')[0].trim();
            if (!parentSet.has(baseName)) continue;

            const baseConstructorQN = `${baseName}.constructor()`;
            const baseEntry = this.findInContainer(baseName, 'constructor');
            const targetQN = baseEntry?.qualifiedName ?? baseConstructorQN;
            this.addCallEdge(callerNode.id, targetQN, 'internal',
                { startIndex: child.startIndex, line: child.startPosition.row + 1 });
        }
    }

    protected override isKnownStdlib(name: string): boolean {
        // Parser artifacts: compound conditions or bitwise expressions captured as callee text
        if (/[\s|&]/.test(name)) return true;
        const dot = name.indexOf('.');
        if (dot === -1) {
            // Simple call: require(), keccak256(), etc.
            return SolidityAdapter.BUILTIN_FUNCTIONS.has(name);
        }
        // Member call: receiver.method
        const receiver = name.slice(0, dot);
        const method = name.slice(dot + 1);
        if (receiver === 'super' || receiver === 'this') return true;
        if (SolidityAdapter.BUILTIN_RECEIVERS.has(receiver)) return true;
        if (SolidityAdapter.BUILTIN_MEMBER_FUNCTIONS.has(method)) return true;
        return false;
    }

    private resolveCallNode(type: CallType, name: string, memberName: string | undefined, caller: GraphNode): GraphNode | undefined {
        switch (type) {
            case CallType.Super: return this.resolveSuperCall(name, caller);
            case CallType.Member: return this.resolveMemberCall(name, memberName!, caller);
            case CallType.This:
            case CallType.Simple: return this.resolveLocalOrInheritedCall(name, caller);
        }
    }

    private resolveSuperCall(name: string, caller: GraphNode): GraphNode | undefined {
        const callerContainer = this.getContainerName(caller.id);
        if (!callerContainer) return undefined;
        const parents = this.inheritanceGraph.get(callerContainer);
        if (!parents?.length) return undefined;
        for (const parent of parents) {
            const func = this.findInContainer(parent, name);
            if (func) return func;
        }
        return undefined;
    }

    private resolveMemberCall(name: string, memberName: string, caller: GraphNode): GraphNode | undefined {
        const func = this.findInContainer(memberName, name);
        if (func) return func;

        const callerContainer = this.getContainerName(caller.id);
        if (callerContainer) {
            const libraries = this.usingForMap.get(callerContainer);
            if (libraries) {
                for (const lib of libraries) {
                    const libFunc = this.findInContainer(lib, name);
                    if (libFunc) return libFunc;
                }
            }
        }
        return undefined;
    }

    private resolveLocalOrInheritedCall(name: string, caller: GraphNode): GraphNode | undefined {
        const callerContainer = this.getContainerName(caller.id);
        if (callerContainer) {
            const local = this.findInContainer(callerContainer, name);
            if (local) return local;
            const inherited = this.resolveInheritedCall(name, callerContainer);
            if (inherited) return inherited;
        }
        // Try free functions
        const candidates = this._graph.findByName(name);
        const free = candidates.find(n => !this.getContainerName(n.id) && n.status === 'concrete');
        if (free) return free;
        return candidates.find(n => n.status === 'concrete');
    }

    private resolveInheritedCall(name: string, contract: string, visited: Set<string> = new Set()): GraphNode | undefined {
        if (visited.has(contract)) return undefined;
        visited.add(contract);
        const parents = this.inheritanceGraph.get(contract);
        if (!parents) return undefined;
        for (const parent of parents) {
            const func = this.findInContainer(parent, name);
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
        const eventDefQuery = new Query(lang, SolidityAdapter.QUERIES.EVENT_DEFINITIONS);
        const modifierDefQuery = new Query(lang, SolidityAdapter.QUERIES.MODIFIER_DEFINITIONS);

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

                // Create container node BEFORE adding members
                this.addContainerNode({
                    name: contractName,
                    containerKind: kind,
                    visibility: 'public',
                    node: containerNode,
                    file: file.path,
                });

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
                        this.createFunctionNode(fnCapture.node, file.path, kind, contractName);
                    }

                    const stateVars = stateVarQuery.captures(bodyNode);
                    for (const svCapture of stateVars) {
                        this.createStateVarNode(svCapture.node, file.path, contractName);
                    }

                    // Event definitions → concrete event nodes
                    const eventDefs = eventDefQuery.captures(bodyNode);
                    for (const evCapture of eventDefs) {
                        const evNameNode = evCapture.node.childForFieldName('name')
                            ?? evCapture.node.children.find(c => c.type === 'identifier');
                        if (!evNameNode) continue;
                        const evNode = this.createNode({
                            qualifiedName: `${contractName}.${evNameNode.text}`,
                            label: evNameNode.text,
                            file: file.path,
                            node: evCapture.node,
                            visibility: 'public',
                            kind: 'event',
                        });
                        this.addNode(evNode, contractName);
                    }

                    // Modifier definitions → concrete modifier nodes
                    const modifierDefs = modifierDefQuery.captures(bodyNode);
                    for (const modCapture of modifierDefs) {
                        const modNameNode = modCapture.node.childForFieldName('name')
                            ?? modCapture.node.children.find(c => c.type === 'identifier');
                        if (!modNameNode) continue;
                        const modNode = this.createNode({
                            qualifiedName: `${contractName}.${modNameNode.text}`,
                            label: modNameNode.text,
                            file: file.path,
                            node: modCapture.node,
                            visibility: 'internal',
                            kind: 'modifier',
                        });
                        modNode.pattern = 'explicit';
                        this.addNode(modNode, contractName);
                    }
                }
            }

            for (const child of tree.rootNode.children) {
                if (child.type === 'function_definition' || child.type === 'fallback_receive_definition') {
                    this.createFunctionNode(child, file.path);
                }
            }
        }

        // Inherits edges — after all files processed and all containers created
        for (const [childName, parents] of this.inheritanceGraph) {
            for (const parentName of parents) {
                this.addInheritsEdge(childName, parentName);
            }
        }
    }

    private createFunctionNode(
        node: Node,
        file: string,
        containerKind?: ContainerKind,
        contract?: string
    ): GraphNode {
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

        const graphNode = this.createNode({
            qualifiedName,
            label: fnName,
            file,
            node,
            visibility: finalVisibility,
        });
        this.addNode(graphNode, contract);
        if (modifiers.length > 0) {
            this.addModifiers(graphNode.id, modifiers, contract);
        }
        return graphNode;
    }

    private createStateVarNode(
        node: Node,
        file: string,
        contract: string,
    ): GraphNode | null {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return null;
        const varName = nameNode.text;
        const qualifiedName = `${contract}.${varName}`;
        const visibility = this.extractVisibility(node) ?? 'internal';

        const isConstant = node.children.some(c => c.type === 'constant');
        const isImmutable = node.children.some(c => c.type === 'immutable');
        const hasInitializer = node.childForFieldName('value') !== null;

        const modifiers: ModifierInfo[] = [];
        if (isConstant) modifiers.push({ name: 'constant', pattern: 'declarative' });
        if (isImmutable) modifiers.push({ name: 'immutable', pattern: 'declarative' });
        if (hasInitializer) modifiers.push({ name: 'has_initializer', pattern: 'declarative' });

        const graphNode = this.createNode({
            qualifiedName,
            label: varName,
            file,
            node,
            visibility,
            kind: 'state_variable',
        });
        this.addNode(graphNode, contract);
        if (modifiers.length > 0) {
            this.addModifiers(graphNode.id, modifiers, contract);
        }
        return graphNode;
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

    override getEventName(node: Node): string | null {
        if (node.type !== 'emit_statement') return null;
        // emit_statement → call_expression or identifier child
        for (const child of node.children) {
            if (child.type === 'call_expression') {
                const func = child.childForFieldName('function');
                if (func) {
                    const inner = func.type === 'expression' ? func.child(0) : func;
                    if (inner?.type === 'identifier') return inner.text;
                }
            }
            if (child.type === 'identifier') return child.text;
        }
        return null;
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
