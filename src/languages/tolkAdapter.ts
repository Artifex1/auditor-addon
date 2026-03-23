import {
    FileContent, SupportedLanguage, GraphNode, Visibility
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class TolkAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        FUNCTIONS: `(function_declaration) @function`,
        // Tolk calls: (function_call (identifier) @FUNC ...)
        SIMPLE_CALL: `(function_call (identifier) @FUNC)`
    } as const;

    constructor() {
        super({
            languageId: SupportedLanguage.Tolk,
            queries: {
                comments: '(comment) @comment',
                functions: '(function_declaration) @function',
                branching: `
                    (if_statement) @branch
                    (while_statement) @branch
                    (do_while_statement) @branch
                    (repeat_statement) @branch
                    (match_expression) @branch
                    (try_catch_statement) @branch
                `,
                normalization: `
                    (function_call) @norm
                    (function_declaration) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 150, // Tolk is low-level, similar to C++ in audit effort
                complexityMidpoint: 15,
                complexitySteepness: 9,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 1.2,
                commentFullBenefitDensity: 18,
                commentBenefitCap: 0.3
            }
        });
    }

    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Tolk);
        const parser = await service.createParser(SupportedLanguage.Tolk);
        const functionQuery = new Query(lang, TolkAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const captures = functionQuery.captures(tree.rootNode);
            for (const capture of captures) {
                const funcNode = capture.node;
                const node = this.createFunctionNode(funcNode, file.path);
                this.addNode(node);
            }
        }
    }

    private createFunctionNode(node: Node, file: string): GraphNode {
        // function_declaration: fun, identifier, parameter_list, [: type], block_statement
        const nameNode = node.children.find(c => c.type === 'identifier');
        const fnName = nameNode?.text ?? 'unknown';

        // Tolk has no explicit visibility modifiers in basic syntax — all functions are public
        const visibility: Visibility = 'public';

        return this.createNode({
            qualifiedName: fnName,
            label: fnName,
            file,
            node,
            visibility,
        });
    }

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'function_declaration';
    }

    override getFunctionName(node: Node): string | null {
        if (node.type === 'function_declaration') {
            return node.children.find(c => c.type === 'identifier')?.text ?? null;
        }
        return null;
    }

    override isPublicFn(_node: Node): boolean {
        // All Tolk functions are public
        return true;
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_statement';
    }

    override isStateWrite(node: Node): boolean {
        return node.type === 'assignment_expression'
            || node.type === 'augmented_assignment_expression';
    }

    override isStateRead(node: Node): boolean {
        if (node.type === 'identifier') {
            const parent = node.parent;
            if (parent?.type === 'assignment_expression'
                && parent.children[0]?.id === node.id) {
                return false;
            }
            return true;
        }
        return false;
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'function_call') return null;
        const idChild = node.children.find(c => c.type === 'identifier');
        return idChild?.text ?? null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment_expression') return null;
        return node.children[0]?.text ?? null;
    }

    protected override async identifyCalls(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Tolk);
        const parser = await service.createParser(SupportedLanguage.Tolk);
        const functionQuery = new Query(lang, TolkAdapter.QUERIES.FUNCTIONS);
        const callQuery = new Query(lang, TolkAdapter.QUERIES.SIMPLE_CALL);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const captures = functionQuery.captures(tree.rootNode);
            for (const capture of captures) {
                const funcNode = capture.node;
                const callerNode = this.findNodeAtPosition(funcNode, file.path);
                if (!callerNode) continue;

                const callCaptures = callQuery.captures(funcNode);
                for (const callCapture of callCaptures) {
                    if (callCapture.name !== 'FUNC') continue;
                    const callNode = callCapture.node;
                    const calleeName = callNode.text;
                    const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
                    const callee = this._graph.findByName(calleeName).find(n => n.status === 'concrete');
                    if (callee && callee.qualifiedName !== callerNode.qualifiedName) {
                        this.addCallEdge(callerNode.id, callee.qualifiedName, 'internal', callSite);
                    } else if (!callee) {
                        this.addCallEdge(callerNode.id, calleeName, 'external_unknown', callSite);
                    }
                }
            }
        }
    }

    private static readonly STDLIB_NAMES = new Set([
        // Tolk built-in functions and common FunC/Tolk stdlib
        'send_raw_message', 'get_data', 'set_data', 'get_balance',
        'accept_message', 'reserve_extra_currencies',
        'slice_empty', 'slice_bits', 'slice_refs', 'slice_bits_refs', 'slice_data',
        'load_bits', 'load_uint', 'load_int', 'load_ref', 'load_maybe_ref',
        'load_coins', 'load_address', 'skip_bits',
        'store_uint', 'store_int', 'store_ref', 'store_maybe_ref', 'store_bits',
        'store_coins', 'store_address', 'store_builder',
        'begin_cell', 'end_cell', 'begin_parse',
        'cell_hash', 'slice_hash', 'string_hash',
        'throw', 'throw_if', 'throw_unless', 'return',
        'random', 'randomize_lt', 'cur_lt', 'now',
        'is_address_none', 'pack_address', 'address_hash',
        'tvm_hash', 'config_param', 'raw_commit',
        'divmod', 'moddiv', 'muldiv', 'muldivr', 'muldivc', 'muldivmod',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        return TolkAdapter.STDLIB_NAMES.has(name);
    }
}
