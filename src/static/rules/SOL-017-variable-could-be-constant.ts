import { SupportedLanguage } from "../../engine/types.js";
import type { MapRule, FindingInstance, RuleContext, SymbolGraph } from "../../engine/types.js";

/**
 * SOL-017: Variable Could Be Constant
 *
 * State variables that are never written by any function (appear in zero
 * `writesState` sets) and have an initializer could be declared `constant`.
 * Constants are inlined at compile time, saving an SLOAD per access.
 *
 * Skips variables already marked constant or immutable.
 */
function createRule(): MapRule {
    return {
        id: 'SOL-017',
        severity: 'info',
        title: 'State variable could be constant',
        description: 'State variables with an initializer that are never written by any function waste an SLOAD per access. Declare them constant to inline the value at compile time.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        check(graph: SymbolGraph, _ctx: RuleContext): FindingInstance[] {
            const findings: FindingInstance[] = [];

            // Collect all state variables
            const stateVars = [...graph.nodes()].filter(n => n.kind === 'state_variable' && n.status === 'concrete');

            for (const sv of stateVars) {
                // Skip if already constant or immutable (check via has_modifier edges)
                const modEdges = graph.getOutEdgesOfKind(sv.id, 'has_modifier');
                const hasConstOrImmutable = modEdges.some(e => {
                    const mod = graph.getNode(e.to);
                    return mod?.label === 'constant' || mod?.label === 'immutable';
                });
                if (hasConstOrImmutable) continue;

                // Must have an initializer to be promotable to constant
                const hasInitializer = modEdges.some(e => {
                    const mod = graph.getNode(e.to);
                    return mod?.label === 'has_initializer';
                });
                if (!hasInitializer) continue;

                // Check via graph edges: any function with a writes edge to this variable
                const writers = graph.getWriters(sv.id);

                if (writers.length === 0) {
                    findings.push({
                        location: {
                            file: sv.locator?.file ?? '',
                            line: sv.locator?.line ?? 0,
                            col: sv.locator?.column ?? 0,
                        },
                        snippet: `${sv.qualifiedName}: never written — could be constant`,
                    });
                }
            }

            return findings;
        },
    };
}

export default createRule();
