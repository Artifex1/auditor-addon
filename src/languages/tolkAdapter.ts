import { FileContent, SupportedLanguage, GraphNode, GraphEdge, Visibility } from "../engine/types.js";
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
                baseRateNlocPerDay: 300, // Tolk is low-level, similar to C++ in audit effort
                complexityMidpoint: 15,
                complexitySteepness: 9,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 0.6,
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
                this.indexSymbol(node);
            }
        }
    }

    private createFunctionNode(node: Node, file: string): GraphNode {
        // function_declaration: fun, identifier, parameter_list, [: type], block_statement
        const nameNode = node.children.find(c => c.type === 'identifier');
        const fnName = nameNode?.text ?? 'unknown';

        // Tolk has no explicit visibility modifiers in basic syntax — all functions are public
        const visibility: Visibility = 'public';

        return {
            id: fnName,
            label: fnName,
            file,
            visibility,
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column }
            },
            text: node.text
        };
    }

    protected override async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
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
                const symbol = this.findSymbolAtNode(funcNode, file.path);
                if (!symbol) continue;

                const callCaptures = callQuery.captures(funcNode);
                for (const callCapture of callCaptures) {
                    if (callCapture.name !== 'FUNC') continue;
                    const calleeName = callCapture.node.text;
                    const callee = this.symbolsByLabel.get(calleeName)?.[0];
                    if (callee && callee.id !== symbol.id) {
                        this.addEdge(edges, symbol.id, callee.id);
                    }
                }
            }
        }
    }
}
