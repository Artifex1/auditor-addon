import { SupportedLanguage } from "../../engine/types.js";
import type { MapRule, FindingInstance, RuleContext, SymbolGraph } from "../../engine/types.js";

/**
 * MAP-002: Unused Function
 *
 * Internal/private functions that appear in zero callers' callee lists.
 * Excludes constructors, fallback/receive (Solidity-specific entry points).
 *
 * Applies to all languages — every adapter populates visibility.
 */
function createRule(): MapRule {
    return {
        id: 'MAP-002',
        severity: 'info',
        title: 'Unused internal/private function',
        description: 'Internal or private functions with zero callers are dead code. They increase contract size and deployment cost without providing value.',
        kind: 'smell',
        appliesTo: {
            languages: [
                SupportedLanguage.Solidity,
                SupportedLanguage.Cairo,
                SupportedLanguage.Move,
                SupportedLanguage.Rust,
                SupportedLanguage.Go,
                SupportedLanguage.Java,
                SupportedLanguage.Cpp,
                SupportedLanguage.TypeScript,
                SupportedLanguage.JavaScript,
                SupportedLanguage.Tsx,
                SupportedLanguage.Flow,
                SupportedLanguage.Python,
                SupportedLanguage.Noir,
                SupportedLanguage.Compact,
                SupportedLanguage.Tolk,
                SupportedLanguage.Masm,
            ],
        },

        check(graph: SymbolGraph, _ctx: RuleContext): FindingInstance[] {
            const findings: FindingInstance[] = [];

            for (const node of graph.nodes()) {
                if (node.kind !== 'function') continue;
                if (node.status !== 'concrete') continue;
                if (node.visibility !== 'internal' && node.visibility !== 'private') continue;

                // Exclude constructors, fallback, receive
                if (['constructor', 'fallback', 'receive'].includes(node.label)) continue;

                // Use graph edge query: any incoming calls edge means the function is used
                const callers = graph.getInEdgesOfKind(node.id, 'calls');
                if (callers.length === 0) {
                    findings.push({
                        location: {
                            file: node.locator?.file ?? '',
                            line: node.locator?.line ?? 0,
                            col: node.locator?.column ?? 0,
                        },
                        snippet: `${node.qualifiedName}: internal/private with no callers`,
                    });
                }
            }

            return findings;
        },
    };
}

export default createRule();
