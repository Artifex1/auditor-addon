import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-014: Double State Read
 *
 * Function-scoped: detects when the same state variable is read twice
 * without an intervening write. The redundant read wastes gas (SLOAD)
 * and should be cached in a local variable.
 */
function createRule(): Rule {
    let firstRead: Map<string, Node> = new Map();
    let redundantReads: Map<string, Node> = new Map();
    let functionDepth = 0;
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-014',
        severity: 'info',
        title: 'Redundant state read (cache in local variable)',
        description: 'Reading the same storage slot multiple times within a function wastes gas. Cache the value in a local variable after the first SLOAD.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity, SupportedLanguage.Cairo, SupportedLanguage.Move],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (ctx.trait.isFunctionDef(node)) {
                functionDepth++;
                if (functionDepth === 1) {
                    firstRead.clear();
                    redundantReads.clear();
                }
                return;
            }

            if (functionDepth === 0) return;

            // If a write invalidates prior reads
            if (ctx.trait.isStateWrite(node)) {
                const written = ctx.trait.getWrittenVar(node);
                if (written) {
                    // Invalidate reads that are prefixed by or match the written var
                    for (const [key] of firstRead) {
                        if (key === written || key.startsWith(written + '.') || key.startsWith(written + '[')) {
                            firstRead.delete(key);
                        }
                    }
                }
                return;
            }

            // Detect composite storage access patterns (mapping[key], struct.field)
            if (isStorageAccess(node)) {
                const key = node.text;
                if (!key || key.length > 80) return;
                // Skip if this node is the LHS of an assignment
                if (isAssignmentTarget(node)) return;

                if (firstRead.has(key)) {
                    redundantReads.set(key, node);
                } else {
                    firstRead.set(key, node);
                }
            }
        },

        exit(node: Node, ctx: RuleContext) {
            if (ctx.trait.isFunctionDef(node)) {
                if (functionDepth === 1) {
                    for (const [key, readNode] of redundantReads) {
                        findings.push({
                            location: {
                                file: ctx.currentFile,
                                line: readNode.startPosition.row + 1,
                                col: readNode.startPosition.column,
                            },
                            snippet: `redundant state read: ${key}`,
                        });
                    }
                }
                functionDepth--;
            }
        },

        finalize() { return findings; },
        reset() {
            firstRead = new Map();
            redundantReads = new Map();
            functionDepth = 0;
            findings = [];
        },
    };
}

/**
 * Checks if a node is the LHS target of an assignment.
 * Walks up through expression wrappers to find the assignment.
 */
function isAssignmentTarget(node: Node): boolean {
    let current: Node | null = node;
    while (current) {
        const parent: Node | null = current.parent;
        if (!parent) return false;
        if (parent.type === 'expression') { current = parent; continue; }
        if (parent.type === 'assignment_expression' || parent.type === 'augmented_assignment_expression') {
            const lhs = parent.childForFieldName('left') ?? parent.children[0];
            if (!lhs) return false;
            // Check if current is or is wrapped by the LHS
            let check: Node | null = lhs;
            while (check) {
                if (check.id === current.id || check.id === node.id) return true;
                if (check.type === 'expression' && check.childCount === 1) {
                    check = check.child(0);
                } else break;
            }
            return false;
        }
        return false;
    }
    return false;
}

/**
 * Returns true for composite storage access patterns:
 * mapping[key], struct.field, nested mappings, etc.
 * Skips if the node is a child of another storage access (avoids double-counting).
 */
function isStorageAccess(node: Node): boolean {
    const t = node.type;
    if (t !== 'subscript_expression' && t !== 'array_access'
        && t !== 'member_expression') return false;
    // Skip member_expression for method calls (parent is call_expression)
    if (t === 'member_expression') {
        const parent = node.parent;
        if (parent?.type === 'call_expression') return false;
        // Also skip if wrapped in expression → call_expression
        if (parent?.type === 'expression' && parent.parent?.type === 'call_expression') return false;
    }
    // Skip if nested inside another storage access (only count the outermost)
    let ancestor = node.parent;
    while (ancestor) {
        if (ancestor.type === 'expression') { ancestor = ancestor.parent; continue; }
        if (ancestor.type === 'subscript_expression' || ancestor.type === 'array_access'
            || ancestor.type === 'member_expression') return false;
        break;
    }
    return true;
}

export default createRule();
