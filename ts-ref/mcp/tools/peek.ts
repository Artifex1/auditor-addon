import { z } from "zod";
import { encode } from "@toon-format/toon";
import { Engine } from "../../engine/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const peekSchema = {
    description: "Extract function signatures from files to understand their purpose",
    inputSchema: {
        paths: z.array(z.string()).describe("File paths or glob patterns to analyze")
    }
};

export function createPeekHandler(engine: Engine) {
    return async (
        { paths }: { paths: string[] }
    ): Promise<CallToolResult> => {
        try {
            const signaturesByFile = await engine.processSignatures(paths);
            return {
                content: [{
                    type: "text",
                    text: encode(signaturesByFile)
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
