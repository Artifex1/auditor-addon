import { z } from "zod";
import { encode } from "@toon-format/toon";
import { Engine } from "../../engine/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const metricsSchema = {
    description: "Calculate code metrics and estimation for files",
    inputSchema: {
        paths: z.array(z.string()).describe("File paths or glob patterns to analyze")
    }
};

export function createMetricsHandler(engine: Engine) {
    return async (
        { paths }: { paths: string[] }
    ): Promise<CallToolResult> => {
        try {
            const metrics = await engine.processMetrics(paths);

            // Calculate totals
            const summary = metrics.reduce((acc, curr) => {
                acc.totalNloc += curr.nloc;
                acc.totalHours += curr.estimatedHours;
                return acc;
            }, { totalNloc: 0, totalHours: 0 });

            // Round to 2 decimal places
            summary.totalHours = parseFloat(summary.totalHours.toFixed(2));
            const totalDays = parseFloat((summary.totalHours / 8).toFixed(2));

            return {
                content: [{
                    type: "text",
                    text: encode({
                        metrics,
                        summary: {
                            ...summary,
                            totalDays
                        }
                    })
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
