import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-005: Unchecked ERC20 Transfer
 *
 * Detects `transfer()` and `transferFrom()` calls on ERC20 tokens where the
 * boolean return value is discarded (expression_statement context, no assignment).
 * Some ERC20 tokens return false on failure instead of reverting.
 *
 * Note: `payable(...).transfer(amount)` (ETH transfer) is excluded — it is a
 * payable_conversion_expression in the grammar, not a regular call.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-005',
        severity: 'high',
        title: 'Unchecked ERC20 transfer return value',
        description: 'ERC-20 transfer/transferFrom may return false instead of reverting on failure. Not checking the return value can lead to silent token transfer failures.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (node.type !== 'call_expression') return;

            const fnRaw = node.childForFieldName('function');
            const fn = unwrapExpression(fnRaw);
            if (!fn || fn.type !== 'member_expression') return;

            const method = fn.childForFieldName('property');
            if (!method) return;

            const methodName = method.text;
            if (methodName !== 'transfer' && methodName !== 'transferFrom') return;

            // Exclude payable(...).transfer(amount) — the object would be
            // a payable_conversion_expression, not a regular call
            const object = unwrapExpression(fn.childForFieldName('object'));
            if (object && object.type === 'payable_conversion_expression') return;

            // Check argument count via call_argument children
            const argCount = node.children.filter(c => c.type === 'call_argument').length;
            if (methodName === 'transfer' && argCount !== 2) return;
            if (methodName === 'transferFrom' && argCount !== 3) return;

            // Return value must be discarded — parent is expression_statement
            let ancestor = node.parent;
            while (ancestor && ancestor.type === 'expression') {
                ancestor = ancestor.parent;
            }
            if (!ancestor || ancestor.type !== 'expression_statement') return;

            findings.push({
                location: {
                    file: ctx.currentFile,
                    line: node.startPosition.row + 1,
                    col: node.startPosition.column,
                },
                snippet: node.text.length > 120 ? node.text.slice(0, 117) + '...' : node.text,
            });
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

export default createRule();
