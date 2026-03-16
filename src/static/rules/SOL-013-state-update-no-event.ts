import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-013: State Update Without Event
 *
 * Public/external functions that write state but never emit an event.
 * Off-chain consumers rely on events to track state changes; missing
 * events make monitoring and indexing unreliable.
 */
function createRule(): Rule {
    let hasStateWrite = false;
    let hasEmit = false;
    let writeNode: { node: Node; file: string } | null = null;
    let inPublicFunction = false;
    let functionDepth = 0;
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-013',
        severity: 'low',
        title: 'State update without event emission',
        description: 'Public/external functions that modify state without emitting events make off-chain monitoring and indexing unreliable. Emit an event for every state change.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity, SupportedLanguage.Cairo, SupportedLanguage.Move],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (ctx.trait.isFunctionDef(node)) {
                functionDepth++;
                if (functionDepth === 1) {
                    hasStateWrite = false;
                    hasEmit = false;
                    writeNode = null;
                    inPublicFunction = ctx.trait.isPublicFn(node);
                }
                return;
            }

            if (functionDepth === 0) return;

            if (!hasStateWrite && ctx.trait.isStateWrite(node)) {
                hasStateWrite = true;
                writeNode = { node, file: ctx.currentFile };
            }

            if (ctx.trait.isEmitStatement(node)) {
                hasEmit = true;
            }
        },

        exit(node: Node, ctx: RuleContext) {
            if (ctx.trait.isFunctionDef(node)) {
                if (functionDepth === 1 && inPublicFunction && hasStateWrite && !hasEmit && writeNode) {
                    findings.push({
                        location: {
                            file: writeNode.file,
                            line: writeNode.node.startPosition.row + 1,
                            col: writeNode.node.startPosition.column,
                        },
                        snippet: `state write without event: ${truncate(writeNode.node.text, 80)}`,
                    });
                }
                functionDepth--;
            }
        },

        finalize() { return findings; },
        reset() {
            hasStateWrite = false;
            hasEmit = false;
            writeNode = null;
            inPublicFunction = false;
            functionDepth = 0;
            findings = [];
        },
    };
}

function truncate(s: string, len: number): string {
    return s.length > len ? s.slice(0, len - 3) + '...' : s;
}

export default createRule();
