import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * GEN-001: Constant Not UPPER_CASE
 *
 * Constants/immutables should follow UPPER_CASE naming convention.
 * Detects constant declarations where the name isn't all-caps with underscores.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];

    const CONSTANT_NODE_TYPES = new Set([
        'state_variable_declaration',   // Solidity (with constant/immutable keyword)
        'const_item',                   // Rust, Cairo
        'const_declaration',            // Go
        'constant_declaration',         // Tolk
        'constant_decl',               // Move
        'field_declaration',            // Java (final static)
    ]);

    const UPPER_CASE_RE = /^[A-Z][A-Z0-9_]*$/;

    return {
        id: 'GEN-001',
        severity: 'info',
        title: 'Constant not in UPPER_CASE',
        description: 'Constants not following UPPER_SNAKE_CASE naming convention reduce readability and make it harder to distinguish constants from mutable variables.',
        kind: 'smell',
        appliesTo: {
            languages: [
                SupportedLanguage.Solidity,
                SupportedLanguage.Rust,
                SupportedLanguage.Cairo,
                SupportedLanguage.Go,
                SupportedLanguage.Move,
                SupportedLanguage.Java,
                SupportedLanguage.Cpp,
                SupportedLanguage.Tolk,
            ],
        },

        enter(node: Node, ctx: RuleContext) {
            if (!CONSTANT_NODE_TYPES.has(node.type)) return;

            // Solidity: state_variable_declaration with constant or immutable keyword
            if (node.type === 'state_variable_declaration') {
                const text = node.text.split('{')[0];
                if (!text.includes('constant') && !text.includes('immutable')) return;
                const nameNode = node.childForFieldName('name')
                    ?? node.children.find(c => c.type === 'identifier');
                if (!nameNode) return;
                checkName(nameNode, ctx, findings);
                return;
            }

            // Rust/Cairo: const_item
            if (node.type === 'const_item') {
                const nameNode = node.childForFieldName('name')
                    ?? node.children.find(c => c.type === 'identifier');
                if (!nameNode) return;
                checkName(nameNode, ctx, findings);
                return;
            }

            // Go/JS/TS: const_declaration — check each declarator
            if (node.type === 'const_declaration') {
                for (const child of node.children) {
                    if (child.type === 'variable_declarator' || child.type === 'const_spec') {
                        const nameNode = child.childForFieldName('name')
                            ?? child.children.find(c => c.type === 'identifier');
                        if (nameNode) checkName(nameNode, ctx, findings);
                    }
                }
                return;
            }

            // Tolk: constant_declaration, Move: constant_decl
            if (node.type === 'constant_declaration' || node.type === 'constant_decl') {
                const nameNode = node.childForFieldName('name')
                    ?? node.children.find(c => c.type === 'identifier');
                if (!nameNode) return;
                checkName(nameNode, ctx, findings);
                return;
            }

            // Java: field_declaration with final static
            if (node.type === 'field_declaration') {
                const modText = node.children.find(c => c.type === 'modifiers')?.text ?? '';
                if (!modText.includes('final') || !modText.includes('static')) return;
                const declarator = node.children.find(c => c.type === 'variable_declarator');
                const nameNode = declarator?.childForFieldName('name')
                    ?? declarator?.children.find(c => c.type === 'identifier');
                if (!nameNode) return;
                checkName(nameNode, ctx, findings);
            }
        },

        finalize() { return findings; },
        reset() { findings = []; },
    };

    function checkName(nameNode: Node, ctx: RuleContext, findings: FindingInstance[]) {
        const name = nameNode.text;
        if (!UPPER_CASE_RE.test(name)) {
            findings.push({
                location: {
                    file: ctx.currentFile,
                    line: nameNode.startPosition.row + 1,
                    col: nameNode.startPosition.column,
                },
                snippet: `constant '${name}' should be UPPER_CASE`,
            });
        }
    }
}

export default createRule();
