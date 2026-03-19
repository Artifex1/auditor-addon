import { FileContent, SupportedLanguage, GraphNode, GraphEdge, Visibility, FileMetrics, DiffFileMetrics } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class NoirAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        FUNCTIONS: `(function_item) @function`,
        SIMPLE_CALL: `(call_expression function: (identifier) @FUNC)`,
        SCOPED_CALL: `(call_expression function: (scoped_identifier) @FUNC)`,
        ATTR_ITEM: `(attribute_item (content) @content) @attr`
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

    /**
     * Strips test code from Noir source content.
     * Removes standalone #[test] functions (including #[test(should_fail)] etc.).
     * Noir has no test module concept.
     */
    async stripTestCode(content: string): Promise<string> {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Noir);
        const parser = await service.createParser(SupportedLanguage.Noir);

        const tree = parser.parse(content);
        if (!tree) return content;

        const rangesToRemove: Array<{ start: number; end: number }> = [];

        // Noir's grammar stores attribute content as a flat text node.
        // Match attribute_items whose content starts with "test".
        const attrQuery = new Query(lang, NoirAdapter.QUERIES.ATTR_ITEM);
        const testAttrs = new Set(
            attrQuery.matches(tree.rootNode)
                .filter(m => {
                    const content = m.captures.find(c => c.name === 'content');
                    return content && /^test\b/.test(content.node.text);
                })
                .map(m => m.captures.find(c => c.name === 'attr')!.node.id)
        );

        // Find #[test] functions
        const fnQuery = new Query(lang, '(function_item) @fn');
        const fnCaptures = fnQuery.captures(tree.rootNode);

        for (const capture of fnCaptures) {
            if (this.hasTestAttribute(capture.node, testAttrs)) {
                const attrStart = this.getAttributeStart(capture.node);
                rangesToRemove.push({
                    start: attrStart,
                    end: capture.node.endIndex
                });
            }
        }

        if (rangesToRemove.length === 0) return content;

        rangesToRemove.sort((a, b) => b.start - a.start);

        let result = content;
        for (const range of rangesToRemove) {
            let end = range.end;
            if (end < result.length && result[end] === '\n') end++;
            result = result.substring(0, range.start) + result.substring(end);
        }

        return result;
    }

    private hasTestAttribute(node: Node, testAttrIds: Set<number>): boolean {
        let prev = node.previousNamedSibling;
        while (prev && prev.type === 'attribute_item') {
            if (testAttrIds.has(prev.id)) return true;
            prev = prev.previousNamedSibling;
        }
        return false;
    }

    private getAttributeStart(node: Node): number {
        let start = node.startIndex;
        let prev = node.previousNamedSibling;
        while (prev && prev.type === 'attribute_item') {
            start = prev.startIndex;
            prev = prev.previousNamedSibling;
        }
        return start;
    }

    override async calculateMetrics(files: FileContent[]): Promise<FileMetrics[]> {
        const strippedFiles = await Promise.all(
            files.map(async (file) => ({
                path: file.path,
                content: await this.stripTestCode(file.content)
            }))
        );
        return super.calculateMetrics(strippedFiles);
    }

    override async calculateDiffMetrics(
        file: FileContent,
        addedLines: number[],
        removedLines: number[],
        status: 'added' | 'modified' | 'deleted'
    ): Promise<DiffFileMetrics> {
        if (status === 'deleted') {
            return super.calculateDiffMetrics(file, addedLines, removedLines, status);
        }

        const strippedContent = await this.stripTestCode(file.content);
        const originalLines = file.content.split('\n');
        const strippedLines = strippedContent.split('\n');

        const removedOriginalLines = new Set<number>();
        let oi = 0, si = 0;
        while (oi < originalLines.length && si < strippedLines.length) {
            if (originalLines[oi] === strippedLines[si]) {
                oi++;
                si++;
            } else {
                removedOriginalLines.add(oi + 1);
                oi++;
            }
        }
        while (oi < originalLines.length) {
            removedOriginalLines.add(oi + 1);
            oi++;
        }

        const lineMapping = new Map<number, number>();
        let strippedLineNum = 1;
        for (let origLine = 1; origLine <= originalLines.length; origLine++) {
            if (!removedOriginalLines.has(origLine)) {
                lineMapping.set(origLine, strippedLineNum);
                strippedLineNum++;
            }
        }

        const filteredAddedLines: number[] = [];
        for (const lineNum of addedLines) {
            const mappedLine = lineMapping.get(lineNum);
            if (mappedLine !== undefined) {
                filteredAddedLines.push(mappedLine);
            }
        }

        return super.calculateDiffMetrics(
            { path: file.path, content: strippedContent },
            filteredAddedLines,
            removedLines,
            status
        );
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
