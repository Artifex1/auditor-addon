import { z } from "zod";
import { encode } from "@toon-format/toon";
import type { AnyRule } from "../../static/rule-loader.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const rulesInfoSchema = {
    description: "List all available SAiST rules with their metadata. Use to discover what rules exist before running sast_run_rules, or to understand finding IDs in results.",
    inputSchema: {
        languages: z.array(z.string()).optional()
            .describe("Filter rules by language (e.g. ['solidity', 'rust']); omit for all"),
        severity: z.array(z.enum(['critical', 'high', 'medium', 'low', 'info'])).optional()
            .describe("Filter by severity; omit for all"),
        kind: z.array(z.enum(['issue', 'smell', 'pointer'])).optional()
            .describe("Filter by finding kind; omit for all"),
    },
};

export function createRulesInfoHandler(shippedRules: AnyRule[]) {
    return async (input: {
        languages?: string[];
        severity?: string[];
        kind?: string[];
    }): Promise<CallToolResult> => {
        try {
            let filtered = shippedRules;

            if (input.languages?.length) {
                const langs = new Set(input.languages);
                filtered = filtered.filter(r => {
                    const applies = r.appliesTo.languages;
                    if (!applies) return true; // no language filter = applies to all
                    return applies.some(l => langs.has(l));
                });
            }
            if (input.severity?.length) {
                const sevs = new Set(input.severity);
                filtered = filtered.filter(r => sevs.has(r.severity));
            }
            if (input.kind?.length) {
                const kinds = new Set(input.kind);
                filtered = filtered.filter(r => kinds.has(r.kind));
            }

            const catalog = filtered.map(r => ({
                id: r.id,
                title: r.title,
                description: r.description,
                severity: r.severity,
                kind: r.kind,
                languages: r.appliesTo.languages ?? 'all',
            }));

            return {
                content: [{
                    type: "text",
                    text: encode({ rules: catalog, total: catalog.length }),
                }],
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                }],
            };
        }
    };
}
