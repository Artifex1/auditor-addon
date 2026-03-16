import { SupportedLanguage } from "../../engine/types.js";
import type { MapRule, FindingInstance, RuleContext, SymbolMap } from "../../engine/types.js";

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

        check(symbolMap: SymbolMap, _ctx: RuleContext): FindingInstance[] {
            const findings: FindingInstance[] = [];

            // Collect all state variables
            const stateVars = [...symbolMap.values()].filter(e => e.kind === 'state_variable');
            // Collect all functions
            const functions = [...symbolMap.values()].filter(e => e.kind === 'function');

            for (const sv of stateVars) {
                // Skip if already constant or immutable
                if (sv.modifiers.some(m => m.name === 'constant' || m.name === 'immutable')) continue;
                // Must have an initializer to be promotable to constant
                if (!sv.modifiers.some(m => m.name === 'has_initializer')) continue;

                // Check if any function writes to this variable
                const varName = sv.label;
                const isWritten = functions.some(fn =>
                    fn.contract === sv.contract &&
                    fn.writesState.some(w => w === varName || w.startsWith(varName + '[') || w.startsWith(varName + '.'))
                );

                if (!isWritten) {
                    findings.push({
                        location: {
                            file: sv.file,
                            line: sv.line,
                            col: sv.range?.start.column ?? 0,
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
