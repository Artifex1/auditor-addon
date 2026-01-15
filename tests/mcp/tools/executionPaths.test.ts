import { describe, it, expect, vi } from "vitest";
import { createExecutionPathsHandler } from "../../../src/mcp/tools/executionPaths.js";
import { Engine } from "../../../src/engine/index.js";
import { CallGraph, GraphNode, GraphEdge } from "../../../src/engine/types.js";
import { decode } from "@toon-format/toon";

describe("execution_paths tool", () => {
    const mockEngine = {
        processCallGraph: vi.fn()
    } as unknown as Engine;

    const handler = createExecutionPathsHandler(mockEngine);

    it("should generate linear paths from public entrypoints", async () => {
        const graph: CallGraph = {
            nodes: [
                { id: "A", label: "A", visibility: "public", file: "f1" },
                { id: "B", label: "B", visibility: "internal", file: "f1" },
                { id: "C", label: "C", visibility: "internal", file: "f1" },
                { id: "D", label: "D", visibility: "internal", file: "f1" } // Unconnected
            ],
            edges: [
                { from: "A", to: "B", kind: "internal" },
                { from: "B", to: "C", kind: "internal" }
            ]
        };
        (mockEngine.processCallGraph as any).mockResolvedValue(graph);

        const result = await handler({ paths: ["foo"] });
        if (!result.content || result.content[0].type !== "text") throw new Error("Invalid result");

        const decoded = decode(result.content[0].text) as any;

        expect(decoded.execution_paths).toContain("A -> B -> C");
        expect(decoded.execution_paths.length).toBe(1);
    });

    it("should handle cycles gracefully", async () => {
        const graph: CallGraph = {
            nodes: [
                { id: "A", label: "A", visibility: "public", file: "f1" },
                { id: "B", label: "B", visibility: "internal", file: "f1" }
            ],
            edges: [
                { from: "A", to: "B", kind: "internal" },
                { from: "B", to: "A", kind: "internal" }
            ]
        };
        (mockEngine.processCallGraph as any).mockResolvedValue(graph);

        const result = await handler({ paths: ["foo"] });
        const decoded = decode((result.content as any)[0].text) as any;

        // A -> B -> A (Recursive)
        expect(decoded.execution_paths[0]).toMatch(/A -> B -> A \(Recursive\)/);
    });

    it("should follow branching paths", async () => {
        const graph: CallGraph = {
            nodes: [
                { id: "A", label: "A", visibility: "public", file: "f1" },
                { id: "B", label: "B", visibility: "internal", file: "f1" },
                { id: "C", label: "C", visibility: "internal", file: "f1" }
            ],
            edges: [
                { from: "A", to: "B", kind: "internal" },
                { from: "A", to: "C", kind: "internal" }
            ]
        };
        (mockEngine.processCallGraph as any).mockResolvedValue(graph);

        const result = await handler({ paths: ["foo"] });
        const decoded = decode((result.content as any)[0].text) as any;

        const paths = decoded.execution_paths as string[];
        expect(paths).toContain("A -> B");
        expect(paths).toContain("A -> C");
        expect(paths.length).toBe(2);
    });

    it("should respect max depth limit", async () => {
        // Create a chain longer than 10
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const CHAIN_LEN = 15;
        for (let i = 0; i < CHAIN_LEN; i++) {
            nodes.push({ id: `N${i}`, label: `N${i}`, visibility: i === 0 ? 'public' : 'internal', file: 'f' });
            if (i < CHAIN_LEN - 1) {
                edges.push({ from: `N${i}`, to: `N${i + 1}`, kind: "internal" });
            }
        }

        (mockEngine.processCallGraph as any).mockResolvedValue({ nodes, edges });

        const result = await handler({ paths: ["foo"] });
        const decoded = decode((result.content as any)[0].text) as any;
        const path = (decoded.execution_paths as string[])[0];

        // Depth 10 is reached at N10. N0 -> ... -> N10 (11 nodes).
        // My code stops at depth >= MAX_DEPTH.
        // So it should show N0 -> ... -> N10 (Max Depth)
        expect(path).toContain("N10 (Max Depth)");
    });
});
