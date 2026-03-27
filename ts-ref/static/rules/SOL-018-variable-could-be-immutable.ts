import { SupportedLanguage } from "../../engine/types.js";
import type { MapRule, FindingInstance, RuleContext, SymbolGraph } from "../../engine/types.js";

/**
 * SOL-018: Variable Could Be Immutable
 *
 * State variables that are only written in the constructor could be declared
 * `immutable`. Immutables are stored in code, not storage, saving an SLOAD
 * per read after deployment.
 *
 * Skips variables already marked constant or immutable.
 * Skips variables that have an initializer and are never written (those
 * are flagged by SOL-017 as could-be-constant instead).
 */
function createRule(): MapRule {
    return {
        id: 'SOL-018',
        severity: 'info',
        title: 'State variable could be immutable',
        description: 'State variables only written in the constructor waste an SLOAD per read. Declare them immutable to store the value in contract bytecode instead of storage.',
        kind: 'smell',
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],
        },

        check(graph: SymbolGraph, _ctx: RuleContext): FindingInstance[] {
            const findings: FindingInstance[] = [];

            const stateVars = [...graph.nodes()].filter(n => n.kind === 'state_variable' && n.status === 'concrete');

            for (const sv of stateVars) {
                // Skip if already constant or immutable (check via has_modifier edges)
                const modEdges = graph.getOutEdgesOfKind(sv.id, 'has_modifier');
                const hasConstOrImmutable = modEdges.some(e => {
                    const mod = graph.getNode(e.to);
                    return mod?.label === 'constant' || mod?.label === 'immutable';
                });
                if (hasConstOrImmutable) continue;

                // Use graph edges: functions with writes edges to this state variable
                const writers = graph.getWriters(sv.id);

                // If never written and has initializer → SOL-017 territory, skip
                if (writers.length === 0) continue;

                // If ALL writers are constructors → could be immutable
                const allConstructors = writers.every(fn => fn.label === 'constructor');
                if (allConstructors) {
                    findings.push({
                        location: {
                            file: sv.locator?.file ?? '',
                            line: sv.locator?.line ?? 0,
                            col: sv.locator?.column ?? 0,
                        },
                        snippet: `${sv.qualifiedName}: only written in constructor — could be immutable`,
                    });
                }
            }

            return findings;
        },
    };
}

export default createRule();
