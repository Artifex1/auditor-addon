import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-016: Lack of Security Contact
 *
 * Solidity contracts should include a `@custom:security-contact` NatSpec
 * annotation so that security researchers can responsibly disclose
 * vulnerabilities.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];
    let foundContact = false;

    return {
        id: 'SOL-016',
        severity: 'info',
        title: 'Missing @custom:security-contact',
        description: 'Contracts without a @custom:security-contact NatSpec tag make it difficult for security researchers to report vulnerabilities responsibly.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (node.type !== 'source_file') return;

            const src = ctx.sourceFiles.get(ctx.currentFile);
            if (!src) return;

            foundContact = /@custom:security-contact/.test(src);

            if (!foundContact) {
                findings.push({
                    location: {
                        file: ctx.currentFile,
                        line: 1,
                        col: 0,
                    },
                    snippet: 'Missing @custom:security-contact NatSpec annotation',
                });
            }
        },

        finalize() { return findings; },
        reset() { findings = []; foundContact = false; },
    };
}

export default createRule();
