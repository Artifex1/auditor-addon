import { SupportedLanguage } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class NoirAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Noir,
            queries: {
                comments: `
                    (line_comment) @comment
                    (block_comment) @comment
                `,
                functions: `
                    (function_item) @function
                    (function_signature_item) @function
                `,
                branching: `
                    (if_expression) @branch
                    (for_statement) @branch
                    (comptime) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_item) @norm
                    (function_signature_item) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 300,
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
