import { describe, it, expect, vi } from "vitest";
import { createCallChainsHandler } from "../../../src/mcp/tools/callChains.js";
import { Engine } from "../../../src/engine/index.js";
import { SymbolMap, SymbolEntry, SupportedLanguage } from "../../../src/engine/types.js";
import { decode } from "@toon-format/toon";

/** Build a minimal SymbolMap from a compact adjacency list. */
function buildSymbolMap(
    adjacency: Record<string, string[]>,
    opts?: { visibility?: string },
): SymbolMap {
    const vis = (opts?.visibility ?? 'private') as SymbolEntry['visibility'];
    const map: SymbolMap = new Map();
    for (const [id, callees] of Object.entries(adjacency)) {
        map.set(id, {
            qualifiedName: id,
            kind: 'function',
            label: id,
            file: 'f',
            line: 0,
            language: SupportedLanguage.Solidity,
            writesState: [],
            readsState: [],
            callsExternal: false,
            callees: callees.map(c => ({ qualifiedName: c, targetKind: 'internal' as const })),
            isPublic: false,
            hasAccessControl: false,
            modifiers: [],
            resolvedBy: 'static',
            confidence: 'high',
            visibility: vis,
        });
    }
    return map;
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
        const sm = buildSymbolMap({ A: ["B"], B: ["C"], C: [] });
        (mockEngine.processSymbolMap as any).mockResolvedValue(sm);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains).toHaveProperty("A");
        expect(out.call_chains["A"]).toContain("A -> B -> C");
        expect(out.call_chains).not.toHaveProperty("B");
        expect(out.call_chains).not.toHaveProperty("C");
    });

    it("should produce separate groups for multiple roots", async () => {
        const sm = buildSymbolMap({ main: ["process"], cronJob: ["process"], process: [] });
        (mockEngine.processSymbolMap as any).mockResolvedValue(sm);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains).toHaveProperty("main");
        expect(out.call_chains).toHaveProperty("cronJob");
        expect(out.call_chains["main"]).toContain("main -> process");
        expect(out.call_chains["cronJob"]).toContain("cronJob -> process");
    });

    it("should report hotspots for functions appearing in many chains", async () => {
        const sm = buildSymbolMap({ A: ["shared"], B: ["shared"], shared: [] });
        (mockEngine.processSymbolMap as any).mockResolvedValue(sm);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.hotspots).toBeDefined();
        expect(out.hotspots.some((h: string) => h.startsWith("shared:"))).toBe(true);
    });

    it("should not list root nodes themselves in hotspots", async () => {
        const sm = buildSymbolMap({ root: ["leaf"], leaf: [] });
        (mockEngine.processSymbolMap as any).mockResolvedValue(sm);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.hotspots.every((h: string) => !h.startsWith("root:"))).toBe(true);
    });

    it("should handle branching by producing one chain per branch", async () => {
        const sm = buildSymbolMap({ A: ["B", "C"], B: [], C: [] });
        (mockEngine.processSymbolMap as any).mockResolvedValue(sm);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains["A"]).toContain("A -> B");
        expect(out.call_chains["A"]).toContain("A -> C");
        expect(out.call_chains["A"]).toHaveLength(2);
    });

    it("should handle cycles gracefully", async () => {
        const sm = buildSymbolMap({ R: ["A"], A: ["B"], B: ["A"] });
        (mockEngine.processSymbolMap as any).mockResolvedValue(sm);

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
        (mockEngine.processSymbolMap as any).mockResolvedValue(buildSymbolMap(adj));

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        expect(out.call_chains["N0"][0]).toContain("N10 (Max Depth)");
    });

    it("should sort chains longest-first within each root group", async () => {
        const sm = buildSymbolMap({ A: ["B", "C"], B: [], C: ["D"], D: [] });
        (mockEngine.processSymbolMap as any).mockResolvedValue(sm);

        const result = await handler({ paths: ["foo"] });
        const out = decoded(result);

        const chains = out.call_chains["A"] as string[];
        // Longest chain first: A -> C -> D (3 hops) before A -> B (2 hops)
        expect(chains[0]).toBe("A -> C -> D");
        expect(chains[1]).toBe("A -> B");
    });
});
