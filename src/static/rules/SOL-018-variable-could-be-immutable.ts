import { SupportedLanguage } from "../../engine/types.js";
import type { MapRule, FindingInstance, RuleContext, SymbolMap } from "../../engine/types.js";

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

        check(symbolMap: SymbolMap, _ctx: RuleContext): FindingInstance[] {
            const findings: FindingInstance[] = [];

            const stateVars = [...symbolMap.values()].filter(e => e.kind === 'state_variable');
            const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

            for (const sv of stateVars) {
                // Skip if already constant or immutable
                if (sv.modifiers.some(m => m.name === 'constant' || m.name === 'immutable')) continue;

                const varName = sv.label;

                // Find all functions in the same contract that write this variable
                const writers = functions.filter(fn =>
                    fn.contract === sv.contract &&
                    fn.writesState.some(w => w === varName || w.startsWith(varName + '[') || w.startsWith(varName + '.'))
                );

                // If never written and has initializer → SOL-017 territory, skip
                if (writers.length === 0) continue;

                // If ALL writers are constructors → could be immutable
                const allConstructors = writers.every(fn => fn.label === 'constructor');
                if (allConstructors) {
                    findings.push({
                        location: {
                            file: sv.file,
                            line: sv.line,
                            col: sv.range?.start.column ?? 0,
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
