import type { Rule, FindingInstance, RuleContext } from "../../../../src/engine/types.js";
import type { Node } from "web-tree-sitter";

// Custom rule fixture for e2e testing.
// Flags any use of require() — a trivially detectable pattern in the test contract.
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    return {
        id: 'CUSTOM-001',
        severity: 'low',
        title: 'Custom: require statement detected',
        description: 'Test custom rule — flags require() calls.',
        kind: 'smell',
        appliesTo: { languages: ['solidity'] as any },

        enter(node: Node, ctx: RuleContext) {
            if (node.type !== 'call_expression') return;
            const fn = node.childForFieldName('function');
            if (!fn || fn.text !== 'require') return;
            findings.push({
                location: {
                    file: ctx.currentFile,
                    line: node.startPosition.row + 1,
                    col: node.startPosition.column,
                },
                snippet: node.text.slice(0, 80),
            });
        },

        finalize() { return findings; },
        reset() { findings = []; },
    };
}

export default createRule();
