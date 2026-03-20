import path from "path";
import {
    FileContent, SupportedLanguage, SymbolEntry, Visibility,
    SymbolMap, CallTargetKind
} from "../engine/types.js";
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
                const entry = this.createFunctionNode(capture.node, file.path);
                this.indexSymbol(entry);
            }
        }
    }

    private createFunctionNode(node: Node, file: string): SymbolEntry {
        // Compact cdefn has a (function_name) child for the function name
        const nameNode = node.childForFieldName('name') ||
            node.children.find(c => c.type === 'function_name' || c.type === 'identifier');
        const fnName = nameNode?.text ?? 'unknown';

        const visibility = this.extractVisibility(node);

        return this.createEntry({
            qualifiedName: fnName,
            label: fnName,
            file,
            node,
            visibility,
        });
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

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'cdefn';
    }

    override getFunctionName(node: Node): string | null {
        if (node.type === 'cdefn') {
            const nameNode = node.childForFieldName('name') ||
                node.children.find(c => c.type === 'function_name' || c.type === 'identifier');
            return nameNode?.text ?? null;
        }
        return null;
    }

    override isPublicFn(node: Node): boolean {
        return this.extractVisibility(node) === 'public';
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_statement' || node.type === 'return_expr';
    }

    override isStateWrite(node: Node): boolean {
        return node.type === 'assignment' || node.type === 'assignment_expression';
    }

    override isStateRead(node: Node): boolean {
        if (node.type === 'identifier') {
            const parent = node.parent;
            if (parent?.type === 'assignment' || parent?.type === 'assignment_expression') {
                if (parent.children[0]?.id === node.id) return false;
            }
            return true;
        }
        return false;
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'function_call_term') return null;
        return this.extractCalleeName(node) ?? null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment' && node.type !== 'assignment_expression') return null;
        return node.children[0]?.text ?? null;
    }

    override resolveCallee(
        node: Node,
        symbolMap: SymbolMap,
        _sourceFiles: Map<string, string>
    ): { qualifiedName: string; targetKind: CallTargetKind } | null {
        const target = this.getCallTarget(node);
        if (!target) return null;
        for (const [qn, entry] of symbolMap) {
            if (entry.label === target) {
                return { qualifiedName: qn, targetKind: 'internal' };
            }
        }
        return null;
    }

    protected override async identifyCalls(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Compact);
        const parser = await service.createParser(SupportedLanguage.Compact);

        const functionQuery = new Query(lang, CompactAdapter.QUERIES.FUNCTIONS);
        const callQuery = new Query(lang, CompactAdapter.QUERIES.CALLS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // Build prefix→absolutePath map from this file's import declarations
            const prefixMap = this.parseImportPrefixes(tree.rootNode, file.path);

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

                    // First: direct label match (same-file or already-qualified)
                    let callee = this.symbolsByLabel.get(calleeName)?.[0];

                    // Second: prefix-based cross-module resolution
                    // e.g. "Initializable_initialize" → prefix "Initializable_" → func "initialize"
                    if (!callee && prefixMap.size > 0) {
                        for (const [prefix, modulePath] of prefixMap) {
                            if (calleeName.startsWith(prefix)) {
                                const funcName = calleeName.slice(prefix.length);
                                const candidates = this.symbolsByLabel.get(funcName) ?? [];
                                callee = candidates.find(s => path.resolve(s.file) === modulePath);
                                if (callee) break;
                            }
                        }
                    }

                    if (callee && callee.qualifiedName !== symbol.qualifiedName) {
                        this.addCallee(symbol.qualifiedName, this.makeCallee(callee.qualifiedName));
                    } else if (!callee) {
                        this.addCallee(symbol.qualifiedName, this.makeCallee(calleeName, 'external_unknown'));
                    }
                }
            }
        }
    }

    // Parse `import "path" prefix Prefix_` declarations from the AST.
    // Returns Map<prefix, absoluteFilePath> for cross-module call resolution.
    private parseImportPrefixes(root: Node, sourceFile: string): Map<string, string> {
        const prefixMap = new Map<string, string>();
        const sourceDir = path.dirname(sourceFile);

        const walk = (node: Node) => {
            if (node.type === 'idecl') {
                const importNameNode = node.childForFieldName('id');
                const prefixField = node.childForFieldName('prefix');
                if (importNameNode && prefixField) {
                    // File imports have quoted text; stdlib (e.g. CompactStandardLibrary) is unquoted
                    const text = importNameNode.text;
                    if (text.startsWith('"')) {
                        const importPath = text.slice(1, -1); // strip quotes
                        const prefixId = prefixField.childForFieldName('id');
                        if (prefixId) {
                            const absPath = path.resolve(sourceDir, importPath + '.compact');
                            prefixMap.set(prefixId.text, absPath);
                        }
                    }
                }
            }
            for (const child of node.children) {
                walk(child);
            }
        };
        walk(root);
        return prefixMap;
    }

    private static readonly BUILTINS = new Set([
        // Compact/Midnight built-in functions and operations
        'assert', 'require',
        // Cryptographic primitives
        'hash', 'merkle_root', 'pad', 'sign', 'verify',
        'persistent_hash', 'transient_hash',
        // ZK / circuit operations
        'witness', 'reveal', 'disclose', 'const_check',
        'zswap', 'ledger',
        // Type constructors / conversions
        'Uint', 'Bool', 'Bytes', 'Field', 'Vector', 'Maybe', 'Some', 'None',
        // Standard operations
        'length', 'append', 'slice', 'map', 'fold', 'zip',
        'default', 'init', 'set', 'get',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        return CompactAdapter.BUILTINS.has(name);
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
