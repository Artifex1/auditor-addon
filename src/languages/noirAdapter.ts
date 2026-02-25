import { FileContent, SupportedLanguage, GraphNode, GraphEdge, Visibility } from "../engine/types.js";
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
                baseRateNlocPerDay: 300,
                complexityMidpoint: 10,
                complexitySteepness: 7,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 0.6,
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
                const node = this.createFunctionNode(capture.node, file.path);
                this.indexSymbol(node);
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

    private createFunctionNode(node: Node, file: string): GraphNode {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';
        const visibility = this.extractVisibility(node);

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

    private extractVisibility(node: Node): Visibility {
        for (const child of node.children) {
            if (child.type === 'visibility_modifier' || child.text === 'pub') {
                return 'public';
            }
        }
        return 'private';
    }

    protected override async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
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
                    if (callee && callee.id !== symbol.id) {
                        this.addEdge(edges, symbol.id, callee.id);
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
                        if (callee && callee.id !== symbol.id) {
                            this.addEdge(edges, symbol.id, callee.id);
                        }
                    }
                }
            }
        }
    }

}
