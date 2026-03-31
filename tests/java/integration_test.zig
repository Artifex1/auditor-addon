const std = @import("std");
const aa = @import("aa");

const graph = aa.graph;
const pipeline = aa.pipeline;
const cfg = aa.cfg;
const metrics_mod = aa.metrics;
const ts = @import("tree-sitter");

// ── Helpers ───────────────────────────────────────────────────────────

const fixture_dir = "tests/java/fixtures/";

fn runPipeline(allocator: std.mem.Allocator, files: []const []const u8) !*pipeline.Pipeline {
    const pipe = try allocator.create(pipeline.Pipeline);
    pipe.* = try pipeline.Pipeline.init(allocator, cfg.getConfig(.java));
    try pipe.run(files, false);
    return pipe;
}

fn parseJava(source: []const u8) !struct { tree: *ts.Tree, parser: *ts.Parser } {
    const parser = ts.Parser.create();
    try parser.setLanguage(cfg.Language.java.grammarFn()());
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

test "pipeline: SimpleFuncs — method nodes detected" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "SimpleFuncs.java"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    try std.testing.expect(hasNodeNamed(g, "a", .callable));
    try std.testing.expect(hasNodeNamed(g, "b", .callable));
    try std.testing.expect(hasNodeNamed(g, "c", .callable));
}

test "pipeline: SimpleFuncs — call resolution a→b, b→c" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "SimpleFuncs.java"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    try std.testing.expect(hasRefWithTarget(g, "a", "b"));
    try std.testing.expect(hasRefWithTarget(g, "b", "c"));

    try std.testing.expectEqual(@as(u32, 0), g.gapCount());
}

test "pipeline: SimpleFuncs — class container detection" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "SimpleFuncs.java"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    try std.testing.expect(hasNodeNamed(g, "SimpleFuncs", .container));
    try std.testing.expect(g.containsCount() > 0);
}

// ── Metrics ──────────────────────────────────────────────────────────

test "metrics: DeepNesting — cognitive complexity = 6" {
    const source = @embedFile("fixtures/DeepNesting.java");
    const result = try parseJava(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.java);
    const m = metrics_mod.computeMetrics(result.tree, source, lang_config.metrics);

    // 3 nested ifs: depth 0=1, depth 1=2, depth 2=3 → total=6
    try std.testing.expectEqual(@as(u32, 6), m.cognitive_complexity);
}
