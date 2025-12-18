import { Entrypoint, FileContent, SupportedLanguage, CallGraph, GraphNode, GraphEdge } from "../engine/types.js";
import { BaseAdapter } from "./baseAdapter.js";

export class GoAdapter extends BaseAdapter {
    constructor() {
        super({
            languageId: SupportedLanguage.Go,
            queries: {
                comments: '(comment) @comment',
                functions: `
                    (function_declaration) @function
                    (method_declaration) @function
                `,
                branching: `
                    (if_statement) @branch
                    (for_statement) @branch
                    (expression_switch_statement) @branch
                    (type_switch_statement) @branch
                    (select_statement) @branch
                `,
                normalization: `
                    (call_expression) @norm
                    (function_declaration) @norm
                    (method_declaration) @norm
                    (composite_literal) @norm
                `
            },
            constants: {
                baseRateNlocPerDay: 400,
                // Go is intentionally simple; deep nesting and clever control flow
                // are atypical. We start penalizing at a lower CC density than C++.
                complexityMidpoint: 12,
                // A bit sharper than C++: once Go code gets significantly more complex
                // than “normal,” review cost ramps up fairly quickly.
                complexitySteepness: 9,
                // Very simple Go can give ~25% speedup, while heavily tangled logic
                // can cost up to ~50% more time. Extreme complexity is less common
                // than in low-level systems languages.
                complexityBenefitCap: 0.25,
                complexityPenaltyCap: 0.50,
                // Idiomatic Go favors clear code with modest comments. Around 15%+
                // starts unlocking the bulk of the documentation benefit (up to ~25%).
                commentFullBenefitDensity: 15,
                commentBenefitCap: 0.25
            }
        });
    }
}
