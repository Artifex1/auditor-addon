import { SupportedLanguage } from "../../engine/types.js";
import type { NarrowRule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-001: Unchecked Low-Level Call
 *
 * Detects .call(), .delegatecall(), .send() whose return value is discarded.
 * The parent node is an expression_statement (no assignment), meaning the
 * bool success is never checked — the call can silently fail.
 *
 * SWC-104
 */
const rule: NarrowRule = {
    id: 'SOL-001',
    severity: 'high',
    title: 'Unchecked low-level call return value',
    appliesTo: {
        languages: [SupportedLanguage.Solidity],
        domains: ['on-chain'],
    },
    check(ctx: RuleContext, node: Node): FindingInstance | null {
        if (!ctx.trait.isExternalCall(node)) return null;

        // If the call is inside an expression_statement (possibly wrapped in
        // an 'expression' node), the return value is discarded.
        let ancestor = node.parent;
        while (ancestor && ancestor.type === 'expression') {
            ancestor = ancestor.parent;
        }
        if (!ancestor || ancestor.type !== 'expression_statement') return null;

        return {
            location: {
                file: ctx.currentFile,
                line: node.startPosition.row + 1,
                col: node.startPosition.column,
            },
            snippet: node.text.length > 120 ? node.text.slice(0, 117) + '...' : node.text,
        };
    },
};

export default rule;
