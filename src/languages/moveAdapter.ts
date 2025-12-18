import { SupportedLanguage } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class MoveAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Move,
            queries: {
                comments: `
                    (line_comment) @comment
                    (block_comment) @comment
                `,
                functions: '(function_decl) @function',
                branching: `
                    (if_expr) @branch
                    (while_expr) @branch
                    (loop_expr) @branch
                    (for_loop_expr) @branch
                    (match_expr) @branch
                    (abort_expr) @branch
                `,
                normalization: `
                    (call_expr) @norm
                    (function_decl) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 350,
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
