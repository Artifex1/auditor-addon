import type { Node as SyntaxNode } from "web-tree-sitter";
import {
    PathRule, PhaseState, RuleContext, FindingInstance,
    SymbolMap
} from "../engine/types.js";

/**
 * Result of a walkPath invocation.
 * - finding: non-null if all phases matched
 * - state: the furthest-reached phase state (propagated from callees)
 */
export interface WalkResult {
    finding: FindingInstance | null;
    state: PhaseState;
}

/**
 * Walks an AST evaluating a PathRule's phase state machine.
 *
 * DFS through descendant nodes. Phase conditions are checked on every node.
 * When a call_expression resolves to a known callee, the walker crosses into
 * the callee's body (incrementing depth). State advances propagate back from
 * callees to the caller so that later siblings can match subsequent phases.
 *
 * `depth` counts **function boundaries crossed**, not AST levels.
 */
export async function walkPath(
    node: SyntaxNode,
    rule: PathRule,
    state: PhaseState,
    ctx: RuleContext,
    visited: Set<string>,
    depth: number
): Promise<WalkResult> {
    if (depth > rule.maxDepth) return { finding: null, state };

    let current = state;
    const result = await walkDescendants(node, rule, current, ctx, visited, depth);
    return result;
}

/**
 * Internal DFS. Walks all descendants without incrementing depth.
 * Depth only increments when crossing a function boundary.
 */
async function walkDescendants(
    node: SyntaxNode,
    rule: PathRule,
    state: PhaseState,
    ctx: RuleContext,
    visited: Set<string>,
    depth: number
): Promise<WalkResult> {
    let current = state;

    for (const child of node.children) {
        // Check phase condition on this child
        const phase = rule.phases[current.currentPhase];
        if (!phase) return { finding: null, state: current };

        if (phase.condition(child, ctx, current)) {
            current = {
                ...(phase.onEnter?.(child, current) ?? current),
                currentPhase: current.currentPhase + 1,
                matched: [...current.matched, true],
                evidence: [...current.evidence, { node: child, file: ctx.currentFile }],
            };
        }

        if (current.currentPhase === rule.phases.length) {
            return { finding: rule.buildFinding(current, ctx), state: current };
        }

        // Follow call edges — depth increments here (crossing function boundary)
        const callee = ctx.trait.resolveCallee(child, ctx.symbolMap, ctx.sourceFiles);
        if (callee && !visited.has(callee.qualifiedName)) {
            const calleeNode = await lookupFunctionNode(callee.qualifiedName, ctx.symbolMap, ctx);
            if (calleeNode) {
                visited.add(callee.qualifiedName);
                const entry = ctx.symbolMap.get(callee.qualifiedName)!;
                const prevFile = ctx.currentFile;
                ctx.currentFile = entry.file;
                const callResult = await walkPath(calleeNode, rule, current, ctx, visited, depth + 1);
                ctx.currentFile = prevFile;
                if (callResult.finding) return callResult;
                current = callResult.state;
            }
        }

        if (current.currentPhase === rule.phases.length) {
            return { finding: rule.buildFinding(current, ctx), state: current };
        }

        // Follow modifier bodies — depth increments (crossing function boundary)
        const currentFn = findContainingFunction(child, ctx);
        if (currentFn) {
            const fnEntry = ctx.symbolMap.get(currentFn);
            if (fnEntry) {
                for (const mod of fnEntry.modifiers) {
                    if (mod.pattern === 'explicit' || mod.pattern === 'wrapper') {
                        if (!visited.has(mod.name)) {
                            const modNode = await lookupModifierNode(mod, ctx);
                            if (modNode) {
                                visited.add(mod.name);
                                const modResult = await walkPath(modNode, rule, current, ctx, visited, depth + 1);
                                if (modResult.finding) return modResult;
                                current = modResult.state;
                            }
                        }
                    }
                }
            }
        }

        if (current.currentPhase === rule.phases.length) {
            return { finding: rule.buildFinding(current, ctx), state: current };
        }

        // Recurse into children (same function — no depth increment)
        const childResult = await walkDescendants(child, rule, current, ctx, visited, depth);
        if (childResult.finding) return childResult;
        current = childResult.state;

        if (current.currentPhase === rule.phases.length) {
            return { finding: rule.buildFinding(current, ctx), state: current };
        }
    }

    return { finding: null, state: current };
}

/**
 * Creates the initial PhaseState for a PathRule evaluation.
 */
export function initialPhaseState(): PhaseState {
    return {
        currentPhase: 0,
        matched: [],
        evidence: [],
    };
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

function findContainingFunction(node: SyntaxNode, ctx: RuleContext): string | null {
    let current: SyntaxNode | null = node;
    while (current) {
        if (ctx.trait.isFunctionDef(current)) {
            const name = ctx.trait.getFunctionName(current);
            if (name) {
                for (const [qn, entry] of ctx.symbolMap) {
                    if (entry.label === name && entry.file === ctx.currentFile) {
                        return qn;
                    }
                }
            }
        }
        current = current.parent;
    }
    return null;
}

function findNodeAt(root: SyntaxNode, row: number, col: number): SyntaxNode | null {
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
