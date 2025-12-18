import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
import { createEntrypointsHandler, entrypointsSchema } from "./tools/entrypoints.js";
import { createPeekHandler, peekSchema } from "./tools/peek.js";
import { createMetricsHandler, metricsSchema } from "./tools/metrics.js";
import { createCallGraphHandler, callGraphSchema } from "./tools/callgraph.js";

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

// Create server instance
const server = new McpServer({
    name: "mcp-auditor",
    version: "1.0.0",
});

server.registerTool(
    "entrypoints",
    entrypointsSchema,
    createEntrypointsHandler(engine)
);

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
    "callgraph",
    callGraphSchema,
    createCallGraphHandler(engine)
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
