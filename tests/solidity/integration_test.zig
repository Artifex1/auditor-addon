const std = @import("std");
const aud = @import("aud");

const graph = aud.graph;
const pipeline = aud.pipeline;
const cfg = aud.cfg;
const metrics_mod = aud.metrics;
const peek_mod = aud.peek;
const call_chains = aud.call_chains;
const output = aud.output;
const resolution = aud.resolution;
const ts = @import("tree-sitter");

// ── Helpers ───────────────────────────────────────────────────────────

const fixture_dir = "tests/solidity/fixtures/";

fn runPipeline(allocator: std.mem.Allocator, files: []const []const u8) !*pipeline.Pipeline {
    const pipe = try allocator.create(pipeline.Pipeline);
    pipe.* = try pipeline.Pipeline.init(allocator, cfg.getConfig(.solidity));
    try pipe.run(files, false);
    return pipe;
}

fn parseSolidity(source: []const u8) !struct { tree: *ts.Tree, parser: *ts.Parser } {
    const parser = ts.Parser.create();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
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

fn hasGap(g: *const graph.SymbolGraph, target_name: []const u8) bool {
    for (g.refs.items) |ref| {
        if (ref.gap != null and std.mem.eql(u8, ref.target_name, target_name)) return true;
    }
    return false;
}

// ── Pipeline: Full Graph Construction ────────────────────────────────

test "pipeline: SimpleVault — nodes, contains, state refs" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "SimpleVault.sol"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // Contract node
    try std.testing.expect(hasNodeNamed(g, "SimpleVault", .container));

    // Functions
    try std.testing.expect(hasNodeNamed(g, "deposit", .callable));
    try std.testing.expect(hasNodeNamed(g, "withdraw", .callable));
    try std.testing.expect(hasNodeNamed(g, "getBalance", .callable));
    try std.testing.expect(hasNodeNamed(g, "_internalHelper", .callable));
    try std.testing.expect(hasNodeNamed(g, "privateFunction", .callable));

    // State variables
    try std.testing.expect(hasNodeNamed(g, "totalSupply", .variable));
    try std.testing.expect(hasNodeNamed(g, "balances", .variable));

    // Contains edges
    try std.testing.expect(g.containsCount() > 0);

    // State write refs should resolve (deposit writes totalSupply and balances)
    try std.testing.expect(hasRefWithTarget(g, "deposit", "totalSupply"));
    try std.testing.expect(hasRefWithTarget(g, "deposit", "balances"));

    // No gaps for internal state refs
    try std.testing.expectEqual(@as(u32, 0), g.gapCount());
}

test "pipeline: InternalCalls — call chain resolves" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "InternalCalls.sol"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // a calls b, b calls c — both should resolve
    try std.testing.expect(hasRefWithTarget(g, "a", "b"));
    try std.testing.expect(hasRefWithTarget(g, "b", "c"));

    // No gaps (all calls are internal)
    try std.testing.expectEqual(@as(u32, 0), g.gapCount());
}

test "pipeline: Inheritance — child resolves parent function" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "Inheritance.sol"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // Both contracts should exist
    try std.testing.expect(hasNodeNamed(g, "Parent", .container));
    try std.testing.expect(hasNodeNamed(g, "Child", .container));

    // childFunc calls parentFunc — should resolve via inheritance
    try std.testing.expect(hasRefWithTarget(g, "childFunc", "parentFunc"));
    try std.testing.expectEqual(@as(u32, 0), g.gapCount());
}

test "pipeline: GapScenarios — external calls and missing functions" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "GapScenarios.sol"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // Internal call resolves
    try std.testing.expect(hasRefWithTarget(g, "doCheck", "_internalCheck"));

    // External call: token.transfer → gap with low priority (Solidity resolve hook)
    try std.testing.expect(hasGap(g, "transfer"));

    // Missing function: _hashData → gap with medium priority
    try std.testing.expect(hasGap(g, "_hashData"));

    // At least 2 gaps total
    try std.testing.expect(g.gapCount() >= 2);
}

test "pipeline: GapScenarios — resolution round-trip" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "GapScenarios.sol"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }

    // Find the transfer gap ref_id
    var transfer_ref_id: ?u64 = null;
    for (pipe.graph.refs.items) |ref| {
        if (ref.gap != null and std.mem.eql(u8, ref.target_name, "transfer")) {
            transfer_ref_id = ref.id;
            break;
        }
    }
    try std.testing.expect(transfer_ref_id != null);

    // Build a resolution CSV pointing transfer → SimpleToken.transfer (line 12)
    var csv_buf: [256]u8 = undefined;
    const csv = try std.fmt.bufPrint(&csv_buf, "ref_id,target_file,target_line,target_name\n{x},{s},12,transfer\n", .{
        transfer_ref_id.?,
        @as([]const u8, fixture_dir ++ "GapScenarios.sol"),
    });

    var diag = resolution.ResolutionDiag.init(allocator);
    defer diag.deinit();
    const resolutions = try resolution.parseResolutionFile(csv, allocator, &diag);
    defer allocator.free(resolutions);

    try resolution.applyResolutions(&pipe.graph, resolutions, &diag);

    try std.testing.expectEqual(@as(u32, 1), diag.resolved_count);
    try std.testing.expectEqual(@as(usize, 0), diag.stale.items.len);
    try std.testing.expectEqual(@as(usize, 0), diag.broken.items.len);

    // transfer gap should be cleared
    try std.testing.expect(!hasGap(&pipe.graph, "transfer"));
    // _hashData gap should remain
    try std.testing.expect(hasGap(&pipe.graph, "_hashData"));
}

// ── Call Chains: Full Pipeline ───────────────────────────────────────

test "call_chains: InternalCalls — a → b → c chain" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "InternalCalls.sol"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }

    const results = try call_chains.computeCallChains(&pipe.graph, null, 10, allocator);
    defer call_chains.freeCallChains(results, allocator);

    // Should find chains from root functions
    try std.testing.expect(results.len > 0);

    // Find the chain starting from 'a'
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

// ── Metrics: Fixture Files ───────────────────────────────────────────

test "metrics: DeepNesting fixture — cognitive complexity" {
    const source = @embedFile("fixtures/DeepNesting.sol");
    const result = try parseSolidity(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.solidity);
    const m = metrics_mod.computeMetrics(result.tree, source, lang_config.metrics, &.{});

    // 3 nested ifs: depth 0=1, depth 1=2, depth 2=3 → total=6
    try std.testing.expectEqual(@as(u32, 6), m.cognitive_complexity);
}

test "metrics: Documented fixture — comment counting" {
    const source = @embedFile("fixtures/Documented.sol");
    const result = try parseSolidity(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.solidity);
    const m = metrics_mod.computeMetrics(result.tree, source, lang_config.metrics, &.{});

    // Comments: @notice, Internal state variable, @notice Sets, @param
    try std.testing.expect(m.comment_lines >= 4);
    try std.testing.expect(m.comment_density > 0);
}

test "metrics: Metrics fixture — simple contract" {
    const source = @embedFile("fixtures/Metrics.sol");
    const result = try parseSolidity(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.solidity);
    const m = metrics_mod.computeMetrics(result.tree, source, lang_config.metrics, &.{});

    try std.testing.expectEqual(@as(u32, 0), m.cognitive_complexity);
    try std.testing.expect(m.nloc > 0);
}

// ── Peek: Fixture Files ──────────────────────────────────────────────

test "peek: SimpleVault fixture — extracts signatures" {
    const allocator = std.testing.allocator;
    const source = @embedFile("fixtures/SimpleVault.sol");
    const result = try parseSolidity(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.solidity);
    const sigs = try peek_mod.extractSignatures(result.tree, source, lang_config, "SimpleVault.sol", allocator, &.{});
    defer allocator.free(sigs);

    try std.testing.expect(sigs.len >= 2);

    var found_deposit = false;
    var found_withdraw = false;
    for (sigs) |sig| {
        defer allocator.free(sig.text);
        if (std.mem.indexOf(u8, sig.text, "deposit") != null) found_deposit = true;
        if (std.mem.indexOf(u8, sig.text, "withdraw") != null) found_withdraw = true;
    }
    try std.testing.expect(found_deposit);
    try std.testing.expect(found_withdraw);
}

// ── Output: TOON/JSON formatting from real graph ─────────────────────

test "output: TOON gaps from GapScenarios" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "GapScenarios.sol"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try output.writeToonGaps(&pipe.graph, &w);
    try w.flush();

    const out = buf[0..w.end];
    // Should contain gaps for transfer and _hashData
    try std.testing.expect(std.mem.indexOf(u8, out, "transfer") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "_hashData") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "gaps[") != null);
}

test "output: TOON graph from SimpleVault" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "SimpleVault.sol"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }

    var buf: [8192]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try output.writeToonGraph(&pipe.graph, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "nodes[") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "contains[") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "refs[") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "SimpleVault") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "deposit") != null);
}

test "pipeline: StructConstructor — struct instantiation is not a gap" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "StructConstructor.sol"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    const g = &pipe.graph;

    // Struct and enum tracked as type_def nodes
    try std.testing.expect(hasNodeNamed(g, "Proposal", .type_def));
    try std.testing.expect(hasNodeNamed(g, "Status", .type_def));

    // Struct constructor call resolves (no gap)
    try std.testing.expect(hasRefWithTarget(g, "create", "Proposal"));
    try std.testing.expectEqual(@as(u32, 0), g.gapCount());
}

test "output: JSON gaps from GapScenarios" {
    const allocator = std.testing.allocator;
    const files = [_][]const u8{fixture_dir ++ "GapScenarios.sol"};
    const pipe = try runPipeline(allocator, &files);
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try output.writeJsonGaps(&pipe.graph, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.startsWith(u8, out, "{\"gaps\":["));
    try std.testing.expect(std.mem.indexOf(u8, out, "transfer") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "_hashData") != null);
}
