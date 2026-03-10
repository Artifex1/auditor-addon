import { FileContent, SupportedLanguage, GraphNode, GraphEdge, Visibility } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class JavaAdapter extends BaseAdapter {
    private static readonly QUERIES = {
        CLASSES: `(class_declaration) @class`,
        METHODS: `
            (method_declaration) @method
            (constructor_declaration) @method
        `,
        // method_invocation: name field is (identifier)
        METHOD_CALL: `(method_invocation name: (identifier) @FUNC)`
    } as const;

    private symbolsByClass: Map<string, GraphNode[]> = new Map();

    constructor() {
        super({
            languageId: SupportedLanguage.Java,
            queries: {
                comments: `
                    (line_comment) @comment
                    (block_comment) @comment
                `,
                functions: `
                    (method_declaration) @function
                    (constructor_declaration) @function
                `,
                branching: `
                    (if_statement) @branch
                    (for_statement) @branch
                    (while_statement) @branch
                    (do_statement) @branch
                    (catch_clause) @branch
                    (switch_expression) @branch
                    (ternary_expression) @branch
                `,
                normalization: `
                    (method_invocation) @norm
                    (method_declaration) @norm
                    (array_initializer) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 250,
                //  Java tends to be verbose but structurally simpler than C++/Rust.
                //  We expect slightly lower CC density before considering it "complex."
                complexityMidpoint: 13,
                //  Once Java control flow gets significantly more tangled than normal
                //  business logic, we ramp penalties a bit faster.
                complexitySteepness: 9,
                //  Deep OO / branching can add up to ~90% extra review time, while
                //  simple Java can give ~25% speedup at best.
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.9,
                //  Many Java codebases rely on readable code plus moderate Javadoc.
                //  Around 25% comments unlocks most of the doc benefit (up to ~25%).
                commentFullBenefitDensity: 25,
                commentBenefitCap: 0.25
            }
        });
    }

    protected override resetState(): void {
        super.resetState();
        this.symbolsByClass.clear();
    }

    protected override indexSymbol(node: GraphNode): void {
        super.indexSymbol(node);
        if (node.contract) {
            const classNodes = this.symbolsByClass.get(node.contract) ?? [];
            classNodes.push(node);
            this.symbolsByClass.set(node.contract, classNodes);
        }
    }

    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Java);
        const parser = await service.createParser(SupportedLanguage.Java);
        const classQuery = new Query(lang, JavaAdapter.QUERIES.CLASSES);
        const methodQuery = new Query(lang, JavaAdapter.QUERIES.METHODS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const classCaptures = classQuery.captures(tree.rootNode);

            for (const capture of classCaptures) {
                const classNode = capture.node;
                const className = classNode.childForFieldName('name')?.text
                    ?? classNode.children.find(c => c.type === 'identifier')?.text
                    ?? 'unknown';

                const bodyNode = classNode.childForFieldName('body');
                if (!bodyNode) continue;

                const methodCaptures = methodQuery.captures(bodyNode);
                for (const mCapture of methodCaptures) {
                    const methodNode = mCapture.node;
                    // Only direct methods of this class (not nested classes)
                    if (this.isInsideNestedClass(methodNode, bodyNode)) continue;

                    const node = this.createMethodNode(methodNode, file.path, className);
                    if (node) this.indexSymbol(node);
                }
            }
        }
    }

    private createMethodNode(node: Node, file: string, className: string): GraphNode | undefined {
        // method_declaration: modifiers? type name formal_parameters body
        // constructor_declaration: modifiers? name formal_parameters body
        const nameNode = node.childForFieldName('name')
            ?? node.children.find(c => c.type === 'identifier');
        if (!nameNode) return undefined;

        const fnName = nameNode.text;
        const visibility = this.extractVisibility(node);
        const id = `${className}.${fnName}`;

        return {
            id,
            label: fnName,
            file,
            contract: className,
            visibility,
            range: {
                start: { line: node.startPosition.row + 1, column: node.startPosition.column },
                end: { line: node.endPosition.row + 1, column: node.endPosition.column }
            },
            text: node.text
        };
    }

    private extractVisibility(node: Node): Visibility {
        const modifiers = node.childForFieldName('modifiers')
            ?? node.children.find(c => c.type === 'modifiers');
        if (!modifiers) return 'internal'; // package-private

        const text = modifiers.text;
        if (text.includes('public')) return 'public';
        if (text.includes('private')) return 'private';
        if (text.includes('protected')) return 'internal';
        return 'internal'; // package-private
    }

    private isInsideNestedClass(node: Node, bodyNode: Node): boolean {
        // Check if this method belongs to a nested class within the body
        let current = node.parent;
        while (current && current.id !== bodyNode.id) {
            if (current.type === 'class_body') return true;
            current = current.parent;
        }
        return false;
    }

    protected override async identifyCalls(edges: GraphEdge[], files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Java);
        const parser = await service.createParser(SupportedLanguage.Java);
        const classQuery = new Query(lang, JavaAdapter.QUERIES.CLASSES);
        const methodQuery = new Query(lang, JavaAdapter.QUERIES.METHODS);
        const callQuery = new Query(lang, JavaAdapter.QUERIES.METHOD_CALL);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const classCaptures = classQuery.captures(tree.rootNode);
            for (const capture of classCaptures) {
                const classNode = capture.node;
                const bodyNode = classNode.childForFieldName('body');
                if (!bodyNode) continue;

                const methodCaptures = methodQuery.captures(bodyNode);
                for (const mCapture of methodCaptures) {
                    const methodNode = mCapture.node;
                    if (this.isInsideNestedClass(methodNode, bodyNode)) continue;

                    const symbol = this.findSymbolAtNode(methodNode, file.path);
                    if (!symbol) continue;

                    const callCaptures = callQuery.captures(methodNode);
                    for (const callCapture of callCaptures) {
                        if (callCapture.name !== 'FUNC') continue;
                        const calleeName = callCapture.node.text;
                        const callee = this.resolveCall(calleeName, symbol);
                        if (callee && callee.id !== symbol.id) {
                            this.addEdge(edges, symbol.id, callee.id);
                        }
                    }
                }
            }
        }
    }

    private resolveCall(name: string, caller: GraphNode): GraphNode | undefined {
        // 1. Same class methods first
        if (caller.contract) {
            const classNodes = this.symbolsByClass.get(caller.contract);
            const match = classNodes?.find(n => n.label === name);
            if (match) return match;
        }
        // 2. Any method with that name
        return this.symbolsByLabel.get(name)?.[0];
    }
}
