import { SupportedLanguage } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class CompactAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Compact,
            queries: {
                comments: '(comment) @comment',
                functions: '(cdefn) @function',
                branching: `
                    (if_stmt) @branch
                    (for_stmt) @branch
                    (conditional_expr) @branch
                `,
                normalization: `
                    (function_call_term) @norm
                    (cdefn) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 300, // Compact is very high level but specific ZK semantics
                complexityMidpoint: 10,
                complexitySteepness: 7,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 0.6,
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.3
            }
        });
    }
}
