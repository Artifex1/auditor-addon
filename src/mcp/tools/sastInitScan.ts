import { z } from "zod";
import { encode } from "@toon-format/toon";
import { Engine } from "../../engine/index.js";
import { SupportedLanguage, ScanContext } from "../../engine/types.js";
import { runScan } from "../../static/engine.js";
import { readFiles, resolveFiles } from "../../engine/fileUtils.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const sastInitScanSchema = {
    description: "Initialize a SAiST static analysis scan. Builds a symbol map, detects gaps, and computes hotspots. Returns a scanId for use with sast_resolve_gaps and sast_run_rules.",
    inputSchema: {
        files: z.array(z.string()).describe("File paths or glob patterns to analyze"),
        languages: z.array(z.string()).describe("Languages to analyze (e.g. 'solidity', 'rust')"),
        context: z.object({
            domainOverrides: z.record(z.string(), z.enum(['on-chain', 'off-chain'])).optional()
                .describe("Override default domain for specific languages"),
            framework: z.string().optional()
                .describe("Framework hint (e.g. 'anchor', 'starknet', 'cosmwasm')"),
        }).optional().describe("Scan context with domain overrides and framework hints"),
    },
};

export function createSastInitScanHandler(engine: Engine) {
    return async (input: {
        files: string[];
        languages: string[];
        context?: { domainOverrides?: Record<string, string>; framework?: string };
    }): Promise<CallToolResult> => {
        try {
            const filePaths = await resolveFiles(input.files);
            const files = await readFiles(filePaths);

            const filesByLanguage = new Map<SupportedLanguage, { adapter: any; files: any[] }>();
            const sourceFiles = new Map<string, string>();

            for (const file of files) {
                sourceFiles.set(file.path, file.content);
                const lang = engine.detectLanguage(file.path, file.content);
                if (!lang) continue;
                if (!input.languages.includes(lang)) continue;

                const adapter = engine.getAdapter(lang);
                if (!adapter) continue;

                if (!filesByLanguage.has(lang)) {
                    filesByLanguage.set(lang, { adapter, files: [] });
                }
                filesByLanguage.get(lang)!.files.push(file);
            }

            const context: ScanContext | undefined = input.context ? {
                domainOverrides: input.context.domainOverrides as any,
                framework: input.context.framework,
            } : undefined;

            const result = await runScan(filesByLanguage, context, sourceFiles);

            let concreteCount = 0;
            let gapCount = 0;
            for (const node of result.graph.nodes()) {
                if (node.status === 'concrete') concreteCount++;
                else if (node.status === 'gap') gapCount++;
            }

            return {
                content: [{
                    type: "text",
                    text: encode({
                        scanId: result.scanId,
                        status: result.status,
                        symbolMapStats: {
                            total: concreteCount + gapCount,
                            concrete: concreteCount,
                            gaps: gapCount,
                        },
                        gaps: result.gaps,
                        hotspots: result.hotspots,
                    }),
                }],
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: `Error initializing scan: ${error instanceof Error ? error.message : String(error)}`,
                }],
            };
        }
    };
}
