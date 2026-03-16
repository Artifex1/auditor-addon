import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-002: Reentrancy — State Write After External Call
 *
 * Detects the classic reentrancy pattern: an external call (.call, .delegatecall,
 * .send, .transfer) is followed by a state write. The external call transfers
 * control to untrusted code, which can re-enter before the state is updated.
 *
 * Deep rule — the walker follows internal call edges so that e.g.
 * withdraw() calls _sendFunds() (external call inside), then writes state.
 *
 * SWC-107
 */
function createRule(): Rule {
    let hasExternalCall = false;
    let callEvidence: { node: Node; file: string } | null = null;
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-002',
        severity: 'critical',
        title: 'State write after external call (reentrancy)',
        description: 'An external call transfers control to untrusted code before state variables are updated. The callee can re-enter the function and exploit the stale state (SWC-107).',
        kind: 'smell',
        deep: { maxDepth: 6 },
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (!hasExternalCall && ctx.trait.isExternalCall(node)) {
                hasExternalCall = true;
                callEvidence = { node, file: ctx.currentFile };
                return;
            }

            if (hasExternalCall && ctx.trait.isStateWrite(node)) {
                findings.push({
                    location: {
                        file: callEvidence!.file,
                        line: callEvidence!.node.startPosition.row + 1,
                        col: callEvidence!.node.startPosition.column,
                    },
                    snippet: `external call → state write: ${truncate(node.text, 80)}`,
                    executionPath: [
                        `${callEvidence!.file}:${callEvidence!.node.startPosition.row + 1}`,
                        `${ctx.currentFile}:${node.startPosition.row + 1}`,
                    ],
                });
            }
        },

        finalize() { return findings; },
        reset() {
            hasExternalCall = false;
            callEvidence = null;
            findings = [];
        },
    };
}

function truncate(s: string, len: number): string {
    return s.length > len ? s.slice(0, len - 3) + '...' : s;
}

export default createRule();
