import { SupportedLanguage } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class CairoAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Cairo,
            queries: {
                comments: '(line_comment) @comment',
                functions: `
                    (function_item) @function
                    (function_signature_item) @function
                    (external_function_item) @function
                `,
                branching: `
                    (if_expression) @branch
                    (loop_expression) @branch
                    (while_expression) @branch
                    (for_expression) @branch
                    (match_expression) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_item) @norm
                    (function_signature_item) @norm
                    (external_function_item) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 350, // Cairo is similar to Rust, maybe slightly slower due to ZK/Cairo specificities
                complexityMidpoint: 12,
                complexitySteepness: 8,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 0.6,
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.3
            }
        });
    }
}
