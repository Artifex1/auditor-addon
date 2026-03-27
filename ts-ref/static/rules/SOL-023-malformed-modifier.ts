import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-023: Malformed Modifier (No Enforcement)
 *
 * Detects modifier bodies that evaluate a boolean condition as a bare
 * expression statement without wrapping it in require() or if-revert.
 * This means the condition is evaluated but its result is discarded,
 * providing no access control.
 *
 * Example of the bug:
 *   modifier onlyOwner() { msg.sender == owner; _; }
 * Should be:
 *   modifier onlyOwner() { require(msg.sender == owner); _; }
 *
 * Inspired by: Curves H-05 — onlyOwner modifier evaluated
 * `msg.sender == owner` as a bare expression, never reverting.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-023',
        severity: 'critical',
        title: 'Malformed modifier with no enforcement',
        description: 'A modifier body evaluates a boolean expression as a statement without require() or revert. The condition result is silently discarded, meaning the modifier provides no access control whatsoever.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            // Look for modifier_definition nodes
            if (node.type !== 'modifier_definition') return;

            const body = node.childForFieldName('body');
            if (!body) return;

            // Walk the body's children (statement wrappers) looking for
            // expression_statement containing a bare comparison
            for (const child of body.children) {
                // Solidity grammar: function_body > statement > expression_statement
                const stmtChild = child.type === 'statement' ? child.child(0) : child;
                if (!stmtChild || stmtChild.type !== 'expression_statement') continue;

                // Get the expression inside
                const expr = unwrapExpression(stmtChild);
                if (!expr) continue;

                // Check if it's a comparison expression (==, !=, <, >, <=, >=)
                if (isBareComparison(expr)) {
                    const nameNode = node.childForFieldName('name');
                    const modName = nameNode?.text ?? 'unknown';
                    findings.push({
                        location: {
                            file: ctx.currentFile,
                            line: child.startPosition.row + 1,
                            col: child.startPosition.column,
                        },
                        snippet: `modifier ${modName}: bare comparison "${truncate(expr.text, 60)}" — result discarded, no enforcement`,
                    });
                }
            }
        },

        finalize() { return findings; },
        reset() { findings = []; },
    };
}

function unwrapExpression(node: Node): Node | null {
    if (node.type === 'expression_statement') {
        // The first non-semicolon child
        for (const child of node.children) {
            if (child.type !== ';') return unwrapExpression(child);
        }
        return null;
    }
    if (node.type === 'expression' && node.childCount === 1) {
        return unwrapExpression(node.child(0)!);
    }
    return node;
}

function isBareComparison(node: Node): boolean {
    if (node.type === 'binary_expression') {
        const op = node.childForFieldName('operator');
        if (op && ['==', '!=', '<', '>', '<=', '>='].includes(op.text)) {
            return true;
        }
    }
    // Also catch logical expressions used as bare statements: a && b, a || b
    if (node.type === 'binary_expression') {
        const op = node.childForFieldName('operator');
        if (op && ['&&', '||'].includes(op.text)) {
            return true;
        }
    }
    return false;
}

function truncate(s: string, len: number): string {
    return s.length > len ? s.slice(0, len - 3) + '...' : s;
}

export default createRule();
