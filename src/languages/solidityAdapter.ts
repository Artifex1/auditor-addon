import { Entrypoint, FileContent, SupportedLanguage, CallGraph, GraphNode, GraphEdge } from "../engine/index.js";
import { astGrep } from "../util/astGrepCli.js";
import { BaseAdapter } from "./baseAdapter.js";



enum CallType {
    Simple,
    Member,
    This,
    Super
}

export class SolidityAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Solidity,
            rules: {
                comments: [
                    { id: "comment", language: SupportedLanguage.Solidity, rule: { kind: "comment" } }
                ],
                functions: {
                    id: "function",
                    language: SupportedLanguage.Solidity,
                    rule: {
                        any: [
                            { kind: "function_definition" },
                            { kind: "fallback_receive_definition" }
                        ]
                    }
                },
                branching: {
                    id: "branching",
                    language: SupportedLanguage.Solidity,
                    rule: {
                        any: [
                            { kind: "if_statement" },
                            { kind: "for_statement" },
                            { kind: "while_statement" },
                            { kind: "do_while_statement" },
                            { kind: "catch_clause" }
                        ]
                    }
                },
                normalization: [
                    { id: "call_expression", language: SupportedLanguage.Solidity, rule: { kind: "call_expression" } },
                    { id: "function_definition", language: SupportedLanguage.Solidity, rule: { kind: "function_definition" } }
                ]
            },
            constants: {
                baseRateNlocPerDay: 250,
                // Smart contracts should be structurally simple. Even moderate CC
                // density is already risky, so the neutral point is low.
                complexityMidpoint: 11,
                // Complexity penalties ramp quickly: a small increase above midpoint
                // (loops, nested branches, tricky control flow) should strongly
                // impact audit time.
                complexitySteepness: 8,
                // Complex Solidity (value transfers, reentrancy, upgradeability,
                // gas edge cases) can easily cost up to ~75% more review time.
                // Simplicity helps, but we cap its benefit at ~25%.
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.75,
                // NatSpec-style docs and invariants/role explanations are highly
                // valuable. Rich documentation can improve throughput by up to ~35%,
                // especially for protocol-level contracts.
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.35
            }
        });
    }

    private symbolTable: Map<string, GraphNode> = new Map();
    private inheritanceGraph: Map<string, string[]> = new Map(); // child -> parents
    private usingForMap: Map<string, string[]> = new Map(); // contract -> libraries

    // Optimization: Index symbols for faster lookups
    private symbolsByContract: Map<string, GraphNode[]> = new Map();
    private symbolsByLabel: Map<string, GraphNode[]> = new Map();

    private static readonly BUILTIN_FUNCTIONS = new Set(['require', 'assert', 'revert', 'emit']);

    async extractEntrypoints(files: FileContent[]): Promise<Entrypoint[]> {
        this.resetState();
        await this.buildSymbolTable(files);

        return Array.from(this.symbolTable.values())
            .filter(node => node.visibility === 'public' || node.visibility === 'external')
            .map(node => ({
                file: node.file,
                contract: node.contract || 'Unknown',
                name: node.label,
                signature: this.cleanSignature(node.id.includes('.') ? node.id.split('.').pop()! : node.id),
                visibility: node.visibility!,
                id: node.id
            }));
    }

    async generateCallGraph(files: FileContent[]): Promise<CallGraph> {
        this.resetState();
        const edges: GraphEdge[] = [];

        // Phase 1: Symbol Table & Inheritance Generation
        await this.buildSymbolTable(files);

        // Phase 2: Call Identification
        await this.identifyCalls(edges);

        // Return nodes
        const nodes: GraphNode[] = Array.from(this.symbolTable.values());

        return { nodes, edges };
    }

    private resetState() {
        this.symbolTable.clear();
        this.inheritanceGraph.clear();
        this.usingForMap.clear();
        this.symbolsByContract.clear();
        this.symbolsByLabel.clear();
    }

    private indexSymbol(node: GraphNode) {
        this.symbolTable.set(node.id, node);

        if (node.contract) {
            const nodes = this.symbolsByContract.get(node.contract) || [];
            nodes.push(node);
            this.symbolsByContract.set(node.contract, nodes);
        }

        const nodes = this.symbolsByLabel.get(node.label) || [];
        nodes.push(node);
        this.symbolsByLabel.set(node.label, nodes);
    }

    private findInContract(contract: string, label: string): GraphNode | undefined {
        return this.symbolsByContract.get(contract)?.find(n => n.label === label);
    }

    private async identifyCalls(edges: GraphEdge[]) {
        for (const node of this.symbolTable.values()) {
            // Rule 1: Super calls - super.FUNC($$$)
            await this.processCallType(node, edges, {
                ruleId: "super_call",
                pattern: "super.$FUNC($$$)",
                callType: CallType.Super
            });

            // Rule 2: Member calls - RECV.FUNC($$$)
            await this.processCallType(node, edges, {
                ruleId: "member_call",
                pattern: "$RECV.$FUNC($$$)",
                callType: CallType.Member,
                extractMember: true
            });

            // Rule 3: This calls - this.FUNC($$$)
            await this.processCallType(node, edges, {
                ruleId: "this_call",
                pattern: "this.$FUNC($$$)",
                callType: CallType.This
            });

            // Rule 4: Simple calls - FUNC($$$)
            await this.processCallType(node, edges, {
                ruleId: "simple_call",
                pattern: "$FUNC($$$)",
                callType: CallType.Simple
            });

            // Rule 5: Assembly calls
            await this.processAssemblyCalls(node, edges);
        }
    }

    private async processCallType(
        node: GraphNode,
        edges: GraphEdge[],
        config: {
            ruleId: string;
            pattern: string;
            callType: CallType;
            extractMember?: boolean;
        }
    ) {
        // Wrap code in a contract to ensure valid parsing for all function types (including fallback/receive)
        const codeToSearch = `contract C { ${node.text} }`;

        const calls = await astGrep({
            rule: {
                id: config.ruleId,
                language: "Solidity",
                rule: {
                    kind: "call_expression",
                    pattern: {
                        context: `function f() { ${config.pattern}; }`,
                        selector: "call_expression"
                    }
                }
            },
            code: codeToSearch
        });

        for (const call of calls) {
            const funcName = call.metaVariables?.single?.FUNC?.text;
            if (!funcName) continue;

            const memberName = config.extractMember
                ? call.metaVariables?.single?.RECV?.text
                : undefined;

            if (this.shouldSkipCall(funcName, memberName, config.callType)) continue;

            const calleeNode = this.resolveCallNode(config.callType, funcName, memberName, node);
            if (calleeNode) {
                const kind = this.determineEdgeKind(config.callType, calleeNode);
                edges.push({ from: node.id, to: calleeNode.id, kind });
            }
        }
    }

    private determineEdgeKind(callType: CallType, callee: GraphNode): 'internal' | 'external' {
        if (callType === CallType.This) return 'external';
        if (callType === CallType.Super) return 'internal';
        if (callType === CallType.Simple) {
            // Simple calls are internal unless they are cross-contract (which shouldn't happen in simple call syntax mostly, 
            // but if we resolved it to a free function or something else might differ. 
            // In Solidity, f() is internal jump.
            return 'internal';
        }

        // Member calls: RECV.FUNC()
        if (callee.containerKind === 'library') {
            // Library: internal if function is internal (inlined), external if public/external (delegatecall)
            return callee.visibility === 'internal' ? 'internal' : 'external';
        }

        // Interface or Contract member call -> External
        return 'external';
    }

    private async processAssemblyCalls(node: GraphNode, edges: GraphEdge[]) {
        // Wrap code in a contract to ensure valid parsing
        const codeToSearch = `contract C { ${node.text} }`;

        const assemblyCalls = await astGrep({
            rule: {
                id: "assembly_call",
                language: "Solidity",
                rule: { kind: "yul_function_call" }
            },
            code: codeToSearch
        });

        for (const call of assemblyCalls) {
            const text = call.text;
            const parenIndex = text.indexOf('(');
            if (parenIndex === -1) continue;

            const callName = text.substring(0, parenIndex).trim();
            const calleeNode = this.resolveCallNode(CallType.Simple, callName, undefined, node);
            if (calleeNode) {
                // Assembly calls are usually local jumps or precompiles, treat as internal for now
                edges.push({ from: node.id, to: calleeNode.id, kind: 'internal' });
            }
        }
    }

    private shouldSkipCall(funcName: string, memberName: string | undefined, callType: CallType): boolean {
        if (SolidityAdapter.BUILTIN_FUNCTIONS.has(funcName)) return true;
        if (callType === CallType.Member && memberName === 'super') return true;
        if (callType === CallType.Simple && funcName.includes('.')) return true;
        return false;
    }

    private resolveCallNode(type: CallType, name: string, memberName: string | undefined, caller: GraphNode): GraphNode | undefined {
        switch (type) {
            case CallType.Super:
                return this.resolveSuperCall(name, caller);
            case CallType.Member:
                return this.resolveMemberCall(name, memberName!, caller);
            case CallType.This:
            case CallType.Simple:
                return this.resolveLocalOrInheritedCall(name, caller);
        }
        return undefined;
    }

    private resolveSuperCall(name: string, caller: GraphNode): GraphNode | undefined {
        if (!caller.contract) return undefined;
        const parents = this.inheritanceGraph.get(caller.contract);
        if (!parents?.length) return undefined;

        for (const parent of parents) {
            const func = this.findInContract(parent, name);
            if (func) return func;
        }
        return undefined;
    }

    private resolveMemberCall(name: string, memberName: string, caller: GraphNode): GraphNode | undefined {
        // Try direct contract/interface reference
        const func = this.findInContract(memberName, name);
        if (func) return func;

        // Try using-for libraries
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

    private resolveLocalOrInheritedCall(name: string, caller: GraphNode): GraphNode | undefined {
        // Check local contract
        if (caller.contract) {
            const local = this.findInContract(caller.contract, name);
            if (local) return local;

            // Check inheritance (recursive)
            const inherited = this.resolveInheritedCall(name, caller.contract);
            if (inherited) return inherited;
        }

        // Check free functions
        const freeFuncs = this.symbolsByLabel.get(name);
        const free = freeFuncs?.find(n => !n.contract);
        if (free) return free;

        // Fallback: Loose matching (restore original behavior)
        // This is needed for cases where inheritance resolution fails or for complex chains
        const any = this.symbolsByLabel.get(name)?.[0];
        return any;
    }

    private resolveInheritedCall(name: string, contract: string, visited: Set<string> = new Set()): GraphNode | undefined {
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

    private async buildSymbolTable(files: FileContent[]) {
        const contractRule = {
            id: "contract",
            language: "Solidity",
            rule: {
                kind: "contract_declaration",
                any: [
                    { pattern: "contract $NAME { $$$ }" },
                    { pattern: "contract $NAME is $$$PARENTS { $$$ }" },
                    { pattern: "abstract contract $NAME { $$$ }" },
                    { pattern: "abstract contract $NAME is $$$PARENTS { $$$ }" }
                ]
            }
        };
        const interfaceRule = {
            id: "interface",
            language: "Solidity",
            rule: {
                kind: "interface_declaration",
                any: [
                    { pattern: "interface $NAME { $$$ }" },
                    { pattern: "interface $NAME is $$$PARENTS { $$$ }" }
                ]
            }
        };
        const libraryRule = {
            id: "library",
            language: "Solidity",
            rule: {
                kind: "library_declaration",
                any: [{ pattern: "library $NAME { $$$ }" }]
            }
        };

        const regularFunctionRule = {
            id: "function",
            language: "Solidity",
            rule: {
                kind: "function_definition",
                any: [
                    { pattern: "function $NAME($$$PARAMS) $$$MODIFIERS { $$$ }" },
                    { pattern: "function $NAME($$$PARAMS) $$$MODIFIERS;" }
                ]
            }
        };

        const fallbackReceiveRule = {
            id: "fallback_receive",
            language: "Solidity",
            rule: { kind: "fallback_receive_definition" }
        };

        const usingRule = {
            id: "using",
            language: "Solidity",
            rule: { kind: "using_directive", pattern: "using $LIB for $TYPE;" }
        };

        const freeFunctionRule = {
            id: "free_function",
            language: "Solidity",
            rule: {
                kind: "function_definition",
                not: { inside: { kind: "contract_body" } },
                any: [
                    { pattern: "function $NAME($$$PARAMS) $$$MODIFIERS { $$$ }" },
                    { pattern: "function $NAME($$$PARAMS) $$$MODIFIERS;" }
                ]
            }
        };

        for (const file of files) {
            // 1. Find Contracts/Interfaces/Libraries
            // We search separately to track the kind
            const contractMatches = await astGrep({ rule: contractRule, code: file.content });
            const interfaceMatches = await astGrep({ rule: interfaceRule, code: file.content });
            const libraryMatches = await astGrep({ rule: libraryRule, code: file.content });

            const allContainers = [
                ...contractMatches.map(c => ({ match: c, kind: 'contract' as const })),
                ...interfaceMatches.map(c => ({ match: c, kind: 'interface' as const })),
                ...libraryMatches.map(c => ({ match: c, kind: 'library' as const }))
            ];

            // 2. Process each container
            for (const { match: container, kind } of allContainers) {
                const contractName = container.metaVariables?.single?.NAME?.text;
                if (!contractName) continue;

                // Handle Inheritance
                const parentsText = container.metaVariables?.multi?.PARENTS
                    ?.map((p: any) => p.text)
                    .filter((t: string) => t !== ',')
                    .map((t: string) => t.trim()) || [];

                if (parentsText.length > 0) {
                    this.inheritanceGraph.set(contractName, parentsText);
                }

                // Track using-for
                const usingDirectives = await astGrep({ rule: usingRule, code: container.text });
                const libs = usingDirectives
                    .map(d => d.metaVariables?.single?.LIB?.text)
                    .filter((t): t is string => !!t);

                if (libs.length > 0) {
                    this.usingForMap.set(contractName, libs);
                }

                // Find functions
                const functions = await astGrep({ rule: regularFunctionRule, code: container.text });
                const fallbackReceives = await astGrep({ rule: fallbackReceiveRule, code: container.text });

                for (const fn of functions) {
                    this.indexSymbol(await this.createFunctionNode(fn, file.path, kind, contractName, container.range.start.line));
                }

                for (const fn of fallbackReceives) {
                    const text = fn.text.trim();
                    const name = text.includes('receive') ? 'receive' : 'fallback';
                    // Mock a match object for the helper
                    const mockFn = { ...fn, metaVariables: { single: { NAME: { text: name } }, multi: { PARAMS: [], MODIFIERS: [{ text: 'external' }] } } };
                    this.indexSymbol(await this.createFunctionNode(mockFn, file.path, kind, contractName, container.range.start.line));
                }
            }

            // 3. Find free functions
            const freeFunctions = await astGrep({ rule: freeFunctionRule, code: file.content });
            for (const fn of freeFunctions) {
                this.indexSymbol(await this.createFunctionNode(fn, file.path));
            }
        }
    }

    private async createFunctionNode(fn: any, file: string, containerKind?: 'contract' | 'interface' | 'library', contract?: string, baseLineOffset: number = 0): Promise<GraphNode> {
        const fnName = fn.metaVariables?.single?.NAME?.text!;
        let params = fn.metaVariables?.multi?.PARAMS?.map((p: { text: string }) => p.text).join('') || '';

        // Fallback: If ast-grep failed to capture params via pattern (common with complex types), extract via structural search
        if (!params && fn.text) {
            try {
                // We wrap in a contract to ensure valid parsing structure for the snippet
                // If it's already a method inside a contract, this mock contract wrapper is safe standard practice for snippet parsing
                const snippet = `contract C { ${fn.text} }`;
                const paramMatches = await astGrep({
                    code: snippet,
                    language: SupportedLanguage.Solidity,
                    rule: {
                        id: "parameter",
                        language: SupportedLanguage.Solidity,
                        rule: {
                            kind: "parameter",
                            inside: {
                                kind: "function_definition"
                            },
                            not: {
                                any: [
                                    { inside: { kind: "catch_clause" } },          // Exclude catch parameters
                                    { inside: { kind: "return_type_definition" } }, // Exclude return params
                                    { inside: { kind: "try_statement" } }, // Exclude try params (returns)
                                    // Crucial: Exclude parameters that are inside OTHER parameters (e.g. function type args)
                                    // We only want the top-level parameters of THIS function definition
                                    { inside: { kind: "parameter" } }
                                ]
                            }
                        }
                    }
                });

                if (paramMatches.length > 0) {
                    params = paramMatches.map(p => p.text).join(', ');
                }
            } catch (e) {
                // If sub-search fails, we leave params empty
                console.warn(`Failed to extract parameters for ${fnName} in ${file}`, e);
            }
        }

        const modifiers: string[] = fn.metaVariables?.multi?.MODIFIERS?.map((m: { text: string }) => m.text) ?? [];
        const visibility = modifiers.find(
            (m): m is 'external' | 'public' | 'internal' | 'private' =>
                ['external', 'public', 'internal', 'private'].includes(m)
        );

        const signature = this.cleanSignature(`${fnName}(${params})`);
        const id = contract ? `${contract}.${signature}` : signature;

        // Default visibility for interface functions is external if not specified
        const finalVisibility: 'public' | 'external' | 'internal' | 'private' = visibility ??
            (containerKind === 'interface' ? 'external' : 'internal'); // Default to internal otherwise

        return {
            id,
            label: fnName,
            file,
            contract,
            containerKind,
            visibility: finalVisibility,
            range: {
                start: { line: baseLineOffset + fn.range.start.line + 1, column: fn.range.start.column },
                end: { line: baseLineOffset + fn.range.end.line + 1, column: fn.range.end.column }
            },
            text: fn.text
        };
    }
}
