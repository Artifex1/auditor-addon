const std = @import("std");
const aud = @import("aud");

const graph = aud.graph;
const pipeline = aud.pipeline;
const cfg = aud.cfg;
const metrics_mod = aud.metrics;
const call_chains = aud.call_chains;
const ts = @import("tree-sitter");

// ── Helpers ───────────────────────────────────────────────────────────

const fixture_dir = "tests/javascript/fixtures/";

fn runPipeline(allocator: std.mem.Allocator, files: []const []const u8) !*pipeline.Pipeline {
    const pipe = try allocator.create(pipeline.Pipeline);
    pipe.* = try pipeline.Pipeline.init(allocator, cfg.getConfig(.javascript));
    try pipe.run(files, false);
    return pipe;
}

fn parseJavaScript(source: []const u8) !struct { tree: *ts.Tree, parser: *ts.Parser } {
    const parser = ts.Parser.create();
    try parser.setLanguage(cfg.Language.javascript.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    return .{ .tree = tree, .parser = parser };
}

fn hasNodeNamed(g: *const graph.SymbolGraph, name: []const u8, kind: graph.NodeKind) bool {
    var it = g.nodes.iterator();
    while (it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (node.kind == kind and std.mem.eql(u8, node.name, name)) return true;
    }
    return false;
}

fn hasRefWithTarget(g: *const graph.SymbolGraph, from_name: []const u8, target_name: []const u8) bool {
    for (g.refs.items) |ref| {
        if (!ref.hasTargets()) continue;
        if (!std.mem.eql(u8, ref.target_name, target_name)) continue;
        if (g.lookupNode(ref.from)) |from_node| {
            if (std.mem.eql(u8, from_node.name, from_name)) return true;
        }
    }
    return false;
}

// ── Pipeline Tests ────────────────────────────────────────────────────

test "pipeline: simple_funcs — function nodes and call chain" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "simple_funcs.js"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // Functions
    try std.testing.expect(hasNodeNamed(g, "a", .callable));
    try std.testing.expect(hasNodeNamed(g, "b", .callable));
    try std.testing.expect(hasNodeNamed(g, "c", .callable));

    // Call resolution: a → b → c
    try std.testing.expect(hasRefWithTarget(g, "a", "b"));
    try std.testing.expect(hasRefWithTarget(g, "b", "c"));

    // No gaps
    try std.testing.expectEqual(@as(u32, 0), g.gapCount());
}

test "pipeline: simple_class — class container with methods" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "simple_class.js"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // Class as container
    try std.testing.expect(hasNodeNamed(g, "Counter", .container));

    // Methods
    try std.testing.expect(hasNodeNamed(g, "constructor", .callable));
    try std.testing.expect(hasNodeNamed(g, "increment", .callable));
    try std.testing.expect(hasNodeNamed(g, "get", .callable));

    // Contains edges
    try std.testing.expect(g.containsCount() > 0);
}

// ── Call Chains ───────────────────────────────────────────────────────

test "call_chains: simple_funcs — a → b → c chain" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "simple_funcs.js"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }

    const results = try call_chains.computeCallChains(&pipe.graph, null, 10, allocator);
    defer call_chains.freeCallChains(results, allocator);

    try std.testing.expect(results.len > 0);

    var found_a_chain = false;
    for (results) |cs| {
        if (std.mem.eql(u8, cs.root_name, "a")) {
            found_a_chain = true;
            try std.testing.expect(cs.chains.items.len > 0);
            const chain = try call_chains.formatChain(cs.chains.items[0], allocator);
            defer allocator.free(chain);
            try std.testing.expectEqualStrings("a -> b -> c", chain);
        }
    }
    try std.testing.expect(found_a_chain);
}

// ── Metrics ──────────────────────────────────────────────────────────

test "metrics: deep_nesting — cognitive complexity" {
    const source = @embedFile("fixtures/deep_nesting.js");
    const result = try parseJavaScript(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.javascript);
    const m = metrics_mod.computeMetrics(result.tree, source, lang_config.metrics, &.{});

    // 3 nested ifs: depth 0=1, depth 1=2, depth 2=3 → total=6
    try std.testing.expectEqual(@as(u32, 6), m.cognitive_complexity);
}
