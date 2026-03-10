import { FileContent, SupportedLanguage, GraphNode, GraphEdge, Visibility } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class CompactAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        FUNCTIONS: `(cdefn) @function`,
        CALLS: `(function_call_term) @call`
    } as const;

    constructor() {
        super({
            languageId: SupportedLanguage.Compact,
            queries: {
                comments: '(comment) @comment',
                functions: '(cdefn) @function',
                branching: `
                    (if_stmt) @branch
                    (for_stmt) @branch
                    (conditional_expr) @branch
                `,
                normalization: `
                    (function_call_term) @norm
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
        const lang = await service.getLanguage(SupportedLanguage.Compact);
        const parser = await service.createParser(SupportedLanguage.Compact);

        const functionQuery = new Query(lang, CompactAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const node = this.createFunctionNode(capture.node, file.path);
                this.indexSymbol(node);
            }
        }
    }

    private createFunctionNode(node: Node, file: string): GraphNode {
        // Compact cdefn has a (function_name) child for the function name
        const nameNode = node.childForFieldName('name') ||
            node.children.find(c => c.type === 'function_name' || c.type === 'identifier');
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
        // Check for export keyword
        for (const child of node.children) {
            if (child.type === 'export' || child.text === 'export') return 'public';
            if (child.type === 'visibility_modifier') {
                if (child.text === 'export' || child.text === 'public') return 'public';
            }
        }

        // Check if it's a ledger/circuit declaration (typically public interface)
        if (node.type === 'circuit_decl' || node.type === 'ledger_decl') return 'public';

        // Check node text for export keyword
        const firstLine = node.text.split('\n')[0];
        if (firstLine.includes('export')) return 'public';

        return 'private';
    }

    protected override async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Compact);
        const parser = await service.createParser(SupportedLanguage.Compact);

        const functionQuery = new Query(lang, CompactAdapter.QUERIES.FUNCTIONS);
        const callQuery = new Query(lang, CompactAdapter.QUERIES.CALLS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const funcNode = capture.node;
                const symbol = this.findSymbolAtNode(funcNode, file.path);
                if (!symbol) continue;

                const callCaptures = callQuery.captures(funcNode);
                for (const callCapture of callCaptures) {
                    const callNode = callCapture.node;
                    const calleeName = this.extractCalleeName(callNode);
                    if (!calleeName) continue;

                    const callee = this.symbolsByLabel.get(calleeName)?.[0];
                    if (callee && callee.id !== symbol.id) {
                        this.addEdge(edges, symbol.id, callee.id);
                    }
                }
            }
        }
    }

    private extractCalleeName(callNode: Node): string | undefined {
        // function_call_term: the first child is typically the function name
        const nameNode = callNode.childForFieldName('function') ||
            callNode.childForFieldName('name') ||
            callNode.firstChild;

        if (nameNode) return nameNode.text;
        return undefined;
    }

}
