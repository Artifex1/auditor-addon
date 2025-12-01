import { LanguageAdapter, Entrypoint, FunctionInsights, FileContent, SupportedLanguage, CallGraph, GraphNode, GraphEdge } from "../engine/index.js";
import { astGrep } from "../util/astGrepCli.js";

interface ExtendedGraphNode extends GraphNode {
    text: string;
}

enum CallType {
    Simple,
    Member,
    This,
    Super
}

export class SolidityAdapter implements LanguageAdapter {
    languageId = SupportedLanguage.Solidity;

    private symbolTable: Map<string, ExtendedGraphNode> = new Map();
    private inheritanceGraph: Map<string, string[]> = new Map(); // child -> parents
    private usingForMap: Map<string, string[]> = new Map(); // contract -> libraries

    async extractEntrypoints(files: FileContent[]): Promise<Entrypoint[]> {
        this.symbolTable.clear();
        // Build the symbol table first
        await this.buildSymbolTable(files);

        // Filter for public and external functions
        return Array.from(this.symbolTable.values())
            .filter(node => node.visibility === 'public' || node.visibility === 'external')
            .map(node => ({
                file: node.file,
                contract: node.contract || 'Unknown',
                name: node.label,
                signature: node.id.includes('.') ? node.id.split('.').pop()! : node.id,
                visibility: node.visibility!,
                location: {
                    line: node.range.start.line,
                    column: node.range.start.column
                }
            }));
    }


    async extractFunctionInsights(files: FileContent[], selector: any): Promise<FunctionInsights> {
        // TODO: Implement
        return {};
    }

    async generateCallGraph(files: FileContent[]): Promise<CallGraph> {
        this.symbolTable.clear();
        this.inheritanceGraph.clear();
        const edges: GraphEdge[] = [];

        // Phase 1: Symbol Table & Inheritance Generation
        await this.buildSymbolTable(files);

        // Phase 2: Call Identification
        await this.identifyCalls(files, edges);

        return { nodes: Array.from(this.symbolTable.values()), edges };
    }

    private async identifyCalls(files: FileContent[], edges: GraphEdge[]) {
        for (const node of this.symbolTable.values()) {
            // Rule 1: Process super calls - super.FUNC($$$)
            const superCalls = await astGrep({
                rule: {
                    id: "super_call",
                    language: "Solidity",
                    rule: {
                        kind: "call_expression",
                        pattern: {
                            context: "function f() { super.$FUNC($$$); }",
                            selector: "call_expression"
                        }
                    }
                },
                code: node.text
            });

            for (const call of superCalls) {
                const funcName = call.metaVariables?.single?.FUNC?.text;
                if (!funcName) continue;

                const calleeId = this.resolveCall(CallType.Super, funcName, undefined, node);
                if (calleeId) {
                    edges.push({ from: node.id, to: calleeId });
                }
            }

            // Rule 2: Process member calls - RECV.FUNC($$$)
            const memberCalls = await astGrep({
                rule: {
                    id: "member_call",
                    language: "Solidity",
                    rule: {
                        kind: "call_expression",
                        pattern: {
                            context: "function f() { $RECV.$FUNC($$$); }",
                            selector: "call_expression"
                        }
                    }
                },
                code: node.text
            });

            for (const call of memberCalls) {
                const funcName = call.metaVariables?.single?.FUNC?.text;
                const memberName = call.metaVariables?.single?.RECV?.text;
                if (!funcName || !memberName) continue;

                // Skip if it's a super call (already processed)
                if (memberName === 'super') continue;

                // Skip built-in functions
                if (['require', 'assert', 'revert', 'emit'].includes(funcName)) continue;

                const calleeId = this.resolveCall(CallType.Member, funcName, memberName, node);
                if (calleeId) {
                    edges.push({ from: node.id, to: calleeId });
                }
            }

            // Rule 3: Process this.func() calls - this.$FUNC($$$)
            const thisCalls = await astGrep({
                rule: {
                    id: "this_call",
                    language: "Solidity",
                    rule: {
                        kind: "call_expression",
                        pattern: {
                            context: "function f() { this.$FUNC($$$); }",
                            selector: "call_expression"
                        }
                    }
                },
                code: node.text
            });

            for (const call of thisCalls) {
                const funcName = call.metaVariables?.single?.FUNC?.text;
                if (!funcName) continue;

                const calleeId = this.resolveCall(CallType.This, funcName, undefined, node);
                if (calleeId) {
                    edges.push({ from: node.id, to: calleeId });
                }
            }

            // Rule 4: Process simple calls - FUNC($$$)
            const simpleCalls = await astGrep({
                rule: {
                    id: "simple_call",
                    language: "Solidity",
                    rule: {
                        kind: "call_expression",
                        pattern: {
                            context: "function f() { $FUNC($$$); }",
                            selector: "call_expression"
                        }
                    }
                },
                code: node.text
            });

            for (const call of simpleCalls) {
                let callName = call.metaVariables?.single?.FUNC?.text;
                if (!callName) continue;

                // Skip if it contains a dot (it's a member call, already processed)
                if (callName.includes('.')) continue;

                // Skip built-in functions
                if (['require', 'assert', 'revert', 'emit'].includes(callName)) continue;

                const calleeId = this.resolveCall(CallType.Simple, callName, undefined, node);
                if (calleeId) {
                    edges.push({ from: node.id, to: calleeId });
                }
            }

            // Rule 5: Process assembly calls - yul_function_call
            const assemblyCalls = await astGrep({
                rule: {
                    id: "assembly_call",
                    language: "Solidity",
                    rule: {
                        kind: "yul_function_call"
                    }
                },
                code: node.text
            });

            for (const call of assemblyCalls) {
                const text = call.text;
                const parenIndex = text.indexOf('(');
                if (parenIndex === -1) continue;

                const callName = text.substring(0, parenIndex).trim();
                const calleeId = this.resolveCall(CallType.Simple, callName, undefined, node);
                if (calleeId) {
                    edges.push({ from: node.id, to: calleeId });
                }
            }
        }
    }

    private resolveCall(type: CallType, name: string, memberName: string | undefined, caller: ExtendedGraphNode): string | undefined {
        // 1. Handle Super Calls
        if (type === CallType.Super) {
            if (!caller.contract) return undefined;
            const parents = this.inheritanceGraph.get(caller.contract);
            if (!parents || parents.length === 0) return undefined;

            for (const parent of parents) {
                const parentFunc = Array.from(this.symbolTable.values()).find(n =>
                    n.contract === parent && n.label === name
                );
                if (parentFunc) return parentFunc.id;
            }
            return undefined;
        }

        // 2. Handle Member Calls (e.g., other.func())
        if (type === CallType.Member && memberName) {
            // Try to find a contract/library/interface with the given name
            const targetFunc = Array.from(this.symbolTable.values()).find(n =>
                n.contract === memberName && n.label === name
            );
            if (targetFunc) return targetFunc.id;

            // Check using-for libraries
            if (caller.contract) {
                const libraries = this.usingForMap.get(caller.contract);
                if (libraries) {
                    for (const lib of libraries) {
                        const libFunc = Array.from(this.symbolTable.values()).find(n =>
                            n.contract === lib && n.label === name
                        );
                        if (libFunc) return libFunc.id;
                    }
                }
            }
            return undefined;
        }

        // 3. Handle This Calls (this.func())
        if (type === CallType.This) {
            if (!caller.contract) return undefined;
            // Resolve to external/public function in the same contract or parents
            // For now, reuse simple resolution logic but restricted to current contract hierarchy
            // Actually, this.func() is an external call, but for the graph we just want to link to the definition.
            // We can treat it similar to a simple call but skip the local check if we wanted to be strict about visibility,
            // but for now let's just find the function.
        }

        // 4. Handle Simple Calls (func()) and This Calls
        // Check local contract
        if (caller.contract) {
            const localCandidate = Array.from(this.symbolTable.values()).find(n =>
                n.contract === caller.contract && n.label === name
            );
            if (localCandidate) return localCandidate.id;

            // Check Inheritance
            const parents = this.inheritanceGraph.get(caller.contract);
            if (parents) {
                for (const parent of parents) {
                    const parentCandidate = Array.from(this.symbolTable.values()).find(n =>
                        n.contract === parent && n.label === name
                    );
                    if (parentCandidate) return parentCandidate.id;
                }
            }
        }

        // Check using-for libraries (for simple calls, it might be a library function attached to a type, 
        // but usually that appears as a member call. However, if it's a direct library call like Lib.func(), 
        // it would be a member call. If it's just func() it might be a free function or inherited.)

        // Check for free functions / global search
        const globalCandidate = Array.from(this.symbolTable.values()).find(n => n.label === name && !n.contract);
        if (globalCandidate) return globalCandidate.id;

        // Fallback: Check any function with that name (loose matching)
        const anyCandidate = Array.from(this.symbolTable.values()).find(n => n.label === name);
        if (anyCandidate) return anyCandidate.id;

        return undefined;
    }

    private async buildSymbolTable(files: FileContent[]) {
        const contractRule = {
            id: "contract_declaration",
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
            id: "interface_declaration",
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
            id: "library_declaration",
            language: "Solidity",
            rule: {
                kind: "library_declaration",
                pattern: "library $NAME { $$$ }"
            }
        };

        // Separate rules for regular functions and fallback/receive
        const regularFunctionRule = {
            id: "regular_function",
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
            rule: {
                kind: "fallback_receive_definition"
            }
        };

        // Track using-for directives
        const usingRule = {
            id: "using_directive",
            language: "Solidity",
            rule: {
                kind: "using_directive",
                pattern: "using $LIB for $TYPE;"
            }
        };

        for (const file of files) {
            // 1. Find Contracts/Interfaces/Libraries
            const contracts = await astGrep({
                rule: contractRule,
                code: file.content
            });
            const interfaces = await astGrep({
                rule: interfaceRule,
                code: file.content
            });
            const libraries = await astGrep({
                rule: libraryRule,
                code: file.content
            });

            const allContracts = [...contracts, ...interfaces, ...libraries];

            // 2. Process each contract and its functions
            for (const contract of allContracts) {
                const contractName = contract.metaVariables?.single?.NAME?.text;
                if (!contractName) continue;

                // Handle Inheritance
                const parentsText: string[] = contract.metaVariables?.multi?.PARENTS
                    ?.map((p: { text: string }) => p.text)
                    .filter((t: string) => t !== ',')
                    .map((t: string) => t.trim()) || [];

                if (parentsText.length > 0) {
                    this.inheritanceGraph.set(contractName, parentsText);
                }

                // Track using-for directives
                const usingDirectives = await astGrep({
                    rule: usingRule,
                    code: contract.text
                });

                const libs: string[] = [];
                for (const directive of usingDirectives) {
                    const libName = directive.metaVariables?.single?.LIB?.text;
                    if (libName) {
                        libs.push(libName);
                    }
                }

                if (libs.length > 0) {
                    this.usingForMap.set(contractName, libs);
                }

                // Find functions within this contract (optimization: search contract.text instead of file.content)
                const contractFunctions = await astGrep({
                    rule: regularFunctionRule,
                    code: contract.text
                });

                const contractFallbackReceive = await astGrep({
                    rule: fallbackReceiveRule,
                    code: contract.text
                });

                // Process regular functions
                for (const fn of contractFunctions) {
                    const fnName = fn.metaVariables?.single?.NAME?.text;
                    if (!fnName) continue;

                    // Extract visibility
                    const modifiers: string[] = fn.metaVariables?.multi?.MODIFIERS
                        ?.map((m: { text: string }) => m.text) ?? [];
                    const visibility = modifiers.find(
                        (m): m is 'external' | 'public' | 'internal' | 'private' =>
                            m === 'external' || m === 'public' || m === 'internal' || m === 'private'
                    );

                    // Build ID
                    const params = fn.metaVariables?.multi?.PARAMS?.map((p: { text: string }) => p.text).join('') || '';
                    const signature = `${fnName}(${params})`;
                    const id = `${contractName}.${signature}`;

                    const node: ExtendedGraphNode = {
                        id,
                        label: fnName,
                        file: file.path,
                        contract: contractName,
                        visibility,
                        range: {
                            start: { line: contract.range.start.line + fn.range.start.line + 1, column: fn.range.start.column },
                            end: { line: contract.range.start.line + fn.range.end.line + 1, column: fn.range.end.column }
                        },
                        text: fn.text
                    };

                    this.symbolTable.set(id, node);
                }

                // Process fallback/receive functions
                for (const fn of contractFallbackReceive) {
                    // Determine if it's fallback or receive by checking the text
                    const text = fn.text.trim();
                    let fnName: string;
                    if (text.includes('fallback')) {
                        fnName = 'fallback';
                    } else if (text.includes('receive')) {
                        fnName = 'receive';
                    } else {
                        continue;
                    }

                    const signature = `${fnName}()`;
                    const id = `${contractName}.${signature}`;

                    const node: ExtendedGraphNode = {
                        id,
                        label: fnName,
                        file: file.path,
                        contract: contractName,
                        visibility: 'external', // fallback/receive are always external
                        range: {
                            start: { line: contract.range.start.line + fn.range.start.line + 1, column: fn.range.start.column },
                            end: { line: contract.range.start.line + fn.range.end.line + 1, column: fn.range.end.column }
                        },
                        text: fn.text
                    };

                    this.symbolTable.set(id, node);
                }
            }

            // 3. Find free functions (functions not inside any contract/interface/library)
            const freeFunctionRule = {
                id: "free_function",
                language: "Solidity",
                rule: {
                    kind: "function_definition",
                    not: {
                        inside: {
                            kind: "contract_body"
                        }
                    },
                    any: [
                        { pattern: "function $NAME($$$PARAMS) $$$MODIFIERS { $$$ }" },
                        { pattern: "function $NAME($$$PARAMS) $$$MODIFIERS;" }
                    ]
                }
            };

            const freeFunctions = await astGrep({
                rule: freeFunctionRule,
                code: file.content
            });

            for (const fn of freeFunctions) {
                const fnName = fn.metaVariables?.single?.NAME?.text;
                if (!fnName) continue;

                // Extract visibility
                const modifiers: string[] = fn.metaVariables?.multi?.MODIFIERS
                    ?.map((m: { text: string }) => m.text) ?? [];
                const visibility = modifiers.find(
                    (m): m is 'external' | 'public' | 'internal' | 'private' =>
                        m === 'external' || m === 'public' || m === 'internal' || m === 'private'
                );

                // Build ID
                const params = fn.metaVariables?.multi?.PARAMS?.map((p: { text: string }) => p.text).join('') || '';
                const signature = `${fnName}(${params})`;
                const id = signature; // Free functions don't have a contract prefix

                const node: ExtendedGraphNode = {
                    id,
                    label: fnName,
                    file: file.path,
                    contract: undefined,
                    visibility,
                    range: {
                        start: { line: fn.range.start.line + 1, column: fn.range.start.column },
                        end: { line: fn.range.end.line + 1, column: fn.range.end.column }
                    },
                    text: fn.text
                };

                this.symbolTable.set(id, node);
            }
        }
    }
}
