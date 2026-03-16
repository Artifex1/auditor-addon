import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * SOL-028: Hash Construction May Miss Struct Fields
 *
 * Detects abi.encode / abi.encodePacked calls where a TYPEHASH constant
 * is the first argument (EIP-712 pattern) and the number of remaining
 * arguments is suspiciously low compared to the struct being hashed.
 *
 * This is a pointer — it cannot definitively know the struct definition
 * but can flag encode calls with few arguments for manual review.
 *
 * Inspired by: reNFT H-01 — rental order hash omitted the rentalWallet
 * field, allowing spoofed orders to match legitimate hashes.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-028',
        severity: 'medium',
        title: 'Hash construction may miss struct fields',
        description: 'An abi.encode call used in hash construction includes a TYPEHASH as first argument (EIP-712 pattern) but has few additional arguments. If the struct has more fields than encode arguments, the hash does not uniquely identify the struct — fields are missing from the commitment.',
        kind: 'pointer',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        enter(node: Node, ctx: RuleContext) {
            if (node.type !== 'call_expression') return;

            // Get function name — field returns expression wrapper in Solidity grammar
            const funcField = node.childForFieldName('function');
            const funcName = funcField ? unwrapExpression(funcField).text : '';

            if (funcName !== 'abi.encode' && funcName !== 'abi.encodePacked') return;

            // Arguments are call_argument children of the call_expression
            const argNodes = node.children.filter(c => c.type === 'call_argument');
            if (argNodes.length === 0) return;

            // Check if first argument looks like a TYPEHASH (EIP-712)
            const firstArgText = argNodes[0].text;
            const isTypehash = /TYPEHASH\b/.test(firstArgText);

            if (!isTypehash) return;

            // Check if this encode is inside a keccak256 call
            let insideKeccak = false;
            let ancestor: Node | null = node.parent;
            while (ancestor) {
                if (ancestor.type === 'expression' || ancestor.type === 'call_argument') {
                    ancestor = ancestor.parent;
                    continue;
                }
                if (ancestor.type === 'call_expression') {
                    const pFunc = ancestor.childForFieldName('function');
                    const pFuncName = pFunc ? unwrapExpression(pFunc).text : '';
                    if (pFuncName === 'keccak256') {
                        insideKeccak = true;
                    }
                }
                break;
            }

            // Only flag if inside keccak256 and the argument count seems low
            const structFieldCount = argNodes.length - 1; // minus the TYPEHASH itself
            if (insideKeccak && structFieldCount > 0 && structFieldCount <= 3) {
                findings.push({
                    location: {
                        file: ctx.currentFile,
                        line: node.startPosition.row + 1,
                        col: node.startPosition.column,
                    },
                    snippet: `EIP-712 hash with only ${structFieldCount} field${structFieldCount === 1 ? '' : 's'} after TYPEHASH — verify all struct fields are included`,
                });
            }
        },

        finalize() { return findings; },
        reset() { findings = []; },
    };
}

function unwrapExpression(node: Node): Node {
    if (node.type === 'expression' && node.childCount === 1) return unwrapExpression(node.child(0)!);
    return node;
}

export default createRule();
