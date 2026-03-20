import path from "path";
import {
    FileContent, SupportedLanguage, SymbolEntry, Visibility,
    SymbolMap, CallTargetKind
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


export class MasmAdapter extends BaseAdapter {
    // basename (no extension) → absolute file path, built from corpus files
    private _filesByBasename = new Map<string, string>();

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
        const lang = await service.getLanguage(SupportedLanguage.Masm);
        const parser = await service.createParser(SupportedLanguage.Masm);

        // Build basename → filePath index for cross-module resolution
        for (const file of files) {
            const basename = path.basename(file.path, '.masm');
            this._filesByBasename.set(basename, file.path);
        }

        const procQuery = new Query(lang, MasmAdapter.QUERIES.PROCEDURES);
        const entryQuery = new Query(lang, MasmAdapter.QUERIES.ENTRY);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // Index procedures
            const procCaptures = procQuery.captures(tree.rootNode);
            for (const capture of procCaptures) {
                const entry = this.createProcedureNode(capture.node, file.path);
                this.indexSymbol(entry);
            }

            // Index entrypoints
            const entryCaptures = entryQuery.captures(tree.rootNode);
            for (const capture of entryCaptures) {
                const entry = this.createEntrypointNode(capture.node, file.path);
                this.indexSymbol(entry);
            }
        }
    }

    private createProcedureNode(node: Node, file: string): SymbolEntry {
        const nameNode = node.childForFieldName('name') ||
            node.children.find(c => c.type === 'identifier' || c.type === 'proc_name');
        const fnName = nameNode?.text ?? 'unknown';

        // Check if it's an exported procedure
        const isExported = node.text.trimStart().startsWith('export');
        const visibility: Visibility = isExported ? 'public' : 'private';

        return this.createEntry({
            qualifiedName: fnName,
            label: fnName,
            file,
            node,
            visibility,
        });
    }

    private createEntrypointNode(node: Node, file: string): SymbolEntry {
        return this.createEntry({
            qualifiedName: 'begin',
            label: 'begin',
            file,
            node,
            visibility: 'external',
        });
    }

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'procedure' || node.type === 'entrypoint';
    }

    override getFunctionName(node: Node): string | null {
        if (node.type === 'procedure') {
            const nameNode = node.childForFieldName('name') ||
                node.children.find(c => c.type === 'identifier' || c.type === 'proc_name');
            return nameNode?.text ?? null;
        }
        if (node.type === 'entrypoint') return 'begin';
        return null;
    }

    override isPublicFn(node: Node): boolean {
        if (node.type === 'entrypoint') return true;
        if (node.type === 'procedure') {
            return node.text.trimStart().startsWith('export');
        }
        return false;
    }

    override isExternalCall(node: Node): boolean {
        // MASM: syscall instructions
        if (node.type !== 'invoke') return false;
        const text = node.text.trim();
        return text.startsWith('syscall');
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'end' || node.text.trim() === 'end';
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'invoke') return null;
        return this.extractCalleeName(node) ?? null;
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
        if (this.isExternalCall(node)) {
            return { qualifiedName: target, targetKind: 'external_unknown' };
        }
        return null;
    }

    protected override async identifyCalls(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(SupportedLanguage.Masm);
        const parser = await service.createParser(SupportedLanguage.Masm);

        const procQuery = new Query(lang, MasmAdapter.QUERIES.PROCEDURES);
        const entryQuery = new Query(lang, MasmAdapter.QUERIES.ENTRY);
        const callQuery = new Query(lang, MasmAdapter.QUERIES.CALLS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // Parse `use module::path` declarations for cross-module resolution
            const moduleAliases = this.parseModuleAliases(file.content);

            // Process procedures
            const procCaptures = procQuery.captures(tree.rootNode);
            for (const capture of procCaptures) {
                const procNode = capture.node;
                const symbol = this.findSymbolAtNode(procNode, file.path);
                if (!symbol) continue;

                this.processCallsInNode(procNode, symbol, callQuery, moduleAliases);
            }

            // Process entrypoints
            const entryCaptures = entryQuery.captures(tree.rootNode);
            for (const capture of entryCaptures) {
                const entryNode = capture.node;
                const symbol = this.findSymbolAtNode(entryNode, file.path);
                if (!symbol) continue;

                this.processCallsInNode(entryNode, symbol, callQuery, moduleAliases);
            }
        }
    }

    // Parse `use module::path` and `use module::path -> alias` declarations.
    // Returns Map<alias, filePath> using the corpus basename index.
    private parseModuleAliases(content: string): Map<string, string> {
        const aliasMap = new Map<string, string>();
        // Matches: use path::to::module  or  use path::to::module -> alias
        const useRe = /^use\s+([\w:]+)(?:\s*->\s*(\w+))?/gm;
        let m: RegExpExecArray | null;
        while ((m = useRe.exec(content)) !== null) {
            const modulePath = m[1];
            const segments = modulePath.split('::');
            const defaultAlias = segments[segments.length - 1];
            const alias = m[2] ?? defaultAlias;
            const filePath = this._filesByBasename.get(defaultAlias);
            if (filePath) aliasMap.set(alias, filePath);
        }
        return aliasMap;
    }

    private processCallsInNode(
        node: Node,
        caller: SymbolEntry,
        callQuery: Query,
        moduleAliases: Map<string, string>
    ) {
        const callCaptures = callQuery.captures(node);
        for (const capture of callCaptures) {
            const callNode = capture.node;
            const calleeName = this.extractCalleeName(callNode);
            if (!calleeName) continue;

            // Direct label match (same-module call)
            let callee = this.symbolsByLabel.get(calleeName)?.[0];

            // Cross-module: alias::func → strip alias, look up func in that module's symbols
            if (!callee && calleeName.includes('::')) {
                const sep = calleeName.indexOf('::');
                const alias = calleeName.slice(0, sep);
                const funcName = calleeName.slice(sep + 2);
                const modulePath = moduleAliases.get(alias);
                if (modulePath) {
                    const candidates = this.symbolsByLabel.get(funcName) ?? [];
                    callee = candidates.find(s => s.file === modulePath);
                }
            }

            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallee(caller.qualifiedName, this.makeCallee(callee.qualifiedName));
            } else if (!callee) {
                this.addCallee(caller.qualifiedName, this.makeCallee(calleeName, 'external_unknown'));
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

    private static readonly STDLIB_PREFIXES = new Set([
        // Miden VM standard library modules
        'mem', 'sys', 'math', 'crypto', 'collections', 'io', 'std',
        // Common Miden stdlib paths
        'mem::pipe', 'mem::storew', 'mem::loadw',
        'crypto::hashes', 'crypto::dsa', 'crypto::fri', 'crypto::stark',
        'math::u64', 'math::u32', 'math::poly',
        'collections::mmr', 'collections::smt',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        for (const prefix of MasmAdapter.STDLIB_PREFIXES) {
            if (name === prefix || name.startsWith(prefix + '::') || name.startsWith(prefix + '.')) return true;
        }
        return false;
    }

}
