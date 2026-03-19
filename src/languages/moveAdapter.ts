import { FileContent, SupportedLanguage, GraphNode, GraphEdge, Visibility, FileMetrics, DiffFileMetrics } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class MoveAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        MODULES: `(module) @module`,
        FUNCTIONS: `(function_decl) @function`,
        CALLS: `(call_expr) @call`,
        TEST_ATTR: `
            (attributes
                (attribute
                    (identifier) @attr-name
                    (#eq? @attr-name "test")
                )
            ) @test-attrs
        `,
        TEST_ONLY_ATTR: `
            (attributes
                (attribute
                    (identifier) @attr-name
                    (#eq? @attr-name "test_only")
                )
            ) @test-only-attrs
        `
    } as const;

    private symbolsByModule: Map<string, GraphNode[]> = new Map();

    constructor() {
        super({
            languageId: SupportedLanguage.Move,
            queries: {
                comments: `
                    (line_comment) @comment
                    (block_comment) @comment
                `,
                functions: '(function_decl) @function',
                branching: `
                    (if_expr) @branch
                    (while_expr) @branch
                    (loop_expr) @branch
                    (for_loop_expr) @branch
                    (match_expr) @branch
                    (abort_expr) @branch
                `,
                normalization: `
                    (call_expr) @norm
                    (function_decl) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 200,
                complexityMidpoint: 12,
                complexitySteepness: 8,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 1.0,
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.3
            }
        });
    }

    protected override resetState(): void {
        super.resetState();
        this.symbolsByModule.clear();
    }

    protected override indexSymbol(node: GraphNode): void {
        super.indexSymbol(node);
        if (node.contract) {
            const moduleNodes = this.symbolsByModule.get(node.contract) ?? [];
            moduleNodes.push(node);
            this.symbolsByModule.set(node.contract, moduleNodes);
        }
    }

    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Move);
        const parser = await service.createParser(SupportedLanguage.Move);

        const moduleQuery = new Query(lang, MoveAdapter.QUERIES.MODULES);
        const functionQuery = new Query(lang, MoveAdapter.QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const moduleCaptures = moduleQuery.captures(tree.rootNode);

            // 1. Functions inside module definitions
            for (const capture of moduleCaptures) {
                const moduleNode = capture.node;
                const moduleName = this.extractModuleName(moduleNode);

                // Functions are wrapped in (declaration) children of the module
                for (const child of moduleNode.children) {
                    if (child.type !== 'declaration') continue;
                    const funcDecl = child.children.find(c => c.type === 'function_decl');
                    if (!funcDecl) continue;
                    const visibility = this.extractVisibilityFromDecl(child);
                    this.indexSymbol(this.createFunctionNode(funcDecl, file.path, moduleName, visibility));
                }
            }

            // 2. Free functions not inside any module
            const allFuncCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of allFuncCaptures) {
                const funcNode = capture.node;
                const isInModule = moduleCaptures.some(c =>
                    funcNode.startIndex >= c.node.startIndex &&
                    funcNode.endIndex <= c.node.endIndex
                );
                if (!isInModule) {
                    const visibility = this.extractVisibilityFromDecl(funcNode.parent ?? null);
                    this.indexSymbol(this.createFunctionNode(funcNode, file.path, undefined, visibility));
                }
            }
        }
    }

    /**
     * Move module syntax: module 0xADDR::name { ... }
     * The last (identifier) child before '{' is the module name.
     */
    private extractModuleName(moduleNode: Node): string {
        const identifiers: string[] = [];
        for (const child of moduleNode.children) {
            if (child.type === 'identifier') identifiers.push(child.text);
        }
        return identifiers[identifiers.length - 1] ?? 'unknown';
    }

    /**
     * Visibility lives in (module_member_modifier) child of (declaration),
     * not inside (function_decl) itself.
     * public entry fun → 'external'
     * public(friend) fun → 'internal'
     * public fun → 'public'
     * fun → 'private'
     */
    private extractVisibilityFromDecl(declNode: Node | null): Visibility {
        if (!declNode) return 'private';
        // entry keyword takes priority
        if (/\bentry\b/.test(declNode.text)) return 'external';
        const modifier = declNode.children.find(c => c.type === 'module_member_modifier');
        if (modifier) {
            const visNode = modifier.children.find(c => c.type === 'visibility');
            if (visNode) {
                if (visNode.text.includes('friend')) return 'internal';
                return 'public';
            }
        }
        return 'private';
    }

    private createFunctionNode(
        node: Node,
        file: string,
        module?: string,
        visibility: Visibility = 'private'
    ): GraphNode {
        // function_decl → first (identifier) child = function name
        const nameNode = node.children.find(c => c.type === 'identifier');
        const fnName = nameNode?.text ?? 'unknown';
        const id = module ? `${module}::${fnName}` : fnName;

        return {
            id,
            label: fnName,
            file,
            contract: module,
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
        const lang = await service.getLanguage(SupportedLanguage.Move);
        const parser = await service.createParser(SupportedLanguage.Move);

        const functionQuery = new Query(lang, MoveAdapter.QUERIES.FUNCTIONS);
        const callQuery = new Query(lang, MoveAdapter.QUERIES.CALLS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const functionNode = capture.node;
                const symbol = this.findSymbolAtNode(functionNode, file.path);
                if (!symbol) continue;

                const callCaptures = callQuery.captures(functionNode);
                for (const callCapture of callCaptures) {
                    const callee = this.resolveCallNode(callCapture.node, symbol);
                    if (callee && callee.id !== symbol.id) {
                        this.addEdge(edges, symbol.id, callee.id);
                    }
                }
            }
        }
    }

    private resolveCallNode(callNode: Node, caller: GraphNode): GraphNode | undefined {
        // call_expr → name_access_chain → (identifier (:: identifier)*)
        const nameChain = callNode.children.find(c => c.type === 'name_access_chain');
        if (!nameChain) return undefined;

        const identifiers = nameChain.children
            .filter(c => c.type === 'identifier')
            .map(c => c.text);

        if (identifiers.length === 0) return undefined;

        const funcName = identifiers[identifiers.length - 1];
        // Second-to-last identifier is the module name for qualified calls
        const moduleName = identifiers.length >= 2 ? identifiers[identifiers.length - 2] : null;

        if (moduleName) {
            const moduleFuncs = this.symbolsByModule.get(moduleName);
            const match = moduleFuncs?.find(n => n.label === funcName);
            if (match) return match;
        }

        // Same-module lookup
        if (caller.contract) {
            const moduleFuncs = this.symbolsByModule.get(caller.contract);
            const match = moduleFuncs?.find(n => n.label === funcName);
            if (match) return match;
        }

        const free = this.symbolsByLabel.get(funcName)?.find(n => !n.contract);
        if (free) return free;

        return this.symbolsByLabel.get(funcName)?.[0];
    }

    /**
     * Strips test code from Move source content.
     * Removes: #[test_only] modules, #[test_only] declarations,
     * and #[test] function declarations.
     */
    async stripTestCode(content: string): Promise<string> {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Move);
        const parser = await service.createParser(SupportedLanguage.Move);

        const tree = parser.parse(content);
        if (!tree) return content;

        const rangesToRemove: Array<{ start: number; end: number }> = [];

        // Build sets of matching attributes nodes
        const testAttrQuery = new Query(lang, MoveAdapter.QUERIES.TEST_ATTR);
        const testAttrs = new Set(
            testAttrQuery.matches(tree.rootNode)
                .map(m => m.captures.find(c => c.name === 'test-attrs')!.node.id)
        );

        const testOnlyAttrQuery = new Query(lang, MoveAdapter.QUERIES.TEST_ONLY_ATTR);
        const testOnlyAttrs = new Set(
            testOnlyAttrQuery.matches(tree.rootNode)
                .map(m => m.captures.find(c => c.name === 'test-only-attrs')!.node.id)
        );

        // 1. Find #[test_only] modules (attributes is a sibling preceding the module)
        for (const child of tree.rootNode.children) {
            if (child.type === 'module') {
                const prev = child.previousNamedSibling;
                if (prev && prev.type === 'attributes' && testOnlyAttrs.has(prev.id)) {
                    rangesToRemove.push({
                        start: prev.startIndex,
                        end: child.endIndex
                    });
                }
            }
        }

        // 2. Find #[test] and #[test_only] declarations inside modules
        const moduleQuery = new Query(lang, '(module) @module');
        const moduleCaptures = moduleQuery.captures(tree.rootNode);

        for (const capture of moduleCaptures) {
            const moduleNode = capture.node;
            // Skip modules already being removed
            const moduleRemoved = rangesToRemove.some(
                r => moduleNode.startIndex >= r.start && moduleNode.endIndex <= r.end
            );
            if (moduleRemoved) continue;

            for (const child of moduleNode.children) {
                if (child.type !== 'declaration') continue;

                const attrs = child.children.find(c => c.type === 'attributes');
                if (!attrs) continue;

                if (testAttrs.has(attrs.id) || testOnlyAttrs.has(attrs.id)) {
                    rangesToRemove.push({
                        start: child.startIndex,
                        end: child.endIndex
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
