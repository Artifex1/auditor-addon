import { describe, it, expect, vi } from "vitest";
import { createCallChainsHandler } from "../../../src/mcp/tools/callChains.js";
import { Engine } from "../../../src/engine/index.js";
import { CallGraph, GraphNode, GraphEdge, SymbolMap, CallTargetKind } from "../../../src/engine/types.js";
import { BaseAdapter } from "../../../src/languages/baseAdapter.js";
import { SupportedLanguage } from "../../../src/engine/types.js";
import { decode } from "@toon-format/toon";

/** Convert a CallGraph fixture to a SymbolMap (same bridge the real code uses). */
function toSymbolMap(graph: CallGraph): SymbolMap {
    return BaseAdapter.callGraphToSymbolMap(graph, SupportedLanguage.Solidity);
}

describe("call_chains tool", () => {
    const mockEngine = {
        processSymbolMap: vi.fn()
    } as unknown as Engine;

    const handler = createCallChainsHandler(mockEngine);

    function decoded(result: any) {
        return decode((result.content as any)[0].text) as any;
    }

    it("should group chains by root node", async () => {
        const graph: CallGraph = {
            nodes: [
                { id: "A", label: "A", visibility: "private", file: "f" },
                { id: "B", label: "B", visibility: "private", file: "f" },
                { id: "C", label: "C", visibility: "private", file: "f" },
            ],
            edges: [
                { from: "A", to: "B", kind: "internal" },
                { from: "B", to: "C", kind: "internal" }
            ]
        };
        (mockEngine.processSymbolMap as any).mockResolvedValue(toSymbolMap(graph));

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains).toHaveProperty("A");
        expect(out.call_chains["A"]).toContain("A -> B -> C");
        // B and C have incoming edges — not roots
        expect(out.call_chains).not.toHaveProperty("B");
        expect(out.call_chains).not.toHaveProperty("C");
    });

    it("should produce separate groups for multiple roots", async () => {
        const graph: CallGraph = {
            nodes: [
                { id: "main",  label: "main",  visibility: "private", file: "f" },
                { id: "cronJob", label: "cronJob", visibility: "private", file: "f" },
                { id: "process", label: "process", visibility: "private", file: "f" },
            ],
            edges: [
                { from: "main",    to: "process", kind: "internal" },
                { from: "cronJob", to: "process", kind: "internal" }
            ]
        };
        (mockEngine.processSymbolMap as any).mockResolvedValue(toSymbolMap(graph));

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains).toHaveProperty("main");
        expect(out.call_chains).toHaveProperty("cronJob");
        expect(out.call_chains["main"]).toContain("main -> process");
        expect(out.call_chains["cronJob"]).toContain("cronJob -> process");
    });

    it("should report hotspots for functions appearing in many chains", async () => {
        const graph: CallGraph = {
            nodes: [
                { id: "A", label: "A", visibility: "private", file: "f" },
                { id: "B", label: "B", visibility: "private", file: "f" },
                { id: "shared", label: "shared", visibility: "private", file: "f" },
            ],
            edges: [
                { from: "A", to: "shared", kind: "internal" },
                { from: "B", to: "shared", kind: "internal" }
            ]
        };
        (mockEngine.processSymbolMap as any).mockResolvedValue(toSymbolMap(graph));

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.hotspots).toBeDefined();
        expect(out.hotspots.some((h: string) => h.startsWith("shared:"))).toBe(true);
    });

    it("should not list root nodes themselves in hotspots", async () => {
        const graph: CallGraph = {
            nodes: [
                { id: "root", label: "root", visibility: "private", file: "f" },
                { id: "leaf", label: "leaf", visibility: "private", file: "f" },
            ],
            edges: [{ from: "root", to: "leaf", kind: "internal" }]
        };
        (mockEngine.processSymbolMap as any).mockResolvedValue(toSymbolMap(graph));

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.hotspots.every((h: string) => !h.startsWith("root:"))).toBe(true);
    });

    it("should handle branching by producing one chain per branch", async () => {
        const graph: CallGraph = {
            nodes: [
                { id: "A", label: "A", visibility: "private", file: "f" },
                { id: "B", label: "B", visibility: "private", file: "f" },
                { id: "C", label: "C", visibility: "private", file: "f" },
            ],
            edges: [
                { from: "A", to: "B", kind: "internal" },
                { from: "A", to: "C", kind: "internal" }
            ]
        };
        (mockEngine.processSymbolMap as any).mockResolvedValue(toSymbolMap(graph));

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains["A"]).toContain("A -> B");
        expect(out.call_chains["A"]).toContain("A -> C");
        expect(out.call_chains["A"]).toHaveLength(2);
    });

    it("should handle cycles gracefully", async () => {
        const graph: CallGraph = {
            nodes: [
                { id: "R", label: "R", visibility: "private", file: "f" },
                { id: "A", label: "A", visibility: "private", file: "f" },
                { id: "B", label: "B", visibility: "private", file: "f" },
            ],
            edges: [
                { from: "R", to: "A", kind: "internal" },
                { from: "A", to: "B", kind: "internal" },
                { from: "B", to: "A", kind: "internal" }
            ]
        };
        (mockEngine.processSymbolMap as any).mockResolvedValue(toSymbolMap(graph));

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains["R"][0]).toMatch(/R -> A -> B -> A \(Recursive\)/);
    });

    it("should respect max depth limit", async () => {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const CHAIN_LEN = 15;
        for (let i = 0; i < CHAIN_LEN; i++) {
            nodes.push({ id: `N${i}`, label: `N${i}`, visibility: "private", file: "f" });
            if (i < CHAIN_LEN - 1) {
                edges.push({ from: `N${i}`, to: `N${i + 1}`, kind: "internal" });
            }
        }
        (mockEngine.processSymbolMap as any).mockResolvedValue(toSymbolMap({ nodes, edges }));

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains["N0"][0]).toContain("N10 (Max Depth)");
    });

    it("should sort chains longest-first within each root group", async () => {
        const graph: CallGraph = {
            nodes: [
                { id: "A", label: "A", visibility: "private", file: "f" },
                { id: "B", label: "B", visibility: "private", file: "f" },
                { id: "C", label: "C", visibility: "private", file: "f" },
                { id: "D", label: "D", visibility: "private", file: "f" },
            ],
            edges: [
                { from: "A", to: "B", kind: "internal" },
                { from: "A", to: "C", kind: "internal" },
                { from: "C", to: "D", kind: "internal" }
            ]
        };
        (mockEngine.processSymbolMap as any).mockResolvedValue(toSymbolMap(graph));

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        const chains = out.call_chains["A"] as string[];
        // Longest chain first: A -> C -> D (3 hops) before A -> B (2 hops)
        expect(chains[0]).toBe("A -> C -> D");
        expect(chains[1]).toBe("A -> B");
    });
});
