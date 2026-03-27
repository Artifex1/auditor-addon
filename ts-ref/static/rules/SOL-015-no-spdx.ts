import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-015: No SPDX License Identifier
 *
 * Solidity source files should include an SPDX license identifier comment:
 * // SPDX-License-Identifier: MIT
 *
 * Compiler warns if missing; best practice for open-source compliance.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];
    let foundSpdx = false;

    return {
        id: 'SOL-015',
        severity: 'info',
        title: 'Missing SPDX license identifier',
        description: 'Solidity files without an SPDX-License-Identifier comment trigger compiler warnings and make license compliance harder to verify.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            // Only check the root source_file node
            if (node.type !== 'source_file') return;

            const src = ctx.sourceFiles.get(ctx.currentFile);
            if (!src) return;

            foundSpdx = /SPDX-License-Identifier/.test(src);

            if (!foundSpdx) {
                findings.push({
                    location: {
                        file: ctx.currentFile,
                        line: 1,
                        col: 0,
                    },
                    snippet: 'Missing SPDX-License-Identifier comment',
                });
            }
        },

        finalize() { return findings; },
        reset() { findings = []; foundSpdx = false; },
    };
}

export default createRule();
