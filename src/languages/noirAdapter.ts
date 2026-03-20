import {
    FileContent, SupportedLanguage, SymbolEntry, Visibility,
    SymbolMap, CallTargetKind
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class NoirAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        FUNCTIONS: `(function_item) @function`,
        SIMPLE_CALL: `(call_expression function: (identifier) @FUNC)`,
        SCOPED_CALL: `(call_expression function: (scoped_identifier) @FUNC)`
    } as const;

    constructor() {
        super({
            languageId: SupportedLanguage.Noir,
            queries: {
                comments: `
                    (line_comment) @comment
                    (block_comment) @comment
                `,
                functions: `
                    (function_item) @function
                    (function_signature_item) @function
                `,
                branching: `
                    (if_expression) @branch
                    (for_statement) @branch
                    (comptime) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_item) @norm
                    (function_signature_item) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 150,
                complexityMidpoint: 10,
                complexitySteepness: 7,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 1.5,
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.3
            }
        });
    }

    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Noir);
        const parser = await service.createParser(SupportedLanguage.Noir);

        const functionQuery = new Query(lang, NoirAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                if (this.isNestedFunction(capture.node)) continue;
                const entry = this.createFunctionNode(capture.node, file.path);
                this.indexSymbol(entry);
            }
        }
    }

    private isNestedFunction(funcNode: Node): boolean {
        let current = funcNode.parent;
        while (current) {
            if (current.type === 'function_item') return true;
            current = current.parent;
        }
        return false;
    }

    private createFunctionNode(node: Node, file: string): SymbolEntry {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';
        const visibility = this.extractVisibility(node);

        return this.createEntry({
            qualifiedName: fnName,
            label: fnName,
            file,
            node,
            visibility,
        });
    }

    private extractVisibility(node: Node): Visibility {
        for (const child of node.children) {
            if (child.type === 'visibility_modifier' || child.text === 'pub') {
                return 'public';
            }
        }
        return 'private';
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

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_expression';
    }

    override isStateWrite(node: Node): boolean {
        return node.type === 'assignment_expression';
    }

    override isStateRead(node: Node): boolean {
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

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'call_expression') return null;
        const func = node.childForFieldName('function');
        if (func?.type === 'identifier') return func.text;
        if (func?.type === 'scoped_identifier') {
            const parts = func.text.split('::');
            return parts[parts.length - 1];
        }
        return null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment_expression') return null;
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

    protected override async identifyCalls(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Noir);
        const parser = await service.createParser(SupportedLanguage.Noir);

        const functionQuery = new Query(lang, NoirAdapter.QUERIES.FUNCTIONS);
        const simpleCallQuery = new Query(lang, NoirAdapter.QUERIES.SIMPLE_CALL);

        // Scoped call query may not be supported in all Noir grammar versions
        let scopedCallQuery: Query | null = null;
        try {
            scopedCallQuery = new Query(lang, NoirAdapter.QUERIES.SCOPED_CALL);
        } catch {
            // Not supported in this grammar version
        }

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const functionNode = capture.node;
                if (this.isNestedFunction(functionNode)) continue;

                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                // Simple calls
                const simpleCaptures = simpleCallQuery.captures(functionNode);
                for (const callCapture of simpleCaptures) {
                    if (callCapture.name !== 'FUNC') continue;
                    const callName = callCapture.node.text;
                    const callee = this.symbolsByLabel.get(callName)?.[0];
                    if (callee && callee.qualifiedName !== symbol.qualifiedName) {
                        this.addCallee(symbol.qualifiedName, this.makeCallee(callee.qualifiedName));
                    } else if (!callee) {
                        this.addCallee(symbol.qualifiedName, this.makeCallee(callName, 'external_unknown'));
                    }
                }

                // Scoped calls (e.g., Module::function)
                if (scopedCallQuery) {
                    const scopedCaptures = scopedCallQuery.captures(functionNode);
                    for (const callCapture of scopedCaptures) {
                        if (callCapture.name !== 'FUNC') continue;
                        const callText = callCapture.node.text;
                        const funcName = callText.includes('::')
                            ? callText.split('::').pop()!
                            : callText;
                        const callee = this.symbolsByLabel.get(funcName)?.[0];
                        if (callee && callee.qualifiedName !== symbol.qualifiedName) {
                            this.addCallee(symbol.qualifiedName, this.makeCallee(callee.qualifiedName));
                        } else if (!callee) {
                            this.addCallee(symbol.qualifiedName, this.makeCallee(callText, 'external_unknown'));
                        }
                    }
                }
            }
        }
    }

    private static readonly STDLIB_NAMES = new Set([
        // Noir standard library
        'assert', 'assert_eq', 'assert_constant', 'panic',
        'std', 'dep',
        'println', 'print',
        'from_field', 'to_field', 'from_bits', 'to_bits', 'from_bytes', 'to_bytes',
        'modulus', 'pow_32', 'wrapping_add', 'wrapping_sub', 'wrapping_mul',
        'to_le_bytes', 'to_be_bytes', 'to_le_bits', 'to_be_bits',
        'pedersen_hash', 'pedersen_commitment', 'sha256', 'blake2s', 'blake3',
        'keccak256', 'poseidon', 'poseidon2',
        'ecdsa_secp256k1', 'ecdsa_secp256r1', 'schnorr', 'ed25519',
        'aes128_encrypt', 'sha256_compression',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        if (NoirAdapter.STDLIB_NAMES.has(name)) return true;
        const sep = name.indexOf('::');
        if (sep !== -1) {
            const prefix = name.slice(0, sep);
            if (prefix === 'std' || prefix === 'dep') return true;
        }
        return false;
    }

}
