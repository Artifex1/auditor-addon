import { z } from "zod";
import { encode } from "@toon-format/toon";
import { Engine } from "../../engine/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const diffSchema = {
    description: "Get diff between two git refs. Returns either raw diff content or function-level signature changes.",
    inputSchema: {
        base: z.string().describe("Base git ref (commit SHA, branch, or tag)"),
        head: z.string().optional().describe("Head git ref (defaults to HEAD)"),
        paths: z.array(z.string()).optional().describe("Optional file paths or glob patterns to filter"),
        output: z.enum(['full', 'signatures']).optional().describe("Output mode: 'full' for raw diff, 'signatures' for function-level changes (default: full)")
    }
};

export function createDiffHandler(engine: Engine) {
    return async (
        { base, head, paths, output }: { base: string; head?: string; paths?: string[]; output?: 'full' | 'signatures' }
    ): Promise<CallToolResult> => {
        try {
            const result = await engine.processDiff(
                base,
                head || 'HEAD',
                paths,
                output || 'full'
            );

            return {
                content: [{
                    type: "text",
                    text: encode(result)
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`
                }]
            };
        }
    };
}
