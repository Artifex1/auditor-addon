import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-019: Missing Nonce in Signature Verification
 *
 * Detects ECDSA.recover / ecrecover usage where the hash being verified
 * does not include a nonce or state-mutating counter, enabling signature
 * replay attacks.
 *
 * Pattern: function contains ecrecover/ECDSA.recover AND the preceding
 * abi.encodePacked/abi.encode hash construction does not reference a
 * nonce-like variable.
 *
 * Inspired by: Taiko H-05 — signatures replayed in withdraw() because
 * the signed hash was a static message with no nonce.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    // Track per-function: did we see a recover call, and did we see nonce usage nearby
    let inFunction = false;
    let functionDepth = 0;
    let recoverNode: { node: Node; file: string } | null = null;
    let hashArgNodes: Node[] = [];
    let hasNonceLikeRef = false;

    const NONCE_PATTERNS = /\b(nonce|nonces|_nonce|nonceOf|userNonce|seqNum|sequence|counter|salt)\b/i;
    const RECOVER_METHODS = ['recover', 'tryRecover'];

    return {
        id: 'SOL-019',
        severity: 'high',
        title: 'Missing nonce in signature verification',
        description: 'ECDSA.recover or ecrecover verifies a hash that does not include a nonce or sequence counter. Without replay protection, the same signature can be reused to execute the action multiple times.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (ctx.trait.isFunctionDef(node)) {
                functionDepth++;
                if (functionDepth === 1) {
                    inFunction = true;
                    recoverNode = null;
                    hashArgNodes = [];
                    hasNonceLikeRef = false;
                }
                return;
            }

            if (!inFunction || functionDepth !== 1) return;

            // Detect ecrecover(hash, v, r, s) or ECDSA.recover(hash, sig)
            if (node.type === 'call_expression') {
                const funcPart = node.childForFieldName('function');
                if (!funcPart) return;
                const text = funcPart.text;
                if (text === 'ecrecover' || RECOVER_METHODS.some(m => text.endsWith(`.${m}`))) {
                    recoverNode = { node, file: ctx.currentFile };
                }
            }

            // Detect abi.encode / abi.encodePacked / keccak256 args
            if (node.type === 'call_expression') {
                const funcPart = node.childForFieldName('function');
                if (!funcPart) return;
                const text = funcPart.text;
                if (text === 'abi.encode' || text === 'abi.encodePacked' || text === 'keccak256') {
                    hashArgNodes.push(node);
                }
            }

            // Track any nonce-like identifier reference
            if (node.type === 'identifier' && NONCE_PATTERNS.test(node.text)) {
                hasNonceLikeRef = true;
            }
            if (node.type === 'member_expression' || node.type === 'member_access_expression') {
                if (NONCE_PATTERNS.test(node.text)) {
                    hasNonceLikeRef = true;
                }
            }
        },

        exit(node: Node, ctx: RuleContext) {
            if (ctx.trait.isFunctionDef(node)) {
                if (functionDepth === 1 && recoverNode && !hasNonceLikeRef) {
                    findings.push({
                        location: {
                            file: recoverNode.file,
                            line: recoverNode.node.startPosition.row + 1,
                            col: recoverNode.node.startPosition.column,
                        },
                        snippet: `signature verification without nonce: ${truncate(recoverNode.node.text, 100)}`,
                    });
                }
                functionDepth--;
                if (functionDepth === 0) inFunction = false;
            }
        },

        finalize() { return findings; },
        reset() {
            findings = [];
            inFunction = false;
            functionDepth = 0;
            recoverNode = null;
            hashArgNodes = [];
            hasNonceLikeRef = false;
        },
    };
}

function truncate(s: string, len: number): string {
    return s.length > len ? s.slice(0, len - 3) + '...' : s;
}

export default createRule();
