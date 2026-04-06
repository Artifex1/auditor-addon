const std = @import("std");
const aud = @import("aud");

const graph = aud.graph;
const pipeline = aud.pipeline;
const cfg = aud.cfg;
const metrics_mod = aud.metrics;
const ts = @import("tree-sitter");

// ── Helpers ───────────────────────────────────────────────────────────

const fixture_dir = "tests/move/fixtures/";

fn runPipeline(allocator: std.mem.Allocator, files: []const []const u8) !*pipeline.Pipeline {
    const pipe = try allocator.create(pipeline.Pipeline);
    pipe.* = try pipeline.Pipeline.init(allocator, cfg.getConfig(.move));
    try pipe.run(files, false);
    return pipe;
}

fn parseMove(source: []const u8) !struct { tree: *ts.Tree, parser: *ts.Parser } {
    const parser = ts.Parser.create();
    try parser.setLanguage(cfg.Language.move.grammarFn()());
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
        if (!ref.resolved or !ref.hasTargets()) continue;
        if (!std.mem.eql(u8, ref.target_name, target_name)) continue;
        if (g.lookupNode(ref.from)) |from_node| {
            if (std.mem.eql(u8, from_node.name, from_name)) return true;
        }
    }
    return false;
}

// ── Pipeline: Graph Construction ──────────────────────────────────────

test "pipeline: simple_module — function nodes detected" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "simple_module.move"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    try std.testing.expect(hasNodeNamed(g, "increment", .callable));
    try std.testing.expect(hasNodeNamed(g, "add", .callable));
    try std.testing.expect(hasNodeNamed(g, "main", .callable));
}

test "pipeline: simple_module — free function call resolution" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "simple_module.move"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    try std.testing.expect(hasRefWithTarget(g, "main", "increment"));
    try std.testing.expect(hasRefWithTarget(g, "main", "add"));
}

// ── Metrics ──────────────────────────────────────────────────────────

test "metrics: deep_nesting — cognitive complexity" {
    const source = @embedFile("fixtures/deep_nesting.move");
    const result = try parseMove(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.move);
    const m = metrics_mod.computeMetrics(result.tree, source, lang_config.metrics);

    // 3 nested ifs: depth 0=1, depth 1=2, depth 2=3 → total=6
    try std.testing.expectEqual(@as(u32, 6), m.cognitive_complexity);
}
