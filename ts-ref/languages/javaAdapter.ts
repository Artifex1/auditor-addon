import {
    FileContent, SupportedLanguage, GraphNode, NodeId, Visibility,
    ModifierInfo
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
                complexityMidpoint: 13,
                complexitySteepness: 9,
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.9,
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

                this.addContainerNode({
                    name: className,
                    containerKind: 'class',
                    visibility: this.extractVisibility(classNode),
                    node: classNode,
                    file: file.path,
                });

                const bodyNode = classNode.childForFieldName('body');
                if (!bodyNode) continue;

                const methodCaptures = methodQuery.captures(bodyNode);
                for (const mCapture of methodCaptures) {
                    const methodNode = mCapture.node;
                    // Only direct methods of this class (not nested classes)
                    if (this.isInsideNestedClass(methodNode, bodyNode)) continue;

                    const node = this.createMethodNode(methodNode, file.path, className);
                    if (node) this.addNode(node, className);
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
        const qualifiedName = `${className}.${fnName}`;

        return this.createNode({
            qualifiedName,
            label: fnName,
            file,
            node,
            visibility,
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

                    const callerNode = this.findNodeAtPosition(methodNode, file.path);
                    if (!callerNode) continue;

                    const callCaptures = callQuery.captures(methodNode);
                    for (const callCapture of callCaptures) {
                        if (callCapture.name !== 'FUNC') continue;
                        const callNode = callCapture.node;
                        const calleeName = callNode.text;
                        const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
                        const resolved = this.resolveCall(calleeName, callerNode);
                        if (resolved && resolved.qualifiedName !== callerNode.qualifiedName) {
                            this.addCallEdge(callerNode.id, resolved.qualifiedName, 'internal', callSite);
                        } else if (!resolved) {
                            this.addCallEdge(callerNode.id, calleeName, 'external_unknown', callSite);
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

    private resolveCall(name: string, caller: GraphNode): GraphNode | undefined {
        // 1. Same class methods first
        const callerContainer = this.getContainerName(caller.id);
        if (callerContainer) {
            const match = this.findInContainer(callerContainer, name);
            if (match) return match;
        }
        // 2. Any method with that name
        return this._graph.findByName(name).find(n => n.status === 'concrete');
    }

    private static readonly STDLIB_RECEIVERS = new Set([
        'System', 'String', 'Integer', 'Long', 'Double', 'Float', 'Short', 'Byte',
        'Character', 'Boolean', 'Math', 'Object', 'Arrays', 'Collections', 'Objects',
        'Optional', 'Thread', 'Runtime', 'Class', 'Enum', 'Iterable', 'Iterator',
        'StringBuilder', 'StringBuffer', 'Number', 'Comparable', 'AutoCloseable',
        'Throwable', 'Exception', 'Error', 'List', 'Map', 'Set', 'Queue', 'Deque',
        'ArrayList', 'HashMap', 'HashSet', 'LinkedList', 'TreeMap', 'TreeSet',
        'stream', 'Stream', 'Collectors',
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
        'remaining', 'position', 'limit', 'rewind', 'flip', 'clear',
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
