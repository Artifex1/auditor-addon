import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-022: Missing Access Control on Setter
 *
 * Detects public/external functions that write state but have no access
 * control modifiers (onlyOwner, onlyRole, onlyAdmin, auth, etc.) and
 * no require/if-revert checking msg.sender.
 *
 * Inspired by: Curves H-04 — setCurves() was public with no access
 * control, allowing anyone to replace the curves contract address.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];
    let functionDepth = 0;
    let currentFuncNode: Node | null = null;
    let currentFile = '';
    let isPublicOrExternal = false;
    let hasStateWrite = false;
    let hasAccessControl = false;
    let writeNode: Node | null = null;

    const ACCESS_MODIFIERS = /\b(onlyOwner|onlyRole|onlyAdmin|auth|onlyGovernance|onlyManager|onlyOperator|onlyMinter|requiresAuth|onlyController|onlyGuardian|onlyKeeper|whenNotPaused|initializer|onlyProxy|onlyDelegateCall)\b/;
    const SENDER_CHECK = /msg\.sender/;

    return {
        id: 'SOL-022',
        severity: 'medium',
        title: 'Missing access control on state-modifying function',
        description: 'A public or external function writes state but has no access-control modifier (onlyOwner, onlyRole, etc.) and no msg.sender check. Any address can call it, which may allow unauthorized state changes.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (ctx.trait.isFunctionDef(node)) {
                functionDepth++;
                if (functionDepth === 1) {
                    currentFuncNode = node;
                    currentFile = ctx.currentFile;
                    const name = ctx.trait.getFunctionName(node) ?? '';
                    // Skip constructors, fallback, receive
                    if (name === 'constructor' || name === 'fallback' || name === 'receive' || name === '') {
                        isPublicOrExternal = false;
                        return;
                    }
                    isPublicOrExternal = ctx.trait.isPublicFn(node);
                    hasStateWrite = false;
                    hasAccessControl = false;
                    writeNode = null;

                    // Check for access control modifiers in the function signature
                    const funcText = node.text;
                    // Check the portion before the function body
                    const bodyStart = funcText.indexOf('{');
                    const sigText = bodyStart > 0 ? funcText.slice(0, bodyStart) : funcText;
                    if (ACCESS_MODIFIERS.test(sigText)) {
                        hasAccessControl = true;
                    }

                    // Check for view/pure — these can't write state
                    if (/\b(view|pure)\b/.test(sigText)) {
                        isPublicOrExternal = false;
                    }
                }
                return;
            }

            if (functionDepth !== 1 || !isPublicOrExternal || hasAccessControl) return;

            // Track state writes
            if (!hasStateWrite && ctx.trait.isStateWrite(node)) {
                hasStateWrite = true;
                writeNode = node;
            }

            // Track msg.sender checks (require, if-revert patterns)
            if (node.type === 'call_expression' || node.type === 'binary_expression' || node.type === 'require_statement') {
                if (SENDER_CHECK.test(node.text)) {
                    hasAccessControl = true;
                }
            }
            // Also check if statements that reference msg.sender
            if (node.type === 'if_statement') {
                const condition = node.childForFieldName('condition');
                if (condition && SENDER_CHECK.test(condition.text)) {
                    hasAccessControl = true;
                }
            }
        },

        exit(node: Node, ctx: RuleContext) {
            if (ctx.trait.isFunctionDef(node)) {
                if (functionDepth === 1 && isPublicOrExternal && hasStateWrite && !hasAccessControl && writeNode) {
                    const funcName = ctx.trait.getFunctionName(currentFuncNode!) ?? 'unknown';
                    findings.push({
                        location: {
                            file: currentFile,
                            line: currentFuncNode!.startPosition.row + 1,
                            col: currentFuncNode!.startPosition.column,
                        },
                        snippet: `${funcName}: writes state without access control`,
                    });
                }
                functionDepth--;
            }
        },

        finalize() { return findings; },
        reset() {
            findings = [];
            functionDepth = 0;
            currentFuncNode = null;
            currentFile = '';
            isPublicOrExternal = false;
            hasStateWrite = false;
            hasAccessControl = false;
            writeNode = null;
        },
    };
}

export default createRule();
