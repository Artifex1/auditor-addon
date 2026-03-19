import { FileContent, SupportedLanguage, GraphNode, GraphEdge, Visibility, FileMetrics, DiffFileMetrics } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class RustAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        IMPL_BLOCKS: `
            (impl_item) @impl
        `,
        FUNCTIONS: `
            (function_item) @function
        `,
        SIMPLE_CALL: `
            (call_expression function: (identifier) @FUNC)
        `,
        METHOD_CALL: `
            (call_expression function: (field_expression field: (field_identifier) @FUNC))
        `,
        SCOPED_CALL: `
            (call_expression function: (scoped_identifier) @FUNC)
        `,
        GENERIC_CALL: `
            (call_expression function: (generic_function function: (identifier) @FUNC))
        `,
        GENERIC_SCOPED_CALL: `
            (call_expression function: (generic_function function: (scoped_identifier) @FUNC))
        `,
        TEST_ATTR: `
            (attribute_item
                (attribute
                    (identifier) @attr-name
                    (#eq? @attr-name "test")
                )
            ) @test-attr

            (attribute_item
                (attribute
                    (scoped_identifier
                        name: (identifier) @scoped-name
                        (#eq? @scoped-name "test")
                    )
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
            languageId: SupportedLanguage.Rust,
            queries: {
                comments: `
                    (line_comment) @comment
                    (block_comment) @comment
                `,
                functions: '(function_item) @function',
                branching: `
                    (if_expression) @branch
                    (for_expression) @branch
                    (while_expression) @branch
                    (loop_expression) @branch
                    (match_expression) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_item) @norm
                    (array_expression) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 225,
                complexityMidpoint: 16,
                complexitySteepness: 10,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 1.2,
                commentFullBenefitDensity: 18,
                commentBenefitCap: 0.35
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
        const lang = await service.getLanguage(SupportedLanguage.Rust);
        const parser = await service.createParser(SupportedLanguage.Rust);

        const implQuery = new Query(lang, RustAdapter.QUERIES.IMPL_BLOCKS);
        const functionQuery = new Query(lang, RustAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // 1. Find all impl blocks and their functions
            const implCaptures = implQuery.captures(tree.rootNode);
            for (const capture of implCaptures) {
                const implNode = capture.node;
                const containerName = this.extractImplTypeName(implNode);

                // Find functions inside impl block
                const bodyNode = implNode.childForFieldName('body');
                if (bodyNode) {
                    const funcCaptures = functionQuery.captures(bodyNode);
                    for (const funcCapture of funcCaptures) {
                        if (this.isNestedFunction(funcCapture.node, bodyNode)) continue;
                        const node = this.createFunctionNode(
                            funcCapture.node,
                            file.path,
                            containerName
                        );
                        this.indexSymbol(node);
                    }
                }
            }

            // 2. Find free functions (not inside impl blocks)
            for (const child of tree.rootNode.children) {
                if (child.type === 'function_item') {
                    // Check if this function is inside an impl block
                    const isInImpl = implCaptures.some(c => {
                        const body = c.node.childForFieldName('body');
                        return body &&
                            child.startIndex >= body.startIndex &&
                            child.endIndex <= body.endIndex;
                    });

                    if (!isInImpl) {
                        const node = this.createFunctionNode(child, file.path);
                        this.indexSymbol(node);
                    }
                }

                // 3. Find functions inside mod blocks
                if (child.type === 'mod_item') {
                    await this.processModItem(child, file.path, functionQuery);
                }
            }
        }
    }

    private async processModItem(modNode: Node, filePath: string, functionQuery: Query) {
        const modName = modNode.childForFieldName('name')?.text;
        const bodyNode = modNode.childForFieldName('body');

        if (bodyNode && modName) {
            const funcCaptures = functionQuery.captures(bodyNode);
            for (const funcCapture of funcCaptures) {
                if (this.isNestedFunction(funcCapture.node, bodyNode)) continue;
                const node = this.createFunctionNode(
                    funcCapture.node,
                    filePath,
                    modName
                );
                this.indexSymbol(node);
            }
        }
    }

    private isNestedFunction(funcNode: Node, containerBody: Node): boolean {
        let current = funcNode.parent;
        while (current && current.id !== containerBody.id) {
            if (current.type === 'function_item') return true;
            current = current.parent;
        }
        return false;
    }

    private extractImplTypeName(implNode: Node): string {
        // impl Type { ... } -> "Type"
        // impl Trait for Type { ... } -> "Type"
        const typeNode = implNode.childForFieldName('type');
        if (typeNode) {
            // Handle generic types: extract base name
            if (typeNode.type === 'generic_type') {
                const typeName = typeNode.childForFieldName('type');
                return typeName?.text ?? typeNode.text;
            }
            return typeNode.text;
        }
        return 'unknown';
    }

    private createFunctionNode(
        node: Node,
        file: string,
        container?: string
    ): GraphNode {
        const nameNode = node.childForFieldName('name');
        const fnName = nameNode?.text ?? 'unknown';

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
        for (const child of node.children) {
            if (child.type === 'visibility_modifier') {
                const text = child.text;
                if (text === 'pub') return 'public';
                if (text.startsWith('pub(crate)')) return 'internal';
                if (text.startsWith('pub(super)')) return 'internal';
                if (text.startsWith('pub(in')) return 'internal';
                return 'public';
            }
        }
        return 'private';
    }

    protected override async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Rust);
        const parser = await service.createParser(SupportedLanguage.Rust);

        const functionQuery = new Query(lang, RustAdapter.QUERIES.FUNCTIONS);
        const simpleCallQuery = new Query(lang, RustAdapter.QUERIES.SIMPLE_CALL);
        const methodCallQuery = new Query(lang, RustAdapter.QUERIES.METHOD_CALL);
        const scopedCallQuery = new Query(lang, RustAdapter.QUERIES.SCOPED_CALL);
        const genericCallQuery = new Query(lang, RustAdapter.QUERIES.GENERIC_CALL);
        const genericScopedCallQuery = new Query(lang, RustAdapter.QUERIES.GENERIC_SCOPED_CALL);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);

            for (const capture of funcCaptures) {
                const functionNode = capture.node;
                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                // Process different call types
                await this.processCallQuery(simpleCallQuery, functionNode, symbol, edges, 'simple');
                await this.processCallQuery(methodCallQuery, functionNode, symbol, edges, 'method');
                await this.processCallQuery(scopedCallQuery, functionNode, symbol, edges, 'scoped');
                await this.processCallQuery(genericCallQuery, functionNode, symbol, edges, 'simple');
                await this.processCallQuery(genericScopedCallQuery, functionNode, symbol, edges, 'scoped');
            }
        }
    }

    private async processCallQuery(
        query: Query,
        functionNode: Node,
        caller: GraphNode,
        edges: GraphEdge[],
        callType: 'simple' | 'method' | 'scoped'
    ) {
        const captures = query.captures(functionNode);

        for (const capture of captures) {
            if (capture.name !== 'FUNC') continue;

            const callText = capture.node.text;

            // Skip macro invocations (they end with !)
            if (this.isMacroCall(capture.node)) continue;

            const callee = this.resolveCall(callText, callType, caller);
            if (callee && callee.id !== caller.id) {
                // Avoid duplicate edges
                const exists = edges.some(e => e.from === caller.id && e.to === callee.id);
                if (!exists) {
                    edges.push({
                        from: caller.id,
                        to: callee.id,
                        kind: 'internal'
                    });
                }
            }
        }
    }

    private isMacroCall(node: Node): boolean {
        // Check if the parent is a macro_invocation
        let current = node.parent;
        while (current) {
            if (current.type === 'macro_invocation') return true;
            if (current.type === 'call_expression') return false;
            current = current.parent;
        }
        return false;
    }

    private resolveCall(
        callText: string,
        callType: 'simple' | 'method' | 'scoped',
        caller: GraphNode
    ): GraphNode | undefined {
        if (callType === 'scoped') {
            // Handle qualified calls like Type::method or module::function
            const parts = callText.split('::');
            const funcName = parts[parts.length - 1];
            const containerName = parts.slice(0, -1).join('::');

            // Try to find in the specified container
            const containerFuncs = this.symbolsByContainer.get(containerName);
            const match = containerFuncs?.find(n => n.label === funcName);
            if (match) return match;

            // Fallback to any function with that name
            return this.symbolsByLabel.get(funcName)?.[0];
        }

        if (callType === 'method') {
            // Method calls: self.method() or obj.method()
            // Try to resolve within the same container first
            if (caller.contract) {
                const containerFuncs = this.symbolsByContainer.get(caller.contract);
                const match = containerFuncs?.find(n => n.label === callText);
                if (match) return match;
            }

            // Fallback to any function with that label
            return this.symbolsByLabel.get(callText)?.[0];
        }

        // Simple calls
        // 1. Try same container
        if (caller.contract) {
            const containerFuncs = this.symbolsByContainer.get(caller.contract);
            const match = containerFuncs?.find(n => n.label === callText);
            if (match) return match;
        }

        // 2. Try free functions
        const freeFuncs = this.symbolsByLabel.get(callText);
        const free = freeFuncs?.find(n => !n.contract);
        if (free) return free;

        // 3. Any match
        return this.symbolsByLabel.get(callText)?.[0];
    }

    /**
     * Strips test code from Rust source content.
     * Removes: #[cfg(test)] module blocks, #[test] standalone functions,
     * and their associated attribute lines.
     * Does NOT strip doc-test code blocks inside /// comments.
     */
    async stripTestCode(content: string): Promise<string> {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Rust);
        const parser = await service.createParser(SupportedLanguage.Rust);

        const tree = parser.parse(content);
        if (!tree) return content;

        // Collect byte ranges to remove (startIndex, endIndex)
        const rangesToRemove: Array<{ start: number; end: number }> = [];

        // Build sets of attribute_item nodes matching #[cfg(test)] and #[test]
        const cfgTestQuery = new Query(lang, RustAdapter.QUERIES.CFG_TEST_ATTR);
        const cfgTestAttrs = new Set(
            cfgTestQuery.matches(tree.rootNode)
                .map(m => m.captures.find(c => c.name === 'cfg-test-attr')!.node.id)
        );

        const testAttrQuery = new Query(lang, RustAdapter.QUERIES.TEST_ATTR);
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

        // 2. Find #[test] standalone functions (not already inside a #[cfg(test)] module)
        const fnQuery = new Query(lang, '(function_item) @fn');
        const fnCaptures = fnQuery.captures(tree.rootNode);

        for (const capture of fnCaptures) {
            if (this.hasAttributeFromSet(capture.node, testAttrs)) {
                // Skip if already inside a range being removed
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

        // Sort ranges by start position (descending) to remove from end first
        rangesToRemove.sort((a, b) => b.start - a.start);

        let result = content;
        for (const range of rangesToRemove) {
            // Extend range to include the trailing newline if present
            let end = range.end;
            if (end < result.length && result[end] === '\n') end++;

            result = result.substring(0, range.start) + result.substring(end);
        }

        return result;
    }

    /**
     * Checks whether a node has an associated attribute_item (child or preceding sibling)
     * whose node ID is in the provided set of matched attribute IDs.
     */
    private hasAttributeFromSet(node: Node, attrIds: Set<number>): boolean {
        for (const child of node.children) {
            if (child.type === 'attribute_item' && attrIds.has(child.id)) {
                return true;
            }
        }
        let prev = node.previousNamedSibling;
        while (prev && prev.type === 'attribute_item') {
            if (attrIds.has(prev.id)) return true;
            prev = prev.previousNamedSibling;
        }
        return false;
    }

    private getAttributeStart(node: Node): number {
        // Include preceding attribute lines (e.g., #[cfg(test)], #[test])
        let start = node.startIndex;
        let prev = node.previousNamedSibling;
        while (prev && prev.type === 'attribute_item') {
            start = prev.startIndex;
            prev = prev.previousNamedSibling;
        }
        // Also include attributes that are children of the node itself
        for (const child of node.children) {
            if (child.type === 'attribute_item' && child.startIndex < start) {
                start = child.startIndex;
            }
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

        // Build mapping from original line numbers to stripped line numbers
        // by finding which original lines were removed
        const removedOriginalLines = new Set<number>();
        let oi = 0, si = 0;

        // Use a diff approach: walk both line arrays
        // Lines that exist in original but not in stripped were removed
        while (oi < originalLines.length && si < strippedLines.length) {
            if (originalLines[oi] === strippedLines[si]) {
                oi++;
                si++;
            } else {
                removedOriginalLines.add(oi + 1); // 1-indexed
                oi++;
            }
        }
        // Remaining original lines were all removed
        while (oi < originalLines.length) {
            removedOriginalLines.add(oi + 1);
            oi++;
        }

        // Filter out added lines that fall in stripped test regions
        const filteredAddedLines: number[] = [];
        // Build line number mapping: original -> stripped
        const lineMapping = new Map<number, number>();
        let strippedLineNum = 1;
        for (let origLine = 1; origLine <= originalLines.length; origLine++) {
            if (!removedOriginalLines.has(origLine)) {
                lineMapping.set(origLine, strippedLineNum);
                strippedLineNum++;
            }
        }

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
