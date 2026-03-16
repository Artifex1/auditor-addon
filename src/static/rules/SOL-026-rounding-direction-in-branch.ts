import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-026: Rounding Direction in Branch Condition
 *
 * Detects if/ternary conditions that use mulFloor/mulDiv/divFloor to
 * decide between two code paths. When a branch condition rounds in one
 * direction, an attacker can often craft inputs that land on the wrong
 * side of the boundary — the rounding direction should be chosen to
 * favor the more conservative branch.
 *
 * This is a pointer — it flags the pattern for human review rather than
 * asserting a specific fix.
 *
 * Inspired by: Abracadabra H-02 — mulFloor in a branch condition
 * allowed an attacker to amplify a 1-wei rounding error into a 2x
 * price invariant violation.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    const ROUNDING_FUNCTIONS = /\b(mulFloor|mulDiv|divFloor|mulDivDown|mulDivUp|mulCeil|divCeil|fullMulDiv|fullMulDivUp)\b/;

    return {
        id: 'SOL-026',
        severity: 'medium',
        title: 'Rounding function in branch condition',
        description: 'A branch condition (if/ternary) uses a rounding arithmetic function (mulFloor, mulDiv, divFloor, etc.). The rounding direction determines which code path executes at boundary values — verify the direction favors the conservative/safe branch.',
        kind: 'pointer',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            // Check if_statement conditions
            if (node.type === 'if_statement') {
                const condition = node.childForFieldName('condition');
                if (condition && ROUNDING_FUNCTIONS.test(condition.text)) {
                    findings.push({
                        location: {
                            file: ctx.currentFile,
                            line: condition.startPosition.row + 1,
                            col: condition.startPosition.column,
                        },
                        snippet: `rounding in branch: ${truncate(condition.text, 100)} — verify rounding direction favors safe path`,
                    });
                }
                return;
            }

            // Check ternary_expression conditions
            if (node.type === 'ternary_expression' || node.type === 'conditional_expression') {
                const condition = node.childForFieldName('condition') ?? node.child(0);
                if (condition && ROUNDING_FUNCTIONS.test(condition.text)) {
                    findings.push({
                        location: {
                            file: ctx.currentFile,
                            line: condition.startPosition.row + 1,
                            col: condition.startPosition.column,
                        },
                        snippet: `rounding in ternary: ${truncate(condition.text, 100)} — verify rounding direction`,
                    });
                }
            }
        },

        finalize() { return findings; },
        reset() { findings = []; },
    };
}

function truncate(s: string, len: number): string {
    return s.length > len ? s.slice(0, len - 3) + '...' : s;
}

export default createRule();
