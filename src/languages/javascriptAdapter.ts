import {
    FileContent, SupportedLanguage, SymbolEntry, Visibility,
    SymbolMap, CallTargetKind, ModifierInfo
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

const JS_BUILTINS = new Set([
    'require', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON',
    'Error', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
    'decodeURIComponent', 'encodeURI', 'decodeURI', 'fetch', 'structuredClone',
    'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame'
]);

/**
 * Shared call graph implementation for the JavaScript/TypeScript language family.
 * Handles class declarations with methods and top-level function declarations.
 */
abstract class JSFamilyAdapter extends BaseAdapter {
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
                const className = classNode.childForFieldName('name')?.text ?? 'unknown';

                const bodyNode = classNode.childForFieldName('body');
                if (!bodyNode) continue;

                for (const child of bodyNode.children) {
                    if (child.type !== 'method_definition') continue;

                    const nameNode = child.childForFieldName('name');
                    if (!nameNode) continue;

                    const methodName = nameNode.text;
                    const visibility = this.extractMethodVisibility(child);
                    const id = `${className}.${methodName}`;

                    this.indexSymbol(this.createEntry({
                        qualifiedName: id,
                        label: methodName,
                        file: file.path,
                        node: child,
                        visibility,
                        contract: className
                    }));
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

                this.indexSymbol(this.createEntry({
                    qualifiedName: fnName,
                    label: fnName,
                    file: file.path,
                    node: funcNode,
                    visibility
                }));
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

                    const symbol = this.findSymbolAtNode(child, file.path);
                    if (!symbol) continue;

                    this.processCallsInNode(child, symbol, simpleCallQuery, memberCallQuery);
                }
            }

            // Process top-level functions
            const funcCaptures = functionQuery.captures(tree.rootNode);
            for (const capture of funcCaptures) {
                const funcNode = capture.node;
                if (this.isInsideAnyClass(funcNode, classCaptures)) continue;

                const symbol = this.findSymbolAtNode(funcNode, file.path);
                if (!symbol) continue;

                this.processCallsInNode(funcNode, symbol, simpleCallQuery, memberCallQuery);
            }
        }
    }

    private processCallsInNode(
        node: Node,
        caller: SymbolEntry,
        simpleCallQuery: Query,
        memberCallQuery: Query
    ) {
        // Simple calls: foo()
        const simpleCaptures = simpleCallQuery.captures(node);
        for (const capture of simpleCaptures) {
            if (capture.name !== 'FUNC') continue;
            const callName = capture.node.text;
            if (JS_BUILTINS.has(callName)) continue;

            const callee = this.resolveSimpleCall(callName, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallee(caller.qualifiedName, this.makeCallee(callee.qualifiedName));
            }
        }

        // Member calls: this.method() or obj.method()
        const memberCaptures = memberCallQuery.captures(node);
        for (const capture of memberCaptures) {
            if (capture.name !== 'FUNC') continue;
            const methodName = capture.node.text;

            const callee = this.resolveMemberCall(methodName, caller);
            if (callee && callee.qualifiedName !== caller.qualifiedName) {
                this.addCallee(caller.qualifiedName, this.makeCallee(callee.qualifiedName));
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
        if (node.type === 'assignment_expression') {
            const lhs = node.childForFieldName('left');
            // this.x = ... or object.x = ...
            if (lhs?.type === 'member_expression') return true;
            return true;
        }
        if (node.type === 'augmented_assignment_expression') return true;
        return false;
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

    private resolveSimpleCall(callName: string, caller: SymbolEntry): SymbolEntry | undefined {
        // 1. Try same class methods first
        if (caller.contract) {
            const classEntries = this.symbolsByContainer.get(caller.contract);
            const match = classEntries?.find(n => n.label === callName);
            if (match) return match;
        }

        // 2. Free functions or any match
        const candidates = this.symbolsByLabel.get(callName);
        const freeFunc = candidates?.find(n => !n.contract);
        if (freeFunc) return freeFunc;

        return candidates?.[0];
    }

    private resolveMemberCall(methodName: string, caller: SymbolEntry): SymbolEntry | undefined {
        // 1. Try same class first (for this.method() patterns)
        if (caller.contract) {
            const classEntries = this.symbolsByContainer.get(caller.contract);
            const match = classEntries?.find(n => n.label === methodName);
            if (match) return match;
        }

        // 2. Any method with that name in any class
        const candidates = this.symbolsByLabel.get(methodName);
        return candidates?.find(n => !!n.contract);
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
