import { SupportedLanguage } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class PythonAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Python,
            queries: {
                comments: '(comment) @comment',
                functions: `
                    (function_definition) @function
                `,
                branching: `
                    (if_statement) @branch
                    (for_statement) @branch
                    (while_statement) @branch
                    (conditional_expression) @branch
                    (try_statement) @branch
                    (except_clause) @branch
                `,
                normalization: `
                    (call) @norm
                    (function_definition) @norm
                    (list) @norm
                    (dictionary) @norm
                `
            },
            constants: {
                // Python is highly readable; review throughput is similar to JS/TS.
                baseRateNlocPerDay: 450,
                // Moderate complexity threshold — Python's indentation-based scoping
                // makes nesting very visible, but deeply nested code is still costly.
                complexityMidpoint: 12,
                complexitySteepness: 9,
                // Simple, flat Python code can speed up review by ~25%; heavy nesting
                // and complex control flow can cost up to ~55% more.
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.55,
                // Docstrings and inline comments are idiomatic Python; most benefit
                // is realized around ~15% comment density.
                commentFullBenefitDensity: 15,
                commentBenefitCap: 0.25
            }
        });
    }
}
