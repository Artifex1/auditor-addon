const std = @import("std");
const aud = @import("aud");

const graph = aud.graph;
const pipeline = aud.pipeline;
const cfg = aud.cfg;
const metrics_mod = aud.metrics;
const call_chains = aud.call_chains;
const output = aud.output;
const ts = @import("tree-sitter");

// ── Helpers ───────────────────────────────────────────────────────────

const fixture_dir = "tests/rust/fixtures/";

fn runPipeline(allocator: std.mem.Allocator, files: []const []const u8) !*pipeline.Pipeline {
    const pipe = try allocator.create(pipeline.Pipeline);
    pipe.* = try pipeline.Pipeline.init(allocator, cfg.getConfig(.rust));
    try pipe.run(files, false);
    return pipe;
}

fn parseRust(source: []const u8) !struct { tree: *ts.Tree, parser: *ts.Parser } {
    const parser = ts.Parser.create();
    try parser.setLanguage(cfg.Language.rust.grammarFn()());
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

test "pipeline: SimpleStruct — impl block nodes and methods" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "SimpleStruct.rs"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // impl block as container
    try std.testing.expect(hasNodeNamed(g, "Counter", .container));

    // Functions
    try std.testing.expect(hasNodeNamed(g, "new", .callable));
    try std.testing.expect(hasNodeNamed(g, "increment", .callable));
    try std.testing.expect(hasNodeNamed(g, "get", .callable));
    try std.testing.expect(hasNodeNamed(g, "reset", .callable));

    // Contains edges
    try std.testing.expect(g.containsCount() > 0);
}

test "pipeline: InternalCalls — free function call chain resolves" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "InternalCalls.rs"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // a calls b, b calls c — both should resolve
    try std.testing.expect(hasRefWithTarget(g, "a", "b"));
    try std.testing.expect(hasRefWithTarget(g, "b", "c"));

    // No gaps (all calls are internal free functions)
    try std.testing.expectEqual(@as(u32, 0), g.gapCount());
}

test "pipeline: MethodCalls — self.method() resolves within impl" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "MethodCalls.rs"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // deposit calls log_event, withdraw calls check_balance
    try std.testing.expect(hasRefWithTarget(g, "deposit", "log_event"));
    try std.testing.expect(hasRefWithTarget(g, "withdraw", "check_balance"));
}

test "pipeline: Modules — mod as container with functions" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "Modules.rs"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // mod is a container
    try std.testing.expect(hasNodeNamed(g, "math", .container));

    // Functions inside the module
    try std.testing.expect(hasNodeNamed(g, "add", .callable));
    try std.testing.expect(hasNodeNamed(g, "multiply", .callable));
    try std.testing.expect(hasNodeNamed(g, "main", .callable));
}

// ── Call Chains ───────────────────────────────────────────────────────

test "call_chains: InternalCalls — a → b → c chain" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "InternalCalls.rs"};
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

test "metrics: DeepNesting — cognitive complexity" {
    const source = @embedFile("fixtures/DeepNesting.rs");
    const result = try parseRust(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.rust);
    const m = metrics_mod.computeMetrics(result.tree, source, lang_config.metrics);

    // 3 nested ifs: depth 0=1, depth 1=2, depth 2=3 → total=6
    try std.testing.expectEqual(@as(u32, 6), m.cognitive_complexity);
}

// ── Output ───────────────────────────────────────────────────────────

test "output: JSON graph from SimpleStruct" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "SimpleStruct.rs"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }

    var buf: [8192]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try output.writeJsonGraph(&pipe.graph, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "Counter") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "increment") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"nodes\"") != null);
}
