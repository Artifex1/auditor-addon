import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-027: Inconsistent Validation vs. Assignment
 *
 * Detects patterns where an if-guard validates against one expression
 * (e.g. block.timestamp + duration) but the subsequent assignment uses
 * a different base (e.g. lastLockTime + duration). This mismatch lets
 * users bypass the validation because the guard and the state change
 * don't agree on the computed value.
 *
 * Pattern: within a for/if block, the condition contains `A + X`
 * compared to some value, then the body assigns `B + X` (different base).
 *
 * This is a pointer — the pattern has legitimate uses but warrants review.
 *
 * Inspired by: Munchables H-02 — validation checked
 * `block.timestamp + _duration < unlockTime` but then set
 * `unlockTime = lastLockTime + _duration`, allowing lock bypass.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-027',
        severity: 'medium',
        title: 'Inconsistent validation vs. assignment',
        description: 'An if-guard validates using one expression (e.g. block.timestamp + duration) but the following assignment uses a different base (e.g. lastLockTime + duration). The validation can be bypassed because the guard and the state change compute different values.',
        kind: 'pointer',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (node.type !== 'if_statement') return;

            // Solidity grammar: condition is wrapped in expression, body in statement
            const conditionRaw = node.childForFieldName('condition');
            const condition = conditionRaw ? unwrapExpr(conditionRaw) : null;
            const bodyRaw = node.childForFieldName('body') ?? node.childForFieldName('consequence');
            // Unwrap statement wrapper to get block_statement
            const body = bodyRaw?.type === 'statement' ? bodyRaw.child(0) : bodyRaw;
            if (!condition || !body) return;

            // Find the enclosing block (function_body or block_statement) to check sibling statements
            let blockParent: Node | null = node.parent;
            while (blockParent && blockParent.type !== 'function_body' && blockParent.type !== 'block_statement') {
                blockParent = blockParent.parent;
            }
            if (!blockParent) return;

            // Extract addition expressions from condition: look for A + B patterns
            const condAdditions = extractAdditions(condition);
            if (condAdditions.length === 0) return;

            // Extract assignment RHS additions from body AND siblings after the if
            const bodyAssignments: Addition[] = [];
            extractAssignmentAdditions(body, bodyAssignments);
            // Also check sibling statements after the if_statement in the enclosing block
            if (blockParent) {
                let foundIf = false;
                for (const sibling of blockParent.children) {
                    // Match by checking if the sibling contains our if_statement
                    if (!foundIf && containsNode(sibling, node)) { foundIf = true; continue; }
                    if (foundIf) {
                        extractAssignmentAdditions(sibling, bodyAssignments);
                    }
                }
            }
            if (bodyAssignments.length === 0) return;

            // Check if any condition addition shares an operand with an assignment
            // but differs in the other operand
            for (const condAdd of condAdditions) {
                for (const assign of bodyAssignments) {
                    // Find shared operand
                    if (condAdd.left === assign.left && condAdd.right === assign.right) continue; // identical, fine
                    if (condAdd.left === assign.right && condAdd.right === assign.left) continue; // commutative, fine

                    // Check if they share exactly one operand but differ on the other
                    const sharedRight = condAdd.right === assign.right;
                    const sharedLeft = condAdd.left === assign.left;

                    if (sharedRight && !sharedLeft && condAdd.left !== assign.left) {
                        findings.push({
                            location: {
                                file: ctx.currentFile,
                                line: condition.startPosition.row + 1,
                                col: condition.startPosition.column,
                            },
                            snippet: `guard checks "${condAdd.left} + ${condAdd.right}" but assigns "${assign.left} + ${assign.right}" — different base in validation vs. state change`,
                        });
                    }
                    if (sharedLeft && !sharedRight && condAdd.right !== assign.right) {
                        findings.push({
                            location: {
                                file: ctx.currentFile,
                                line: condition.startPosition.row + 1,
                                col: condition.startPosition.column,
                            },
                            snippet: `guard checks "${condAdd.left} + ${condAdd.right}" but assigns "${assign.left} + ${assign.right}" — different term in validation vs. state change`,
                        });
                    }
                }
            }
        },

        finalize() { return findings; },
        reset() { findings = []; },
    };
}

function containsNode(haystack: Node, needle: Node): boolean {
    if (haystack.id === needle.id) return true;
    for (const child of haystack.children) {
        if (containsNode(child, needle)) return true;
    }
    return false;
}

interface Addition {
    left: string;
    right: string;
}

function unwrapExpr(node: Node): Node {
    if (node.type === 'expression' && node.childCount === 1) return unwrapExpr(node.child(0)!);
    return node;
}

function extractAdditions(node: Node): Addition[] {
    const results: Addition[] = [];
    collectAdditions(node, results);
    return results;
}

function collectAdditions(node: Node, results: Addition[]): void {
    const unwrapped = unwrapExpr(node);
    if (unwrapped.type === 'binary_expression') {
        const op = unwrapped.childForFieldName('operator');
        if (op && op.text === '+') {
            const left = unwrapped.childForFieldName('left');
            const right = unwrapped.childForFieldName('right');
            if (left && right) {
                results.push({ left: normalizeExpr(left), right: normalizeExpr(right) });
            }
        }
    }
    for (const child of unwrapped.children) {
        collectAdditions(child, results);
    }
}

function extractAssignmentAdditions(node: Node, results: Addition[]): void {
    // Unwrap statement, expression_statement, expression wrappers
    let unwrapped = node;
    if (unwrapped.type === 'statement' && unwrapped.childCount === 1) unwrapped = unwrapped.child(0)!;
    if (unwrapped.type === 'expression_statement') {
        for (const child of unwrapped.children) {
            extractAssignmentAdditions(child, results);
        }
        return;
    }
    unwrapped = unwrapExpr(unwrapped);
    if (unwrapped.type === 'assignment_expression') {
        // Look for additions on the RHS
        const rhs = unwrapped.childForFieldName('right');
        if (rhs) collectAdditions(rhs, results);
    }
    for (const child of unwrapped.children) {
        extractAssignmentAdditions(child, results);
    }
}

function normalizeExpr(node: Node): string {
    const unwrapped = unwrapExpr(node);
    // Strip type casts like uint32(...) to get the inner expression
    if (unwrapped.type === 'type_cast_expression') {
        // Get the expression argument (last child that isn't type or parens)
        for (const child of unwrapped.children) {
            if (child.type === 'expression' || child.type === 'parenthesized_expression') {
                return normalizeExprText(child.text);
            }
        }
    }
    return normalizeExprText(unwrapped.text);
}

function normalizeExprText(text: string): string {
    text = text.trim();
    const castMatch = text.match(/^(?:uint\d*|int\d*)\((.+)\)$/);
    if (castMatch) text = castMatch[1].trim();
    return text;
}

export default createRule();
