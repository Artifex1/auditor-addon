import { SupportedLanguage } from "../../engine/types.js";
import type { MapRule, FindingInstance, RuleContext, SymbolMap } from "../../engine/types.js";
import { buildCallerIndex } from "../hotspots.js";

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

        check(symbolMap: SymbolMap, _ctx: RuleContext): FindingInstance[] {
            const findings: FindingInstance[] = [];
            const callerIndex = buildCallerIndex(symbolMap);

            for (const [qn, entry] of symbolMap) {
                if (entry.kind !== 'function') continue;
                if (entry.visibility !== 'internal' && entry.visibility !== 'private') continue;

                // Exclude constructors, fallback, receive
                if (['constructor', 'fallback', 'receive'].includes(entry.label)) continue;

                const callers = callerIndex.get(qn);
                if (!callers || callers.size === 0) {
                    findings.push({
                        location: {
                            file: entry.file,
                            line: entry.line,
                            col: entry.range?.start.column ?? 0,
                        },
                        snippet: `${qn}: internal/private with no callers`,
                    });
                }
            }

            return findings;
        },
    };
}

export default createRule();
