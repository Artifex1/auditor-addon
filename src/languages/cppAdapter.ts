import { SupportedLanguage } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class CppAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Cpp,
            queries: {
                comments: '(comment) @comment',
                functions: '(function_definition) @function',
                branching: `
                    (if_statement) @branch
                    (for_statement) @branch
                    (while_statement) @branch
                    (do_statement) @branch
                    (switch_statement) @branch
                    (catch_clause) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_definition) @norm
                    (initializer_list) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 400,
                // Moderate structural complexity is “normal” C++: branches, loops,
                // RAII, exceptions, templates, etc. We only start penalizing above that.
                complexityMidpoint: 15,
                // Complexity ramp is gradual. You need to be ~10–20 CC above/below
                // the midpoint before you hit most of the penalty/benefit.
                complexitySteepness: 9,
                // High complexity can slow review down by up to ~60% (1.6x time),
                // while very simple code can at best give ~30% speedup. In security
                // audits, complexity hurts more than simplicity helps.
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 0.6,
                // Slightly higher “normal” comment density to explain invariants,
                // ownership rules, perf hacks. Around 18%+ unlocks most of the
                // documentation benefit (up to ~30%).
                commentFullBenefitDensity: 18,
                commentBenefitCap: 0.3
            }
        });
    }
}
