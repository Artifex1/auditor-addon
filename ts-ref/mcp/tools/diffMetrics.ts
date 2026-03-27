import { z } from "zod";
import { encode } from "@toon-format/toon";
import { Engine } from "../../engine/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const diffMetricsSchema = {
    description: "Calculate code metrics for changes between two git refs (commits, branches, or tags)",
    inputSchema: {
        base: z.string().describe("Base git ref (commit SHA, branch, or tag)"),
        head: z.string().optional().describe("Head git ref (defaults to HEAD)"),
        paths: z.array(z.string()).optional().describe("Optional file paths or glob patterns to filter")
    }
};

export function createDiffMetricsHandler(engine: Engine) {
    return async (
        { base, head, paths }: { base: string; head?: string; paths?: string[] }
    ): Promise<CallToolResult> => {
        try {
            const metrics = await engine.processDiffMetrics(
                base,
                head || 'HEAD',
                paths
            );

            // Calculate totals
            const summary = metrics.reduce((acc, curr) => {
                acc.totalAddedLines += curr.addedLines;
                acc.totalRemovedLines += curr.removedLines;
                acc.totalDiffNloc += curr.diffNloc;
                acc.totalDiffComplexity += curr.diffComplexity;
                acc.totalHours += curr.estimatedHours;
                return acc;
            }, {
                totalAddedLines: 0,
                totalRemovedLines: 0,
                totalDiffNloc: 0,
                totalDiffComplexity: 0,
                totalHours: 0
            });

            // Round to 2 decimal places
            summary.totalHours = parseFloat(summary.totalHours.toFixed(2));
            const totalDays = parseFloat((summary.totalHours / 8).toFixed(2));

            // Count files by status
            const filesByStatus = metrics.reduce((acc, curr) => {
                acc[curr.status] = (acc[curr.status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            return {
                content: [{
                    type: "text",
                    text: encode({
                        diffMetrics: metrics,
                        summary: {
                            ...summary,
                            totalDays,
                            filesChanged: metrics.length,
                            filesByStatus
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
