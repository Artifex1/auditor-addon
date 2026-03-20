import type { Node as SyntaxNode } from "web-tree-sitter";
import {
    Rule, RuleContext, FindingInstance, SymbolMap
} from "../engine/types.js";

/**
 * Walks an AST calling rule.enter()/exit() on every node (DFS, document order).
 * Used for shallow rules (no call-edge following).
 */
export function walkShallow(
    root: SyntaxNode,
    rule: Rule,
    ctx: RuleContext,
): void {
    rule.enter?.(root, ctx);
    for (const child of root.children) {
        walkShallow(child, rule, ctx);
    }
    rule.exit?.(root, ctx);
}

/**
 * Walks an AST calling rule.enter()/exit(), following call edges for deep rules.
 * `depth` counts function boundaries crossed, not AST levels.
 */
export async function walkDeep(
    node: SyntaxNode,
    rule: Rule,
    ctx: RuleContext,
    visited: Set<string>,
    depth: number,
    maxDepth: number,
): Promise<void> {
    if (depth > maxDepth) return;

    rule.enter?.(node, ctx);

    // Follow call edges from this node
    const callee = ctx.trait.resolveCallee(node, ctx.symbolMap, ctx.sourceFiles);
    if (callee && !visited.has(callee.qualifiedName)) {
        // If the agent resolved this gap to a concrete symbol, follow the redirect.
        const gapEntry = ctx.symbolMap.get(callee.qualifiedName);
        const targetQN = gapEntry?.redirectTo ?? callee.qualifiedName;

        const calleeNode = await lookupFunctionNode(targetQN, ctx.symbolMap, ctx);
        if (calleeNode) {
            visited.add(callee.qualifiedName);
            visited.add(targetQN);
            const entry = ctx.symbolMap.get(targetQN)!;
            const prevFile = ctx.currentFile;
            ctx.currentFile = entry.file;
            await walkDeep(calleeNode, rule, ctx, visited, depth + 1, maxDepth);
            ctx.currentFile = prevFile;
        }
    }

    // Follow modifier bodies at function boundaries
    if (ctx.trait.isFunctionDef(node)) {
        const qn = lookupQualifiedName(node, ctx);
        if (qn) {
            const entry = ctx.symbolMap.get(qn);
            if (entry) {
                for (const mod of entry.modifiers) {
                    if ((mod.pattern === 'explicit' || mod.pattern === 'wrapper') && !visited.has(mod.name)) {
                        const modNode = await lookupModifierNode(mod, ctx);
                        if (modNode) {
                            visited.add(mod.name);
                            await walkDeep(modNode, rule, ctx, visited, depth + 1, maxDepth);
                        }
                    }
                }
            }
        }
    }

    // Recurse into children (same function — no depth increment)
    for (const child of node.children) {
        await walkDeep(child, rule, ctx, visited, depth, maxDepth);
    }

    rule.exit?.(node, ctx);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a function AST node back to its qualified name in the symbol map.
 */
function lookupQualifiedName(funcNode: SyntaxNode, ctx: RuleContext): string | null {
    const name = ctx.trait.getFunctionName(funcNode);
    if (!name) return null;
    for (const [qn, entry] of ctx.symbolMap) {
        if (entry.label === name && entry.file === ctx.currentFile) {
            if (entry.range && entry.range.start.line - 1 === funcNode.startPosition.row) {
                return qn;
            }
        }
    }
    return null;
}

/**
 * Looks up the AST node for a function by its qualified name.
 * Cross-file: uses ctx.getTree() to parse the target file.
 */
async function lookupFunctionNode(
    qualifiedName: string,
    symbolMap: SymbolMap,
    ctx: RuleContext
): Promise<SyntaxNode | null> {
    const entry = symbolMap.get(qualifiedName);
    if (!entry) return null;
    if (!entry.range) return null;

    let tree;
    try {
        tree = await ctx.getTree(entry.file);
    } catch {
        return null;
    }

    const targetLine = entry.range.start.line - 1;
    const targetCol = entry.range.start.column;
    return findNodeAt(tree.rootNode, targetLine, targetCol);
}

/**
 * Looks up a modifier node by pattern.
 * - 'explicit' (e.g., Solidity modifier): query tree for modifier_definition by name
 * - 'wrapper' (e.g., Python decorator): look up as function in symbolMap
 */
async function lookupModifierNode(
    mod: { name: string; pattern: string },
    ctx: RuleContext
): Promise<SyntaxNode | null> {
    if (mod.pattern === 'wrapper') {
        for (const [qn, entry] of ctx.symbolMap) {
            if (entry.label === mod.name) {
                return lookupFunctionNode(qn, ctx.symbolMap, ctx);
            }
        }
        return null;
    }

    if (mod.pattern === 'explicit') {
        for (const file of ctx.sourceFiles.keys()) {
            let tree;
            try {
                tree = await ctx.getTree(file);
            } catch {
                continue;
            }
            const node = findModifierDefByName(tree.rootNode, mod.name);
            if (node) return node;
        }
        return null;
    }

    return null;
}

function findModifierDefByName(root: SyntaxNode, name: string): SyntaxNode | null {
    if (root.type === 'modifier_definition') {
        const nameNode = root.childForFieldName('name') ?? root.children.find(c => c.type === 'identifier');
        if (nameNode?.text === name) return root;
    }
    for (const child of root.children) {
        const found = findModifierDefByName(child, name);
        if (found) return found;
    }
    return null;
}

export function findNodeAt(root: SyntaxNode, row: number, col: number): SyntaxNode | null {
    if (root.startPosition.row === row && root.startPosition.column === col) {
        return root;
    }
    for (const child of root.children) {
        if (child.startPosition.row > row) break;
        if (child.endPosition.row < row) continue;
        const found = findNodeAt(child, row, col);
        if (found) return found;
    }
    return null;
}

/**
 * Deduplicates FindingInstances:
 * 1. Exact location match → keep the one with the longer executionPath
 * 2. Sub-path (executionPath is suffix of another) → drop the shorter one
 */
export function deduplicateInstances(instances: FindingInstance[]): FindingInstance[] {
    const byLocation = new Map<string, FindingInstance>();
    for (const inst of instances) {
        const key = `${inst.location.file}:${inst.location.line}:${inst.location.col}`;
        const existing = byLocation.get(key);
        if (!existing || (inst.executionPath?.length ?? 0) > (existing.executionPath?.length ?? 0)) {
            byLocation.set(key, inst);
        }
    }

    const deduped = [...byLocation.values()];

    return deduped.filter((inst, i) => {
        if (!inst.executionPath || inst.executionPath.length === 0) return true;
        for (let j = 0; j < deduped.length; j++) {
            if (i === j) continue;
            const other = deduped[j];
            if (!other.executionPath || other.executionPath.length <= inst.executionPath.length) continue;
            if (isSuffix(inst.executionPath, other.executionPath)) return false;
        }
        return true;
    });
}

function isSuffix(shorter: string[], longer: string[]): boolean {
    const offset = longer.length - shorter.length;
    for (let i = 0; i < shorter.length; i++) {
        if (shorter[i] !== longer[offset + i]) return false;
    }
    return true;
}
