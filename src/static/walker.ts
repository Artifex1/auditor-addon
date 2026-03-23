import type { Node as SyntaxNode } from "web-tree-sitter";
import {
    Rule, RuleContext, FindingInstance, GraphNode, NodeId
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
 *
 * @param currentNodeId - NodeId of the function currently being walked (for edge following)
 * @param astNode - The current AST node being visited
 */
export async function walkDeep(
    currentNodeId: NodeId,
    astNode: SyntaxNode,
    rule: Rule,
    ctx: RuleContext,
    visited: Set<NodeId>,
    depth: number,
    maxDepth: number,
): Promise<void> {
    if (depth > maxDepth) return;

    rule.enter?.(astNode, ctx);

    // Follow modifier bodies via has_modifier edges
    if (ctx.trait.isFunctionDef(astNode)) {
        for (const modEdge of ctx.graph.getOutEdgesOfKind(currentNodeId, 'has_modifier')) {
            const modGraphNode = ctx.graph.getNode(modEdge.to);
            if (!modGraphNode) continue;
            const pattern = modGraphNode.pattern ?? 'explicit';
            if (pattern !== 'explicit' && pattern !== 'wrapper') continue;
            const modVisitKey = currentNodeId + ':mod:' + modGraphNode.label;
            if (visited.has(modVisitKey)) continue;
            const modNode = await lookupModifierNode({ name: modGraphNode.label, pattern }, ctx);
            if (modNode) {
                visited.add(modVisitKey);
                await walkDeep(currentNodeId, modNode, rule, ctx, visited, depth + 1, maxDepth);
            }
        }
    }

    // For call nodes, follow edges outward
    const callTarget = ctx.trait.getCallTarget(astNode);
    if (callTarget) {
        // Find the outbound call edges from the current function
        for (const edge of ctx.graph.getOutEdgesOfKind(currentNodeId, 'calls')) {
            const calleeNode = ctx.graph.getNode(edge.to);
            if (!calleeNode || calleeNode.status !== 'concrete') continue;
            if (visited.has(edge.to)) continue;

            const calleeAstNode = await lookupFunctionNode(calleeNode, ctx);
            if (calleeAstNode) {
                visited.add(edge.to);
                const prevFile = ctx.currentFile;
                ctx.currentFile = calleeNode.locator?.file ?? prevFile;
                await walkDeep(edge.to, calleeAstNode, rule, ctx, visited, depth + 1, maxDepth);
                ctx.currentFile = prevFile;
            }
        }
    }

    // Recurse into children (same function — no depth increment)
    for (const child of astNode.children) {
        await walkDeep(currentNodeId, child, rule, ctx, visited, depth, maxDepth);
    }

    rule.exit?.(astNode, ctx);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Looks up the AST node for a function by its GraphNode.
 * Cross-file: uses ctx.getTree() to parse the target file.
 */
async function lookupFunctionNode(
    graphNode: GraphNode,
    ctx: RuleContext
): Promise<SyntaxNode | null> {
    if (!graphNode.locator) return null;

    let tree;
    try {
        tree = await ctx.getTree(graphNode.locator.file);
    } catch {
        return null;
    }

    // Use byte-offset for O(log n) re-entry
    return tree.rootNode.descendantForIndex(
        graphNode.locator.startIndex,
        graphNode.locator.endIndex
    ) ?? null;
}

/**
 * Looks up a modifier node by pattern.
 * - 'explicit' (e.g., Solidity modifier): query tree for modifier_definition by name
 * - 'wrapper' (e.g., Python decorator): look up as function in graph
 */
async function lookupModifierNode(
    mod: { name: string; pattern: string },
    ctx: RuleContext
): Promise<SyntaxNode | null> {
    if (mod.pattern === 'wrapper') {
        const candidates = ctx.graph.findByName(mod.name);
        for (const node of candidates) {
            if (node.status === 'concrete') {
                return lookupFunctionNode(node, ctx);
            }
        }
        return null;
    }

    if (mod.pattern === 'explicit') {
        // Try graph-based lookup first (O(1) vs brute-force file scan)
        const modCandidates = ctx.graph.findByName(mod.name);
        const modNode = modCandidates.find(n => n.kind === 'modifier' && n.status === 'concrete');
        if (!modNode) {
            // Try qualified name with common containers
            for (const candidate of modCandidates) {
                if (candidate.kind === 'modifier' && candidate.status === 'concrete' && candidate.locator) {
                    const tree = await ctx.getTree(candidate.locator.file);
                    return tree.rootNode.descendantForIndex(candidate.locator.startIndex, candidate.locator.endIndex) ?? null;
                }
            }
        }
        if (modNode?.locator) {
            try {
                const tree = await ctx.getTree(modNode.locator.file);
                return tree.rootNode.descendantForIndex(modNode.locator.startIndex, modNode.locator.endIndex) ?? null;
            } catch {
                // fall through to brute-force
            }
        }

        // Fallback: brute-force file scan
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
