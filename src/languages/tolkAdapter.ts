import { SupportedLanguage } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class TolkAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Tolk,
            queries: {
                comments: '(comment) @comment',
                functions: '(function_declaration) @function',
                branching: `
                    (if_statement) @branch
                    (while_statement) @branch
                    (do_while_statement) @branch
                    (repeat_statement) @branch
                    (match_expression) @branch
                    (try_catch_statement) @branch
                `,
                normalization: `
                    (function_call) @norm
                    (function_declaration) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 300, // Tolk is low-level, similar to C++ in audit effort
                complexityMidpoint: 15,
                complexitySteepness: 9,
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 0.6,
                commentFullBenefitDensity: 18,
                commentBenefitCap: 0.3
            }
        });
    }
}
