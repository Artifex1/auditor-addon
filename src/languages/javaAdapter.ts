import { SupportedLanguage } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class JavaAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Java,
            queries: {
                comments: `
                    (line_comment) @comment
                    (block_comment) @comment
                `,
                functions: `
                    (method_declaration) @function
                    (constructor_declaration) @function
                `,
                branching: `
                    (if_statement) @branch
                    (for_statement) @branch
                    (while_statement) @branch
                    (do_statement) @branch
                    (catch_clause) @branch
                    (switch_expression) @branch
                    (ternary_expression) @branch
                `,
                normalization: `
                    (method_invocation) @norm
                    (method_declaration) @norm
                    (array_initializer) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 400,
                //  Java tends to be verbose but structurally simpler than C++/Rust.
                //  We expect slightly lower CC density before considering it “complex.”
                complexityMidpoint: 13,
                //  Once Java control flow gets significantly more tangled than normal
                //  business logic, we ramp penalties a bit faster.
                complexitySteepness: 9,
                //  Deep OO / branching can add up to ~55% extra review time, while
                //  simple Java can give ~25% speedup at best.
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.55,
                //  Many Java codebases rely on readable code plus moderate Javadoc.
                //  Around 25% comments unlocks most of the doc benefit (up to ~25%).
                commentFullBenefitDensity: 25,
                commentBenefitCap: 0.25
            }
        });
    }
}
