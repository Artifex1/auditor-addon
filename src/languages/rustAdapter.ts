import { SupportedLanguage } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class RustAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Rust,
            queries: {
                comments: `
                    (line_comment) @comment
                    (block_comment) @comment
                `,
                functions: '(function_item) @function',
                branching: `
                    (if_expression) @branch
                    (for_expression) @branch
                    (while_expression) @branch
                    (loop_expression) @branch
                    (match_expression) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_item) @norm
                    (array_expression) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 400,
                // Rust code often has more branches/match arms and explicit error
                // handling; structurally busier code is normal, so midpoint is a bit
                // higher than C++.
                complexityMidpoint: 16,
                // Similar ramp to C++: you need to be meaningfully above midpoint
                // before hitting the strongest penalties.
                complexitySteepness: 10,
                // Complex Rust (async, unsafe, advanced generics) can be very slow
                // to audit, so penalty is higher (up to ~70% extra time). Simpler
                // Rust still gives at most ~30% speedup.
                complexityBenefitCap: 0.3,
                complexityPenaltyCap: 0.7,
                // Invariants, lifetimes, unsafe blocks, and async semantics benefit
                // a lot from documentation. Good comments can improve throughput by
                // up to ~35%.
                commentFullBenefitDensity: 18,
                commentBenefitCap: 0.35
            }
        });
    }
}
