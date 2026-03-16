import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

/**
 * GEN-002: Duplicated Import
 *
 * Detects when the same import path appears more than once in a file.
 */
function createRule(): Rule {
    let findings: FindingInstance[] = [];
    let importPaths: Map<string, Node> = new Map();

    const IMPORT_NODE_TYPES = new Set([
        'import_directive',          // Solidity, Tolk
        'import_statement',          // JS/TS/TSX/Flow, Python
        'import_from_statement',     // Python (from x import y)
        'import_declaration',        // Go, Java
        'use_declaration',           // Rust, Cairo
        'use_decl',                  // Move
        'use_item',                  // Noir
        'preproc_include',           // C++
    ]);

    return {
        id: 'GEN-002',
        severity: 'info',
        title: 'Duplicated import path',
        description: 'Importing the same module path more than once adds noise, can cause confusion about which import is active, and may mask circular dependency issues.',
        kind: 'smell',
        appliesTo: {
            languages: [
                SupportedLanguage.Solidity,
                SupportedLanguage.JavaScript,
                SupportedLanguage.TypeScript,
                SupportedLanguage.Tsx,
                SupportedLanguage.Flow,
                SupportedLanguage.Python,
                SupportedLanguage.Go,
                SupportedLanguage.Java,
                SupportedLanguage.Rust,
                SupportedLanguage.Cairo,
                SupportedLanguage.Move,
                SupportedLanguage.Noir,
                SupportedLanguage.Cpp,
                SupportedLanguage.Tolk,
            ],
        },

        enter(node: Node, ctx: RuleContext) {
            if (!IMPORT_NODE_TYPES.has(node.type)) return;

            // Extract the import path string
            const pathText = extractImportPath(node);
            if (!pathText) return;

            if (importPaths.has(pathText)) {
                findings.push({
                    location: {
                        file: ctx.currentFile,
                        line: node.startPosition.row + 1,
                        col: node.startPosition.column,
                    },
                    snippet: `duplicate import: ${pathText}`,
                });
            } else {
                importPaths.set(pathText, node);
            }
        },

        finalize() { return findings; },
        reset() { findings = []; importPaths = new Map(); },
    };
}

function extractImportPath(node: Node): string | null {
    // Try string_literal child first (most languages)
    for (const child of node.children) {
        if (child.type === 'string_literal' || child.type === 'string'
            || child.type === 'interpreted_string_literal'
            || child.type === 'import_path') {
            return child.text.replace(/['"]/g, '');
        }
    }
    // Fallback: use full text minus keywords
    const text = node.text
        .replace(/^(import|use|from|include|#include)\s+/, '')
        .replace(/;$/, '')
        .trim();
    return text || null;
}

export default createRule();
