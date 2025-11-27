import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Engine } from "../engine/index.js";
import { SolidityAdapter } from "../languages/solidityAdapter.js";
import { createEntrypointsHandler, entrypointsSchema } from "./tools/entrypoints.js";

// Create and configure engine
const engine = new Engine();
engine.registerAdapter(new SolidityAdapter());

// Create server instance
const server = new McpServer({
    name: "mcp-auditor",
    version: "1.0.0",
});

// Register tools
server.registerTool(
    "entrypoints",
    entrypointsSchema,
    createEntrypointsHandler(engine)
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
