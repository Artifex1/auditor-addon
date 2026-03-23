import { describe, it, expect, vi } from "vitest";
import { createCallChainsHandler } from "../../../src/mcp/tools/callChains.js";
import { Engine } from "../../../src/engine/index.js";
import { SymbolGraph, GraphNode, SupportedLanguage } from "../../../src/engine/types.js";
import { decode } from "@toon-format/toon";

let _nodeCounter = 0;
function makeId() { return `n${++_nodeCounter}`; }

/** Build a minimal SymbolGraph from a compact adjacency list. */
function buildGraph(
    adjacency: Record<string, string[]>,
): SymbolGraph {
    const graph = new SymbolGraph();
    const nodeMap = new Map<string, GraphNode>();

    // Create concrete nodes for all keys
    for (const [qn] of Object.entries(adjacency)) {
        const node: GraphNode = {
            id: makeId(),
            kind: 'function',
            qualifiedName: qn,
            status: 'concrete',
            language: SupportedLanguage.Solidity,
            label: qn,
            locator: { file: 'f', startIndex: 0, endIndex: 0, line: 1, column: 0 },
            visibility: 'private',
            resolvedBy: 'static',
            confidence: 'high',
        };
        graph.addNode(node);
        nodeMap.set(qn, node);
    }

    // Add edges
    for (const [fromQn, callees] of Object.entries(adjacency)) {
        const fromNode = nodeMap.get(fromQn)!;
        for (const toQn of callees) {
            let toNode = nodeMap.get(toQn);
            if (!toNode) {
                // Create missing target as concrete node
                toNode = {
                    id: makeId(),
                    kind: 'function',
                    qualifiedName: toQn,
                    status: 'concrete',
                    language: SupportedLanguage.Solidity,
                    label: toQn,
                    locator: { file: 'f', startIndex: 0, endIndex: 0, line: 1, column: 0 },
                    visibility: 'private',
                    resolvedBy: 'static',
                    confidence: 'high',
                };
                graph.addNode(toNode);
                nodeMap.set(toQn, toNode);
            }
            graph.addEdge({ from: fromNode.id, to: toNode.id, kind: 'calls', attrs: { targetKind: 'internal' } });
        }
    }

    return graph;
}

describe("call_chains tool", () => {
    const mockEngine = {
        processGraph: vi.fn()
    } as unknown as Engine;

    const handler = createCallChainsHandler(mockEngine);

    function decoded(result: any) {
        return decode((result.content as any)[0].text) as any;
    }

    it("should group chains by root node", async () => {
        const g = buildGraph({ A: ["B"], B: ["C"], C: [] });
        (mockEngine.processGraph as any).mockResolvedValue(g);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains).toHaveProperty("A");
        expect(out.call_chains["A"]).toContain("A -> B -> C");
        expect(out.call_chains).not.toHaveProperty("B");
        expect(out.call_chains).not.toHaveProperty("C");
    });

    it("should produce separate groups for multiple roots", async () => {
        const g = buildGraph({ main: ["process"], cronJob: ["process"], process: [] });
        (mockEngine.processGraph as any).mockResolvedValue(g);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains).toHaveProperty("main");
        expect(out.call_chains).toHaveProperty("cronJob");
        expect(out.call_chains["main"]).toContain("main -> process");
        expect(out.call_chains["cronJob"]).toContain("cronJob -> process");
    });

    it("should report hotspots for functions appearing in many chains", async () => {
        const g = buildGraph({ A: ["shared"], B: ["shared"], shared: [] });
        (mockEngine.processGraph as any).mockResolvedValue(g);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.hotspots).toBeDefined();
        expect(out.hotspots.some((h: string) => h.startsWith("shared:"))).toBe(true);
    });

    it("should not list root nodes themselves in hotspots", async () => {
        const g = buildGraph({ root: ["leaf"], leaf: [] });
        (mockEngine.processGraph as any).mockResolvedValue(g);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.hotspots.every((h: string) => !h.startsWith("root:"))).toBe(true);
    });

    it("should handle branching by producing one chain per branch", async () => {
        const g = buildGraph({ A: ["B", "C"], B: [], C: [] });
        (mockEngine.processGraph as any).mockResolvedValue(g);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains["A"]).toContain("A -> B");
        expect(out.call_chains["A"]).toContain("A -> C");
        expect(out.call_chains["A"]).toHaveLength(2);
    });

    it("should handle cycles gracefully", async () => {
        const g = buildGraph({ R: ["A"], A: ["B"], B: ["A"] });
        (mockEngine.processGraph as any).mockResolvedValue(g);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains["R"][0]).toMatch(/R -> A -> B -> A \(Recursive\)/);
    });

    it("should respect max depth limit", async () => {
        const adj: Record<string, string[]> = {};
        const CHAIN_LEN = 15;
        for (let i = 0; i < CHAIN_LEN; i++) {
            adj[`N${i}`] = i < CHAIN_LEN - 1 ? [`N${i + 1}`] : [];
        }
        (mockEngine.processGraph as any).mockResolvedValue(buildGraph(adj));

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains["N0"][0]).toContain("N10 (Max Depth)");
    });

    it("should sort chains longest-first within each root group", async () => {
        const g = buildGraph({ A: ["B", "C"], B: [], C: ["D"], D: [] });
        (mockEngine.processGraph as any).mockResolvedValue(g);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        const chains = out.call_chains["A"] as string[];
        // Longest chain first: A -> C -> D (3 hops) before A -> B (2 hops)
        expect(chains[0]).toBe("A -> C -> D");
        expect(chains[1]).toBe("A -> B");
    });
});
