import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-011: Division Before Multiplication (Precision Loss)
 *
 * Detects `(a / b) * c` patterns where a division result is subsequently
 * multiplied. In integer arithmetic, dividing first truncates the result,
 * causing precision loss. Multiply before dividing: `(a * c) / b`.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-011',
        severity: 'medium',
        title: 'Division before multiplication (precision loss)',
        description: 'In integer arithmetic, dividing before multiplying truncates the intermediate result, causing precision loss. Reorder to multiply first: (a * c) / b.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (node.type !== 'binary_expression') return;

            const op = node.childForFieldName('operator');
            if (!op || op.text !== '*') return;

            const left = unwrapExpression(node.childForFieldName('left'));
            if (!left) return;

            if (containsDivision(left)) {
                findings.push({
                    location: {
                        file: ctx.currentFile,
                        line: node.startPosition.row + 1,
                        col: node.startPosition.column,
                    },
                    snippet: node.text.length > 120 ? node.text.slice(0, 117) + '...' : node.text,
                });
            }
        },

        finalize() { return findings; },
        reset() { findings = []; },
    };
}

function unwrapExpression(node: Node | null): Node | null {
    if (!node) return null;
    if (node.type === 'expression' && node.childCount === 1) return unwrapExpression(node.child(0));
    return node;
}

/** Check if a node is or contains a binary_expression with `/` operator. */
function containsDivision(node: Node): boolean {
    if (node.type === 'binary_expression') {
        const op = node.childForFieldName('operator');
        if (op && op.text === '/') return true;
    }
    // Unwrap parenthesized_expression and expression wrappers
    if (node.type === 'parenthesized_expression' || node.type === 'expression') {
        for (const child of node.children) {
            if (containsDivision(child)) return true;
        }
    }
    return false;
}

export default createRule();
