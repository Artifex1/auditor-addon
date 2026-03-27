import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-003: tx.origin Authentication
 *
 * Detects `tx.origin` used in conditions (if, require, assert).
 * tx.origin returns the original sender of the transaction, which can be
 * exploited via phishing contracts. Use msg.sender instead.
 *
 * SWC-115
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-003',
        severity: 'medium',
        title: 'tx.origin used for authentication',
        description: 'Using tx.origin for authorization allows phishing attacks where a malicious contract tricks users into calling it, inheriting their tx.origin identity (SWC-115).',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (node.type !== 'member_expression') return;
            if (node.text !== 'tx.origin') return;

            // Only flag when used in a condition context (require, if, assert)
            if (!isInsideCondition(node)) return;

            findings.push({
                location: {
                    file: ctx.currentFile,
                    line: node.startPosition.row + 1,
                    col: node.startPosition.column,
                },
                snippet: node.text,
            });
        },

        finalize() { return findings; },
        reset() { findings = []; },
    };
}

function isInsideCondition(node: Node): boolean {
    let current = node.parent;
    while (current) {
        // require(...), assert(...)
        if (current.type === 'call_expression') {
            const fn = current.childForFieldName('function');
            if (fn && (fn.text === 'require' || fn.text === 'assert')) return true;
        }
        // if (...)
        if (current.type === 'if_statement') return true;
        // ternary
        if (current.type === 'ternary_expression') return true;
        // Stop at function boundary
        if (current.type === 'function_definition') break;
        current = current.parent;
    }
    return false;
}

export default createRule();
