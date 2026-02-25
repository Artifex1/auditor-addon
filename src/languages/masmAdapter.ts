import { FileContent, SupportedLanguage, GraphNode, GraphEdge, Visibility } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class MasmAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        PROCEDURES: `(procedure) @proc`,
        ENTRY: `(entrypoint) @entry`,
        CALLS: `(invoke) @call`
    } as const;

    constructor() {
        super({
            languageId: SupportedLanguage.Masm,
            queries: {
                comments: `
                    (comment) @comment
                    (doc_comment) @comment
                    (moduledoc) @comment
                `,
                functions: `
                    (procedure) @function
                    (entrypoint) @function
                `,
                branching: `
                    (if) @branch
                    (while) @branch
                    (repeat) @branch
                `,
                normalization: `
                    (invoke) @norm
                    (procedure) @norm
                    (entrypoint) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 350,
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
        const lang = await service.getLanguage(SupportedLanguage.Masm);
        const parser = await service.createParser(SupportedLanguage.Masm);

        const procQuery = new Query(lang, MasmAdapter.QUERIES.PROCEDURES);
        const entryQuery = new Query(lang, MasmAdapter.QUERIES.ENTRY);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // Index procedures
            const procCaptures = procQuery.captures(tree.rootNode);
            for (const capture of procCaptures) {
                const node = this.createProcedureNode(capture.node, file.path);
                this.indexSymbol(node);
            }

            // Index entrypoints
            const entryCaptures = entryQuery.captures(tree.rootNode);
            for (const capture of entryCaptures) {
                const node = this.createEntrypointNode(capture.node, file.path);
                this.indexSymbol(node);
            }
        }
    }

    private createProcedureNode(node: Node, file: string): GraphNode {
        const nameNode = node.childForFieldName('name') ||
            node.children.find(c => c.type === 'identifier' || c.type === 'proc_name');
        const fnName = nameNode?.text ?? 'unknown';

        // Check if it's an exported procedure
        const isExported = node.text.trimStart().startsWith('export');
        const visibility: Visibility = isExported ? 'public' : 'private';

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

    private createEntrypointNode(node: Node, file: string): GraphNode {
        const id = 'begin';
        return {
            id,
            label: id,
            file,
            visibility: 'external',
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column }
            },
            text: node.text
        };
    }

    protected override async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Masm);
        const parser = await service.createParser(SupportedLanguage.Masm);

        const procQuery = new Query(lang, MasmAdapter.QUERIES.PROCEDURES);
        const entryQuery = new Query(lang, MasmAdapter.QUERIES.ENTRY);
        const callQuery = new Query(lang, MasmAdapter.QUERIES.CALLS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // Process procedures
            const procCaptures = procQuery.captures(tree.rootNode);
            for (const capture of procCaptures) {
                const procNode = capture.node;
                const symbol = this.findSymbolAtNode(procNode, file.path);
                if (!symbol) continue;

                this.processCallsInNode(procNode, symbol, edges, callQuery);
            }

            // Process entrypoints
            const entryCaptures = entryQuery.captures(tree.rootNode);
            for (const capture of entryCaptures) {
                const entryNode = capture.node;
                const symbol = this.findSymbolAtNode(entryNode, file.path);
                if (!symbol) continue;

                this.processCallsInNode(entryNode, symbol, edges, callQuery);
            }
        }
    }

    private processCallsInNode(node: Node, caller: GraphNode, edges: GraphEdge[], callQuery: Query) {
        const callCaptures = callQuery.captures(node);
        for (const capture of callCaptures) {
            const callNode = capture.node;
            const calleeName = this.extractCalleeName(callNode);
            if (!calleeName) continue;

            const callee = this.symbolsByLabel.get(calleeName)?.[0];
            if (callee && callee.id !== caller.id) {
                this.addEdge(edges, caller.id, callee.id);
            }
        }
    }

    private extractCalleeName(callNode: Node): string | undefined {
        // invoke instruction: `exec.proc_name` or `call.proc_name`
        // The target is typically a child node with the procedure path
        const target = callNode.childForFieldName('target') ||
            callNode.children.find(c => c.type === 'identifier' || c.type === 'proc_name' || c.type === 'path');

        if (target) return target.text;

        // Fallback: extract from the node text
        // invoke instruction text looks like: "exec.foo" or "call.foo"
        const text = callNode.text.trim();
        const match = text.match(/(?:exec|call|syscall)\.(\S+)/);
        return match?.[1];
    }

}
