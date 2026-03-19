import { FileContent, SupportedLanguage, GraphNode, GraphEdge, Visibility, FileMetrics, DiffFileMetrics } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class CairoAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        IMPL_BLOCKS: `(impl_item) @impl`,
        FUNCTIONS: `
            (function_item) @function
            (external_function_item) @function
        `,
        // Cairo: call_expression has a 'function' field containing identifier or scoped_identifier
        SIMPLE_CALL: `(call_expression function: (identifier) @FUNC)`,
        SCOPED_CALL: `(call_expression (scoped_identifier) @FUNC)`,
        // Method calls: self.method() → field_expression with field_identifier
        METHOD_CALL: `(call_expression (field_expression (field_identifier) @FUNC))`,
        TEST_ATTR: `
            (attribute_item
                (attribute
                    (identifier) @attr-name
                    (#eq? @attr-name "test")
                )
            ) @test-attr
        `,
        CFG_TEST_ATTR: `
            (attribute_item
                (attribute
                    (identifier) @outer
                    arguments: (token_tree
                        (identifier) @inner
                    )
                    (#eq? @outer "cfg")
                    (#eq? @inner "test")
                )
            ) @cfg-test-attr
        `
    } as const;

    private symbolsByContainer: Map<string, GraphNode[]> = new Map();

    constructor() {
        super({
            languageId: SupportedLanguage.Cairo,
            queries: {
                comments: '(line_comment) @comment',
                functions: `
                    (function_item) @function
                    (function_signature_item) @function
                    (external_function_item) @function
                `,
                branching: `
                    (if_expression) @branch
                    (loop_expression) @branch
                    (while_expression) @branch
                    (for_expression) @branch
                    (match_expression) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_item) @norm
                    (function_signature_item) @norm
                    (external_function_item) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 200,
                complexityMidpoint: 12,
                complexitySteepness: 8,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 1.2,
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.3
            }
        });
    }

    protected override resetState(): void {
        super.resetState();
        this.symbolsByContainer.clear();
    }

    protected override indexSymbol(node: GraphNode): void {
        super.indexSymbol(node);
        if (node.contract) {
            const containerNodes = this.symbolsByContainer.get(node.contract) ?? [];
            containerNodes.push(node);
            this.symbolsByContainer.set(node.contract, containerNodes);
        }
    }

    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Cairo);
        const parser = await service.createParser(SupportedLanguage.Cairo);

        const implQuery = new Query(lang, CairoAdapter.QUERIES.IMPL_BLOCKS);
        const functionQuery = new Query(lang, CairoAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // 1. Find all impl blocks and index their functions
            const implCaptures = implQuery.captures(tree.rootNode);
            for (const capture of implCaptures) {
                const implNode = capture.node;
                const containerName = this.extractImplName(implNode);

                // Body is in declaration_list (Cairo grammar specific)
                const bodyNode = implNode.children.find(c =>
                    c.type === 'declaration_list' || c.type === 'body'
                );
                if (!bodyNode) continue;

                const funcCaptures = functionQuery.captures(bodyNode);
                for (const funcCapture of funcCaptures) {
                    if (this.isNestedFunction(funcCapture.node, bodyNode)) continue;
                    const node = this.createFunctionNode(funcCapture.node, file.path, containerName);
                    this.indexSymbol(node);
                }
            }

            // 2. Find free functions (not inside impl blocks)
            const allFuncCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of allFuncCaptures) {
                const funcNode = capture.node;
                const isInImpl = implCaptures.some(c => {
                    const body = c.node.children.find(ch =>
                        ch.type === 'declaration_list' || ch.type === 'body'
                    );
                    return body &&
                        funcNode.startIndex >= body.startIndex &&
                        funcNode.endIndex <= body.endIndex;
                });

                if (!isInImpl) {
                    this.indexSymbol(this.createFunctionNode(funcNode, file.path));
                }
            }
        }
    }

    /**
     * Extracts the impl block name from an impl_item node.
     * Cairo syntax: impl FooImpl of FooTrait { ... }
     * The first identifier is the impl name.
     */
    private extractImplName(implNode: Node): string {
        // First identifier child = impl name (e.g., "FooImpl")
        const nameNode = implNode.children.find(c => c.type === 'identifier');
        return nameNode?.text ?? 'unknown';
    }

    private isNestedFunction(funcNode: Node, containerBody: Node): boolean {
        let current = funcNode.parent;
        while (current && current.id !== containerBody.id) {
            if (current.type === 'function_item' || current.type === 'external_function_item') return true;
            current = current.parent;
        }
        return false;
    }

    /**
     * Extracts the function name from a function_item node.
     * Cairo grammar: function_item → function child → identifier
     */
    private extractFunctionName(node: Node): string {
        // Cairo: function_item has a 'function' child (signature node) containing the identifier
        const funcChild = node.children.find(c => c.type === 'function');
        if (funcChild) {
            const nameNode = funcChild.children.find(c => c.type === 'identifier');
            if (nameNode) return nameNode.text;
        }
        // Fallback: try direct identifier child or name field
        return node.childForFieldName('name')?.text ??
            node.children.find(c => c.type === 'identifier')?.text ??
            'unknown';
    }

    private createFunctionNode(node: Node, file: string, container?: string): GraphNode {
        const fnName = this.extractFunctionName(node);
        const visibility = this.extractVisibility(node);
        const id = container ? `${container}::${fnName}` : fnName;

        return {
            id,
            label: fnName,
            file,
            contract: container,
            visibility,
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column }
            },
            text: node.text
        };
    }

    private extractVisibility(node: Node): Visibility {
        // Check for pub modifier in children
        for (const child of node.children) {
            if (child.type === 'visibility_modifier') return 'public';
            if (child.text === 'pub') return 'public';
        }
        // Check function signature child for pub
        const funcChild = node.children.find(c => c.type === 'function');
        if (funcChild) {
            for (const child of funcChild.children) {
                if (child.type === 'visibility_modifier') return 'public';
                if (child.text === 'pub') return 'public';
            }
        }
        if (node.type === 'external_function_item') return 'external';
        return 'private';
    }

    protected override async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Cairo);
        const parser = await service.createParser(SupportedLanguage.Cairo);

        const functionQuery = new Query(lang, CairoAdapter.QUERIES.FUNCTIONS);
        const simpleCallQuery = new Query(lang, CairoAdapter.QUERIES.SIMPLE_CALL);
        const scopedCallQuery = new Query(lang, CairoAdapter.QUERIES.SCOPED_CALL);

        let methodCallQuery: Query | null = null;
        try {
            methodCallQuery = new Query(lang, CairoAdapter.QUERIES.METHOD_CALL);
        } catch {
            // Method call query not supported in this grammar version
        }

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const functionNode = capture.node;
                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                this.processCallQuery(simpleCallQuery, functionNode, symbol, edges, 'simple');
                this.processCallQuery(scopedCallQuery, functionNode, symbol, edges, 'scoped');
                if (methodCallQuery) {
                    this.processCallQuery(methodCallQuery, functionNode, symbol, edges, 'method');
                }
            }
        }
    }

    private processCallQuery(
        query: Query,
        functionNode: Node,
        caller: GraphNode,
        edges: GraphEdge[],
        callType: 'simple' | 'scoped' | 'method'
    ) {
        const captures = query.captures(functionNode);
        for (const capture of captures) {
            if (capture.name !== 'FUNC') continue;

            const callText = capture.node.text;
            const callee = this.resolveCall(callText, callType, caller);
            if (callee && callee.id !== caller.id) {
                this.addEdge(edges, caller.id, callee.id);
            }
        }
    }

    private resolveCall(callText: string, callType: 'simple' | 'scoped' | 'method', caller: GraphNode): GraphNode | undefined {
        if (callType === 'scoped') {
            // "module::func" → extract func name
            const parts = callText.split('::');
            const funcName = parts[parts.length - 1];
            const containerName = parts.slice(0, -1).join('::');

            const containerFuncs = this.symbolsByContainer.get(containerName);
            const match = containerFuncs?.find(n => n.label === funcName);
            if (match) return match;

            return this.symbolsByLabel.get(funcName)?.[0];
        }

        // simple or method call
        if (caller.contract) {
            const containerFuncs = this.symbolsByContainer.get(caller.contract);
            const match = containerFuncs?.find(n => n.label === callText);
            if (match) return match;
        }

        const freeFuncs = this.symbolsByLabel.get(callText);
        const free = freeFuncs?.find(n => !n.contract);
        if (free) return free;

        return this.symbolsByLabel.get(callText)?.[0];
    }

    /**
     * Strips test code from Cairo source content.
     * Removes: #[cfg(test)] module blocks and standalone #[test] functions.
     * Cairo's test syntax mirrors Rust exactly.
     */
    async stripTestCode(content: string): Promise<string> {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Cairo);
        const parser = await service.createParser(SupportedLanguage.Cairo);

        const tree = parser.parse(content);
        if (!tree) return content;

        const rangesToRemove: Array<{ start: number; end: number }> = [];

        const cfgTestQuery = new Query(lang, CairoAdapter.QUERIES.CFG_TEST_ATTR);
        const cfgTestAttrs = new Set(
            cfgTestQuery.matches(tree.rootNode)
                .map(m => m.captures.find(c => c.name === 'cfg-test-attr')!.node.id)
        );

        const testAttrQuery = new Query(lang, CairoAdapter.QUERIES.TEST_ATTR);
        const testAttrs = new Set(
            testAttrQuery.matches(tree.rootNode)
                .map(m => m.captures.find(c => c.name === 'test-attr')!.node.id)
        );

        // 1. Find #[cfg(test)] mod blocks
        const modQuery = new Query(lang, '(mod_item) @mod');
        const modCaptures = modQuery.captures(tree.rootNode);

        for (const capture of modCaptures) {
            if (this.hasAttributeFromSet(capture.node, cfgTestAttrs)) {
                const attrStart = this.getAttributeStart(capture.node);
                rangesToRemove.push({
                    start: attrStart,
                    end: capture.node.endIndex
                });
            }
        }

        // 2. Find standalone #[test] functions
        const fnQuery = new Query(lang, '(function_item) @fn');
        const fnCaptures = fnQuery.captures(tree.rootNode);

        for (const capture of fnCaptures) {
            if (this.hasAttributeFromSet(capture.node, testAttrs)) {
                const alreadyCovered = rangesToRemove.some(
                    r => capture.node.startIndex >= r.start && capture.node.endIndex <= r.end
                );
                if (!alreadyCovered) {
                    const attrStart = this.getAttributeStart(capture.node);
                    rangesToRemove.push({
                        start: attrStart,
                        end: capture.node.endIndex
                    });
                }
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

    private hasAttributeFromSet(node: Node, attrIds: Set<number>): boolean {
        // Cairo: attributes are sibling attribute_item nodes preceding the item
        let prev = node.previousNamedSibling;
        while (prev && prev.type === 'attribute_item') {
            if (attrIds.has(prev.id)) return true;
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

}
