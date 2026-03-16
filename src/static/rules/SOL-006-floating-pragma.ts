import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-006: Floating Pragma
 *
 * Detects pragma directives with `^`, `<`, `>`, `>=`, `<=` operators.
 * Non-pinned pragmas allow compilation with different compiler versions,
 * which may introduce bugs or inconsistent behaviour.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-006',
        severity: 'info',
        title: 'Floating pragma version',
        description: 'A floating pragma (^0.8.0) allows compilation with any compatible compiler version, risking inconsistent behavior across deployments. Pin to a specific version.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (node.type !== 'pragma_directive') return;

            const text = node.text;
            // Match: pragma solidity ^0.8.0; or pragma solidity >=0.8.0 <0.9.0;
            if (/pragma\s+solidity\s+[^;]*[\^<>]/.test(text)) {
                findings.push({
                    location: {
                        file: ctx.currentFile,
                        line: node.startPosition.row + 1,
                        col: node.startPosition.column,
                    },
                    snippet: text.replace(/\s+/g, ' ').trim(),
                });
            }
        },

        finalize() { return findings; },
        reset() { findings = []; },
    };
}

export default createRule();
