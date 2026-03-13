import { SupportedLanguage } from "../../engine/types.js";
import type { PathRule, FindingInstance, PhaseState, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-002: Reentrancy — State Write After External Call
 *
 * Detects the classic reentrancy pattern: an external call (.call, .delegatecall,
 * .send, .transfer) is followed by a state write. The external call transfers
 * control to untrusted code, which can re-enter before the state is updated.
 *
 * Two phases:
 *   1. External call (isExternalCall)
 *   2. State write after the external call (isStateWrite)
 *
 * Scope is cross-function so the walker follows internal call edges —
 * e.g., withdraw() calls _sendFunds() (external call inside), then writes state.
 *
 * SWC-107
 */
const rule: PathRule = {
    id: 'SOL-002',
    severity: 'critical',
    title: 'State write after external call (reentrancy)',
    scope: 'cross-function',
    maxDepth: 6,
    appliesTo: {
        languages: [SupportedLanguage.Solidity],
        domains: ['on-chain'],
    },
    phases: [
        {
            id: 'external-call',
            description: 'An external call that transfers control to untrusted code',
            condition(node: Node, ctx: RuleContext, _state: PhaseState): boolean {
                return ctx.trait.isExternalCall(node);
            },
        },
        {
            id: 'state-write',
            description: 'A state write occurring after the external call',
            condition(node: Node, ctx: RuleContext, _state: PhaseState): boolean {
                return ctx.trait.isStateWrite(node);
            },
            onEnter(node: Node, state: PhaseState): PhaseState {
                return {
                    ...state,
                    writtenVar: ctx_getWrittenVar(node),
                };
            },
        },
    ],
    buildFinding(state: PhaseState, ctx: RuleContext): FindingInstance {
        const callEvidence = state.evidence[0];
        const writeEvidence = state.evidence[1];
        const path = state.evidence.map(e => `${e.file}:${e.node.startPosition.row + 1}`);
        return {
            location: {
                file: callEvidence?.file ?? ctx.currentFile,
                line: (callEvidence?.node.startPosition.row ?? 0) + 1,
                col: callEvidence?.node.startPosition.column ?? 0,
            },
            snippet: writeEvidence
                ? `external call → state write: ${truncate(writeEvidence.node.text, 80)}`
                : 'state write after external call',
            executionPath: path,
        };
    },
};

/** Extract written variable name from an assignment node */
function ctx_getWrittenVar(node: Node): string | null {
    if (node.type !== 'assignment_expression') return null;
    return node.childForFieldName('left')?.text ?? null;
}

function truncate(s: string, len: number): string {
    return s.length > len ? s.slice(0, len - 3) + '...' : s;
}

export default rule;
