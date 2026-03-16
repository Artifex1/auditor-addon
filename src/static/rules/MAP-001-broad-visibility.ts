import { SupportedLanguage } from "../../engine/types.js";
import type { MapRule, FindingInstance, RuleContext, SymbolMap } from "../../engine/types.js";
import { buildCallerIndex } from "../hotspots.js";

/**
 * MAP-001: Broad Visibility
 *
 * For `public` functions: if no caller is from a different contract/module,
 * the function could use a tighter visibility (external).
 * Skips virtual/override functions (legitimate polymorphism).
 *
 * For `internal` functions: if all callers share the same contract,
 * the function could be private.
 *
 * Requires languages where adapters populate `contract` + `visibility`.
 */
function createRule(): MapRule {
    return {
        id: 'MAP-001',
        severity: 'info',
        title: 'Function visibility could be tighter',
        description: 'Functions with broader visibility than needed (public when only called internally, internal when only called from same contract) increase attack surface.',
        kind: 'smell',
        appliesTo: {
            languages: [
                SupportedLanguage.Solidity,
                SupportedLanguage.Cairo,
                SupportedLanguage.Move,
                SupportedLanguage.Rust,
                SupportedLanguage.Java,
                SupportedLanguage.Cpp,
            ],
        },

        check(symbolMap: SymbolMap, _ctx: RuleContext): FindingInstance[] {
            const findings: FindingInstance[] = [];
            const callerIndex = buildCallerIndex(symbolMap);

            for (const [qn, entry] of symbolMap) {
                if (entry.kind !== 'function') continue;

                // Skip virtual/override (modifier names)
                if (entry.modifiers.some(m =>
                    m.name === 'virtual' || m.name === 'override'
                )) continue;

                // Skip constructors, fallback, receive
                if (['constructor', 'fallback', 'receive'].includes(entry.label)) continue;

                const callers = callerIndex.get(qn);

                if (entry.visibility === 'public') {
                    // Check if any caller is from a different contract
                    const hasCrossModuleCaller = callers && [...callers].some(callerId => {
                        const caller = symbolMap.get(callerId);
                        return caller && caller.contract !== entry.contract;
                    });

                    if (!hasCrossModuleCaller) {
                        findings.push({
                            location: {
                                file: entry.file,
                                line: entry.line,
                                col: entry.range?.start.column ?? 0,
                            },
                            snippet: `${qn}: public with no cross-module callers — could be external or tighter`,
                        });
                    }
                } else if (entry.visibility === 'internal') {
                    if (!callers || callers.size === 0) continue;
                    // All callers same contract?
                    const allSameContract = [...callers].every(callerId => {
                        const caller = symbolMap.get(callerId);
                        return caller && caller.contract === entry.contract;
                    });
                    if (allSameContract && entry.contract) {
                        findings.push({
                            location: {
                                file: entry.file,
                                line: entry.line,
                                col: entry.range?.start.column ?? 0,
                            },
                            snippet: `${qn}: internal but only called within ${entry.contract} — could be private`,
                        });
                    }
                }
            }

            return findings;
        },
    };
}

export default createRule();
