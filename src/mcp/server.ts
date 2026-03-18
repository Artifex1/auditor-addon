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
import { MasmAdapter } from "../languages/masmAdapter.js";
import { PythonAdapter } from "../languages/pythonAdapter.js";
import { createPeekHandler, peekSchema } from "./tools/peek.js";
import { createMetricsHandler, metricsSchema } from "./tools/metrics.js";
import { createCallChainsHandler, callChainsSchema } from "./tools/callChains.js";
import { createDiffMetricsHandler, diffMetricsSchema } from "./tools/diffMetrics.js";
import { createDiffHandler, diffSchema } from "./tools/diff.js";
import { createSastInitScanHandler, sastInitScanSchema } from "./tools/sastInitScan.js";
import { createSastResolveGapsHandler, sastResolveGapsSchema } from "./tools/sastResolveGaps.js";
import { createSastRunRulesHandler, sastRunRulesSchema } from "./tools/sastRunRules.js";
import { createRulesInfoHandler, rulesInfoSchema } from "./tools/rulesInfo.js";
import { shippedRules } from "../static/rules/index.js";

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
engine.registerAdapter(new MasmAdapter());
engine.registerAdapter(new JavaScriptAdapter());
engine.registerAdapter(new TypeScriptAdapter());
engine.registerAdapter(new TsxAdapter());
engine.registerAdapter(new FlowAdapter());
engine.registerAdapter(new PythonAdapter());

// Create server instance
const server = new McpServer({
    name: "auditor-addon",
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
    "call_chains",
    callChainsSchema,
    createCallChainsHandler(engine)
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

server.registerTool(
    "sast_init_scan",
    sastInitScanSchema,
    createSastInitScanHandler(engine)
);

server.registerTool(
    "sast_resolve_gaps",
    sastResolveGapsSchema,
    createSastResolveGapsHandler()
);

server.registerTool(
    "sast_run_rules",
    sastRunRulesSchema,
    createSastRunRulesHandler(shippedRules, engine)
);

server.registerTool(
    "rules_info",
    rulesInfoSchema,
    createRulesInfoHandler(shippedRules)
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Auditor Addon Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});

export { server }; // Export for testing
