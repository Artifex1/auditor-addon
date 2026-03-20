import {
    FileContent, SupportedLanguage, SymbolEntry, Visibility,
    SymbolMap, CallTargetKind, ModifierInfo
} from "../engine/types.js";
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

                    const entry = this.createMethodNode(methodNode, file.path, className);
                    if (entry) this.indexSymbol(entry);
                }
            }
        }
    }

    private createMethodNode(node: Node, file: string, className: string): SymbolEntry | undefined {
        // method_declaration: modifiers? type name formal_parameters body
        // constructor_declaration: modifiers? name formal_parameters body
        const nameNode = node.childForFieldName('name')
            ?? node.children.find(c => c.type === 'identifier');
        if (!nameNode) return undefined;

        const fnName = nameNode.text;
        const visibility = this.extractVisibility(node);
        const qualifiedName = `${className}.${fnName}`;

        return this.createEntry({
            qualifiedName,
            label: fnName,
            file,
            node,
            visibility,
            contract: className,
        });
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

    protected override async identifyCalls(files: FileContent[]) {
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
                        if (callee && callee.qualifiedName !== symbol.qualifiedName) {
                            this.addCallee(symbol.qualifiedName, this.makeCallee(callee.qualifiedName));
                        } else if (!callee) {
                            this.addCallee(symbol.qualifiedName, this.makeCallee(calleeName, 'external_unknown'));
                        }
                    }
                }
            }
        }
    }

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'method_declaration' || node.type === 'constructor_declaration';
    }

    override getFunctionName(node: Node): string | null {
        if (this.isFunctionDef(node)) {
            return node.childForFieldName('name')?.text
                ?? node.children.find(c => c.type === 'identifier')?.text
                ?? null;
        }
        return null;
    }

    override isPublicFn(node: Node): boolean {
        return this.extractVisibility(node) === 'public';
    }

    override isExternalCall(node: Node): boolean {
        // Java: Runtime.exec, ProcessBuilder, reflection
        if (node.type !== 'method_invocation') return false;
        const text = node.text;
        return text.includes('Runtime.getRuntime().exec')
            || text.includes('ProcessBuilder')
            || text.includes('.invoke(');
    }

    override isStateWrite(node: Node): boolean {
        if (node.type === 'assignment_expression') return true;
        if (node.type === 'update_expression') return true;
        return false;
    }

    override isStateRead(node: Node): boolean {
        if (node.type === 'field_access') return true;
        if (node.type === 'identifier') {
            const parent = node.parent;
            if (parent?.type === 'assignment_expression'
                && parent.childForFieldName('left')?.id === node.id) {
                return false;
            }
            return true;
        }
        return false;
    }

    override isAccessModifier(node: Node): boolean {
        return node.type === 'marker_annotation' || node.type === 'annotation';
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_statement';
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'method_invocation') return null;
        return node.childForFieldName('name')?.text ?? null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment_expression') return null;
        return node.childForFieldName('left')?.text ?? null;
    }

    override getModifiers(node: Node): ModifierInfo[] {
        if (!this.isFunctionDef(node)) return [];
        const result: ModifierInfo[] = [];
        // Java annotations on methods
        let prev = node.previousSibling;
        while (prev && (prev.type === 'marker_annotation' || prev.type === 'annotation')) {
            const name = prev.text.replace('@', '').split('(')[0];
            result.push({ name, pattern: 'wrapper' });
            prev = prev.previousSibling;
        }
        // Also check within modifiers child
        const modifiers = node.childForFieldName('modifiers')
            ?? node.children.find(c => c.type === 'modifiers');
        if (modifiers) {
            for (const child of modifiers.children) {
                if (child.type === 'marker_annotation' || child.type === 'annotation') {
                    const name = child.text.replace('@', '').split('(')[0];
                    result.push({ name, pattern: 'wrapper' });
                }
            }
        }
        return result;
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

    private resolveCall(name: string, caller: SymbolEntry): SymbolEntry | undefined {
        // 1. Same class methods first
        if (caller.contract) {
            const classNodes = this.symbolsByContainer.get(caller.contract);
            const match = classNodes?.find(n => n.label === name);
            if (match) return match;
        }
        // 2. Any method with that name
        return this.symbolsByLabel.get(name)?.[0];
    }

    private static readonly STDLIB_RECEIVERS = new Set([
        'System', 'String', 'Integer', 'Long', 'Double', 'Float', 'Short', 'Byte',
        'Character', 'Boolean', 'Math', 'Object', 'Arrays', 'Collections', 'Objects',
        'Optional', 'Thread', 'Runtime', 'Class', 'Enum', 'Iterable', 'Iterator',
        'StringBuilder', 'StringBuffer', 'Number', 'Comparable', 'AutoCloseable',
        'Throwable', 'Exception', 'Error', 'List', 'Map', 'Set', 'Queue', 'Deque',
        'ArrayList', 'HashMap', 'HashSet', 'LinkedList', 'TreeMap', 'TreeSet',
        'stream', 'Stream', 'Collectors', 'Optional',
        // Logging frameworks
        'log', 'logger', 'Logger', 'LOG',
    ]);

    private static readonly STDLIB_METHODS = new Set([
        'toString', 'equals', 'hashCode', 'compareTo', 'clone', 'finalize',
        'println', 'print', 'printf', 'format', 'valueOf', 'parseInt', 'parseLong',
        'parseDouble', 'of', 'get', 'put', 'add', 'remove', 'size', 'isEmpty',
        'contains', 'iterator', 'stream', 'map', 'filter', 'collect', 'toList',
        'orElse', 'orElseGet', 'orElseThrow', 'isPresent', 'ifPresent',
        'length', 'charAt', 'substring', 'indexOf', 'lastIndexOf', 'replace',
        'startsWith', 'endsWith', 'trim', 'split', 'toUpperCase', 'toLowerCase',
        'sort', 'asList', 'emptyList', 'singletonList', 'unmodifiableList',
        'append', 'insert', 'delete', 'reverse', 'capacity',
        'currentTimeMillis', 'nanoTime', 'exit', 'gc', 'getenv', 'getProperty',
        'start', 'run', 'join', 'sleep', 'wait', 'notify', 'notifyAll',
        // Exception / Throwable methods
        'getMessage', 'getCause', 'getStackTrace', 'printStackTrace', 'getLocalizedMessage',
        // String methods not yet covered
        'getBytes', 'equalsIgnoreCase', 'matches', 'replaceAll', 'replaceFirst', 'toCharArray',
        'intern', 'chars', 'codePoints', 'strip', 'isBlank', 'repeat',
        // I/O methods on streams, channels, sockets
        'read', 'write', 'close', 'flush', 'available', 'readLine', 'readAllBytes',
        'isClosed', 'isConnected', 'isInputShutdown', 'isOutputShutdown',
        'remaining', 'position', 'limit', 'capacity', 'rewind', 'flip', 'clear',
        // Tokenizer / scanner
        'hasMoreTokens', 'nextToken', 'hasNext', 'next', 'nextLine', 'nextInt',
        // Logging methods
        'info', 'debug', 'warn', 'error', 'trace', 'fatal', 'isDebugEnabled',
        // Collections / map additional
        'values', 'keySet', 'entrySet', 'getOrDefault', 'putIfAbsent', 'computeIfAbsent',
        'forEach', 'toArray', 'subList', 'listIterator', 'peek', 'poll', 'offer',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        if (JavaAdapter.STDLIB_METHODS.has(name)) return true;
        const dot = name.indexOf('.');
        if (dot !== -1 && JavaAdapter.STDLIB_RECEIVERS.has(name.slice(0, dot))) return true;
        return false;
    }
}
