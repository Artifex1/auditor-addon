import {
    FileContent, SupportedLanguage, GraphNode, NodeId, Visibility,
    ModifierInfo
} from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";
import { TreeSitterService } from "../util/treeSitter.js";
import { Query, Node } from "web-tree-sitter";


const JS_FAMILY_QUERIES = {
    comments: '(comment) @comment',
    functions: `
        (function_declaration) @function
        (generator_function_declaration) @function
        (method_definition) @function
        (function_expression) @function
        (arrow_function) @function
    `,
    branching: `
        (if_statement) @branch
        (for_statement) @branch
        (for_in_statement) @branch
        (for_of_statement) @branch
        (while_statement) @branch
        (do_statement) @branch
        (switch_statement) @branch
        (conditional_expression) @branch
        (try_statement) @branch
    `,
    normalization: `
        (call_expression) @norm
        (function_declaration) @norm
        (generator_function_declaration) @norm
        (function_expression) @norm
        (arrow_function) @norm
        (method_definition) @norm
        (array) @norm
        (object) @norm
    `
};

const JS_FAMILY_CONSTANTS = {
    baseRateNlocPerDay: 275,
    // Typical JS/TS code is readable but can hide complexity in callbacks and
    // async flows; we start penalizing around moderate branch density.
    complexityMidpoint: 12,
    // Complexity ramps at a similar pace to Go/C++, rewarding simpler code but
    // quickly slowing down when control flow gets tangled.
    complexitySteepness: 9,
    // Clear, linear code can give ~25% speedup; heavily nested/async logic can
    // cost up to ~90% more review time.
    complexityBenefitCap: 0.25,
    complexityPenaltyCap: 0.9,
    // Good inline docs for async boundaries, data shapes, and side effects help
    // reviewers; most benefit comes around ~15% comment density.
    commentFullBenefitDensity: 15,
    commentBenefitCap: 0.25
};


/**
 * Shared call graph implementation for the JavaScript/TypeScript language family.
 * Handles class declarations with methods and top-level function declarations.
 */
abstract class JSFamilyAdapter extends BaseAdapter {
    private static readonly BUILTINS = new Set([
        'require', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON',
        'Error', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
        'decodeURIComponent', 'encodeURI', 'decodeURI', 'fetch', 'structuredClone',
        'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
        'undefined', 'null', 'NaN', 'Infinity', 'globalThis',
    ]);

    private static readonly CALL_QUERIES = {
        CLASSES: `(class_declaration) @class`,
        FUNCTIONS: `(function_declaration) @function`,
        SIMPLE_CALL: `(call_expression function: (identifier) @FUNC)`,
        MEMBER_CALL: `(call_expression function: (member_expression property: (property_identifier) @FUNC))`
    } as const;


    protected override async buildSymbolTable(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(this.languageId);
        const parser = await service.createParser(this.languageId);

        const classQuery = new Query(lang, JSFamilyAdapter.CALL_QUERIES.CLASSES);
        const functionQuery = new Query(lang, JSFamilyAdapter.CALL_QUERIES.FUNCTIONS);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            // 1. Find all class declarations and index their methods
            const classCaptures = classQuery.captures(tree.rootNode);
            for (const capture of classCaptures) {
                const classNode = capture.node;
                // Fallback to first identifier child for generic classes: class Foo<T>
                const className = classNode.childForFieldName('name')?.text
                    ?? classNode.children.find(c => c.type === 'identifier')?.text
                    ?? 'unknown';

                this.addContainerNode({
                    name: className,
                    containerKind: 'class',
                    visibility: 'public',
                    node: classNode,
                    file: file.path,
                });

                const bodyNode = classNode.childForFieldName('body');
                if (!bodyNode) continue;

                for (const child of bodyNode.children) {
                    if (child.type !== 'method_definition') continue;

                    const nameNode = child.childForFieldName('name');
                    if (!nameNode) continue;

                    const methodName = nameNode.text;
                    const visibility = this.extractMethodVisibility(child);
                    const id = `${className}.${methodName}`;

                    this.addNode(this.createNode({
                        qualifiedName: id,
                        label: methodName,
                        file: file.path,
                        node: child,
                        visibility,
                    }), className);
                }
            }

            // 2. Find top-level function declarations (not inside classes)
            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const funcNode = capture.node;

                // Skip functions inside class bodies
                if (this.isInsideAnyClass(funcNode, classCaptures)) continue;

                const nameNode = funcNode.childForFieldName('name');
                if (!nameNode) continue;

                const fnName = nameNode.text;
                // Exported functions are public; others are private by default
                const visibility: Visibility = funcNode.parent?.type === 'export_statement' ? 'public' : 'private';

                this.addNode(this.createNode({
                    qualifiedName: fnName,
                    label: fnName,
                    file: file.path,
                    node: funcNode,
                    visibility
                }));
            }

            // 3. Find top-level variable-declared arrow/function expressions
            // Handles: const foo = () => {} / const foo = function() {}
            for (const child of tree.rootNode.children) {
                const isExport = child.type === 'export_statement';
                const declNode = isExport
                    ? child.children.find(c => c.type === 'lexical_declaration' || c.type === 'variable_declaration')
                    : (child.type === 'lexical_declaration' || child.type === 'variable_declaration') ? child : null;
                if (!declNode) continue;

                for (const declarator of declNode.children) {
                    if (declarator.type !== 'variable_declarator') continue;
                    const nameNode = declarator.childForFieldName('name');
                    const valueNode = declarator.childForFieldName('value');
                    if (!nameNode || !valueNode) continue;
                    if (valueNode.type !== 'arrow_function' && valueNode.type !== 'function_expression') continue;

                    const fnName = nameNode.text;
                    const visibility: Visibility = isExport ? 'public' : 'private';
                    this.addNode(this.createNode({
                        qualifiedName: fnName,
                        label: fnName,
                        file: file.path,
                        node: valueNode,
                        visibility
                    }));
                }
            }
        }
    }

    private extractMethodVisibility(node: Node): Visibility {
        // Check for TypeScript accessibility modifier (public/private/protected)
        for (const child of node.children) {
            if (child.type === 'accessibility_modifier') {
                const text = child.text;
                if (text === 'private') return 'private';
                if (text === 'protected') return 'internal';
                return 'public';
            }
        }

        // Private class fields use # prefix
        const nameNode = node.childForFieldName('name');
        if (nameNode?.type === 'private_property_identifier') return 'private';

        return 'public';
    }

    private isInsideAnyClass(node: Node, classCaptures: { node: Node }[]): boolean {
        for (const capture of classCaptures) {
            const classNode = capture.node;
            if (node.startIndex >= classNode.startIndex && node.endIndex <= classNode.endIndex) {
                return true;
            }
        }
        return false;
    }

    protected override async identifyCalls(files: FileContent[]) {
        const service = TreeSitterService.getInstance();
        const lang = await service.getLanguage(this.languageId);
        const parser = await service.createParser(this.languageId);

        const classQuery = new Query(lang, JSFamilyAdapter.CALL_QUERIES.CLASSES);
        const functionQuery = new Query(lang, JSFamilyAdapter.CALL_QUERIES.FUNCTIONS);
        const simpleCallQuery = new Query(lang, JSFamilyAdapter.CALL_QUERIES.SIMPLE_CALL);
        const memberCallQuery = new Query(lang, JSFamilyAdapter.CALL_QUERIES.MEMBER_CALL);

        for (const file of files) {
            const tree = parser.parse(file.content);
            if (!tree) continue;

            const classCaptures = classQuery.captures(tree.rootNode);

            // Process methods in classes
            for (const capture of classCaptures) {
                const classNode = capture.node;
                const bodyNode = classNode.childForFieldName('body');
                if (!bodyNode) continue;

                for (const child of bodyNode.children) {
                    if (child.type !== 'method_definition') continue;

                    const callerNode = this.findNodeAtPosition(child, file.path);
                    if (!callerNode) continue;

                    this.processCallsInNode(child, callerNode, simpleCallQuery, memberCallQuery);
                }
            }

            // Process top-level functions
            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const funcNode = capture.node;
                if (this.isInsideAnyClass(funcNode, classCaptures)) continue;

                const callerNode = this.findNodeAtPosition(funcNode, file.path);
                if (!callerNode) continue;

                this.processCallsInNode(funcNode, callerNode, simpleCallQuery, memberCallQuery);
            }

            // Process top-level variable-declared arrow/function expressions
            for (const child of tree.rootNode.children) {
                const isExport = child.type === 'export_statement';
                const declNode = isExport
                    ? child.children.find(c => c.type === 'lexical_declaration' || c.type === 'variable_declaration')
                    : (child.type === 'lexical_declaration' || child.type === 'variable_declaration') ? child : null;
                if (!declNode) continue;

                for (const declarator of declNode.children) {
                    if (declarator.type !== 'variable_declarator') continue;
                    const valueNode = declarator.childForFieldName('value');
                    if (!valueNode) continue;
                    if (valueNode.type !== 'arrow_function' && valueNode.type !== 'function_expression') continue;

                    const callerNode = this.findNodeAtPosition(valueNode, file.path);
                    if (!callerNode) continue;

                    this.processCallsInNode(valueNode, callerNode, simpleCallQuery, memberCallQuery);
                }
            }
        }
    }

    private processCallsInNode(
        node: Node,
        caller: GraphNode,
        simpleCallQuery: Query,
        memberCallQuery: Query
    ) {
        // Simple calls: foo()
        const simpleCaptures = simpleCallQuery.captures(node);
        for (const capture of simpleCaptures) {
            if (capture.name !== 'FUNC') continue;
            const callNode = capture.node;
            const callName = callNode.text;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };
            const callee = this.resolveSimpleCall(callName, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, callee.qualifiedName, 'internal', callSite);
            } else if (!callee) {
                this.addCallEdge(caller.id, callName, 'external_unknown', callSite);
            }
        }

        // Member calls: this.method() or obj.method()
        const memberCaptures = memberCallQuery.captures(node);
        for (const capture of memberCaptures) {
            if (capture.name !== 'FUNC') continue;
            const callNode = capture.node;
            const methodName = callNode.text;
            const callSite = { startIndex: callNode.startIndex, line: callNode.startPosition.row + 1 };

            const callee = this.resolveMemberCall(methodName, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallEdge(caller.id, callee.qualifiedName, 'internal', callSite);
            } else if (!callee) {
                const obj = callNode.parent?.childForFieldName('object')?.text;
                const fullName = obj && obj !== 'this' && obj !== 'self'
                    ? `${obj}.${methodName}`
                    : methodName;
                this.addCallEdge(caller.id, fullName, 'external_unknown', callSite);
            }
        }
    }

    // ==========================================
    // Trait method implementations
    // ==========================================

    override isFunctionDef(node: Node): boolean {
        return node.type === 'function_declaration' || node.type === 'method_definition'
            || node.type === 'arrow_function' || node.type === 'function_expression'
            || node.type === 'generator_function_declaration';
    }

    override getFunctionName(node: Node): string | null {
        if (node.type === 'method_definition' || node.type === 'function_declaration'
            || node.type === 'generator_function_declaration') {
            return node.childForFieldName('name')?.text ?? null;
        }
        return null;
    }

    override isPublicFn(node: Node): boolean {
        if (node.type === 'method_definition') {
            // Check TS accessibility_modifier
            for (const child of node.children) {
                if (child.type === 'accessibility_modifier') {
                    return child.text === 'public';
                }
            }
            // Check # prefix (private)
            const nameNode = node.childForFieldName('name');
            if (nameNode?.type === 'private_property_identifier') return false;
            return true; // default public in JS
        }
        if (node.type === 'function_declaration') {
            return node.parent?.type === 'export_statement';
        }
        return false;
    }

    override isExternalCall(node: Node): boolean {
        // fetch(), XMLHttpRequest, child_process, http/https calls
        if (node.type !== 'call_expression') return false;
        const text = node.text;
        return text.startsWith('fetch(') || text.includes('XMLHttpRequest')
            || text.includes('child_process') || text.includes('exec(')
            || text.includes('spawn(') || text.includes('http.');
    }

    override isStateWrite(node: Node): boolean {
        return node.type === 'assignment_expression'
            || node.type === 'augmented_assignment_expression';
    }

    override isStateRead(node: Node): boolean {
        // this.x property access
        if (node.type === 'member_expression') {
            const obj = node.childForFieldName('object');
            if (obj?.text === 'this') return true;
        }
        return false;
    }

    override isAccessModifier(node: Node): boolean {
        // TS decorators
        return node.type === 'decorator';
    }

    override isReturnStatement(node: Node): boolean {
        return node.type === 'return_statement';
    }

    override getCallTarget(node: Node): string | null {
        if (node.type !== 'call_expression') return null;
        const func = node.childForFieldName('function');
        if (!func) return null;
        if (func.type === 'identifier') return func.text;
        if (func.type === 'member_expression') {
            return func.childForFieldName('property')?.text ?? null;
        }
        return null;
    }

    override getWrittenVar(node: Node): string | null {
        if (node.type !== 'assignment_expression'
            && node.type !== 'augmented_assignment_expression') return null;
        return node.childForFieldName('left')?.text ?? null;
    }

    override getModifiers(node: Node): ModifierInfo[] {
        if (!this.isFunctionDef(node)) return [];
        const result: ModifierInfo[] = [];
        // TS decorators on methods
        let prev = node.previousSibling;
        while (prev && prev.type === 'decorator') {
            const expr = prev.childForFieldName('expression')
                ?? prev.children.find(c => c.type !== '@');
            const name = expr?.text ?? prev.text.replace('@', '');
            result.push({ name, pattern: 'wrapper' });
            prev = prev.previousSibling;
        }
        return result;
    }

    private resolveSimpleCall(callName: string, caller: GraphNode): GraphNode | undefined {
        const callerContainer = this.getContainerName(caller.id);
        // 1. Try same class methods first
        if (callerContainer) {
            const match = this.findInContainer(callerContainer, callName);
            if (match) return match;
        }

        // 2. Free functions or any match
        const candidates = this._graph.findByName(callName);
        const freeFunc = candidates.find(n => !this.getContainerName(n.id) && n.status === 'concrete');
        if (freeFunc) return freeFunc;

        return candidates.find(n => n.status === 'concrete');
    }

    private resolveMemberCall(methodName: string, caller: GraphNode): GraphNode | undefined {
        const callerContainer = this.getContainerName(caller.id);
        // 1. Try same class first (for this.method() patterns)
        if (callerContainer) {
            const match = this.findInContainer(callerContainer, methodName);
            if (match) return match;
        }

        // 2. Any method with that name in any class
        return this._graph.findByName(methodName).find(n => !!this.getContainerName(n.id) && n.status === 'concrete');
    }

    private static readonly STDLIB_RECEIVERS = new Set([
        // Global objects
        'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
        'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol',
        'Error', 'Buffer', 'process', 'global', 'window', 'document', 'navigator',
        'localStorage', 'sessionStorage', 'location', 'history',
        // Node.js modules
        'fs', 'path', 'os', 'crypto', 'http', 'https', 'net', 'url', 'util',
        'events', 'stream', 'zlib', 'child_process', 'cluster', 'dns', 'readline',
        'assert', 'querystring', 'vm', 'worker_threads', 'perf_hooks',
    ]);

    private static readonly STDLIB_METHODS = new Set([
        // Array methods
        'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat', 'join',
        'reverse', 'sort', 'flat', 'flatMap', 'map', 'filter', 'reduce', 'reduceRight',
        'forEach', 'find', 'findIndex', 'findLast', 'findLastIndex', 'indexOf', 'lastIndexOf',
        'includes', 'some', 'every', 'fill', 'copyWithin', 'entries', 'keys', 'values',
        // String methods
        'split', 'trim', 'trimStart', 'trimEnd', 'padStart', 'padEnd', 'repeat',
        'startsWith', 'endsWith', 'replace', 'replaceAll', 'match', 'matchAll',
        'search', 'at', 'charAt', 'charCodeAt', 'codePointAt', 'normalize',
        'toUpperCase', 'toLowerCase', 'toLocaleLowerCase', 'toLocaleUpperCase',
        // Object/Promise methods
        'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'allSettled', 'any', 'race',
        'assign', 'keys', 'values', 'entries', 'freeze', 'seal', 'create', 'defineProperty',
        'hasOwnProperty', 'toString', 'valueOf', 'bind', 'call', 'apply',
        // General
        'log', 'warn', 'error', 'info', 'debug', 'trace', 'group', 'groupEnd', 'time', 'timeEnd',
        'get', 'set', 'has', 'delete', 'clear', 'size', 'add',
        'emit', 'on', 'off', 'once', 'removeListener', 'addListener',
        'read', 'write', 'pipe', 'end', 'close', 'open',
        'parse', 'stringify',
        'test', 'exec', 'compile',
    ]);

    protected override isKnownStdlib(name: string): boolean {
        if (JSFamilyAdapter.BUILTINS.has(name)) return true;
        if (JSFamilyAdapter.STDLIB_METHODS.has(name)) return true;
        const dot = name.indexOf('.');
        if (dot !== -1) {
            const receiver = name.slice(0, dot);
            const method = name.slice(dot + 1);
            if (JSFamilyAdapter.STDLIB_RECEIVERS.has(receiver)) return true;
            if (JSFamilyAdapter.STDLIB_METHODS.has(method)) return true;
        }
        return false;
    }

}

export class JavaScriptAdapter extends JSFamilyAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.JavaScript,
            queries: JS_FAMILY_QUERIES,
            constants: JS_FAMILY_CONSTANTS
        });
    }
}

export class TypeScriptAdapter extends JSFamilyAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.TypeScript,
            queries: JS_FAMILY_QUERIES,
            constants: JS_FAMILY_CONSTANTS
        });
    }
}

export class TsxAdapter extends JSFamilyAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Tsx,
            queries: JS_FAMILY_QUERIES,
            constants: JS_FAMILY_CONSTANTS
        });
    }
}

export class FlowAdapter extends JSFamilyAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Flow,
            queries: JS_FAMILY_QUERIES,
            constants: JS_FAMILY_CONSTANTS
        });
    }
}
