import { SupportedLanguage } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class MasmAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Masm,
            queries: {
                comments: `
                    (comment) @comment
                    (doc_comment) @comment
                    (moduledoc) @comment
                `,
                functions: `
                    (procedure) @function
                    (entrypoint) @function
                `,
                branching: `
                    (if) @branch
                    (while) @branch
                    (repeat) @branch
                `,
                normalization: `
                    (invoke) @norm
                    (procedure) @norm
                    (entrypoint) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 350, // Stack-based assembly requires careful review but procedures are straightforward
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
