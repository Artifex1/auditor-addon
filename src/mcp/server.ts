import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Engine } from "../engine/index.js";
import { SolidityAdapter } from "../languages/solidityAdapter.js";
import { CppAdapter } from "../languages/cppAdapter.js";
import { JavaAdapter } from "../languages/javaAdapter.js";
import { GoAdapter } from "../languages/goAdapter.js";
import { RustAdapter } from "../languages/rustAdapter.js";
import { CairoAdapter } from "../languages/cairoAdapter.js";
import { CompactAdapter } from "../languages/compactAdapter.js";
import { MoveAdapter } from "../languages/moveAdapter.js";
import { NoirAdapter } from "../languages/noirAdapter.js";
import { TolkAdapter } from "../languages/tolkAdapter.js";
import { FlowAdapter, JavaScriptAdapter, TsxAdapter, TypeScriptAdapter } from "../languages/javascriptAdapter.js";
import { createPeekHandler, peekSchema } from "./tools/peek.js";
import { createMetricsHandler, metricsSchema } from "./tools/metrics.js";
import { createExecutionPathsHandler, executionPathsSchema } from "./tools/executionPaths.js";
import { createDiffMetricsHandler, diffMetricsSchema } from "./tools/diffMetrics.js";
import { createDiffHandler, diffSchema } from "./tools/diff.js";

// Create and configure engine
const engine = new Engine();
engine.registerAdapter(new SolidityAdapter());
engine.registerAdapter(new CppAdapter());
engine.registerAdapter(new JavaAdapter());
engine.registerAdapter(new GoAdapter());
engine.registerAdapter(new RustAdapter());
engine.registerAdapter(new CairoAdapter());
engine.registerAdapter(new CompactAdapter());
engine.registerAdapter(new MoveAdapter());
engine.registerAdapter(new NoirAdapter());
engine.registerAdapter(new TolkAdapter());
engine.registerAdapter(new JavaScriptAdapter());
engine.registerAdapter(new TypeScriptAdapter());
engine.registerAdapter(new TsxAdapter());
engine.registerAdapter(new FlowAdapter());

// Create server instance
const server = new McpServer({
    name: "mcp-auditor",
    version: "1.0.0",
});

server.registerTool(
    "peek",
    peekSchema,
    createPeekHandler(engine)
);

server.registerTool(
    "metrics",
    metricsSchema,
    createMetricsHandler(engine)
);

server.registerTool(
    "execution_paths",
    executionPathsSchema,
    createExecutionPathsHandler(engine)
);

server.registerTool(
    "diff_metrics",
    diffMetricsSchema,
    createDiffMetricsHandler(engine)
);

server.registerTool(
    "diff",
    diffSchema,
    createDiffHandler(engine)
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Auditor Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});

export { server }; // Export for testing
