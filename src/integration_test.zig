const std = @import("std");
const ts = @import("tree-sitter");
const cfg = @import("languages/config.zig");
const graph = @import("graph.zig");
const pipeline = @import("pipeline.zig");
const metrics_mod = @import("metrics.zig");
const peek_mod = @import("peek.zig");
const call_chains = @import("call_chains.zig");
const output = @import("output.zig");

// ── Helpers ───────────────────────────────────────────────────────────

fn parseSolidity(source: []const u8) !struct { tree: *ts.Tree, parser: *ts.Parser } {
    const parser = ts.Parser.create();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    return .{ .tree = tree, .parser = parser };
}

// ── Peek Tests ────────────────────────────────────────────────────────

test "peek: extract signatures from SimpleVault" {
    const allocator = std.testing.allocator;
    const source =
        \\contract SimpleVault {
        \\    uint256 public totalSupply;
        \\    function deposit(uint256 amount) external {
        \\        totalSupply += amount;
        \\    }
        \\    function withdraw(uint256 amount) public {
        \\        totalSupply -= amount;
        \\    }
        \\}
    ;

    const result = try parseSolidity(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.solidity);
    const sigs = try peek_mod.extractSignatures(result.tree, source, lang_config, "test.sol", allocator);
    defer allocator.free(sigs);

    // Should find deposit and withdraw signatures
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

// ── Metrics Tests ─────────────────────────────────────────────────────

test "metrics: simple contract with no branches" {
    const source =
        \\contract Simple {
        \\    function test() public {
        \\        uint x = 1;
        \\    }
        \\}
    ;

    const result = try parseSolidity(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.solidity);
    const m = metrics_mod.computeMetrics(result.tree, source, lang_config.metrics);

    try std.testing.expectEqual(@as(u32, 5), m.total_lines);
    try std.testing.expectEqual(@as(u32, 0), m.blank_lines);
    try std.testing.expectEqual(@as(u32, 0), m.comment_lines);
    try std.testing.expectEqual(@as(u32, 0), m.cognitive_complexity);
    try std.testing.expect(m.nloc > 0);
}

test "metrics: deeply nested branches" {
    const source =
        \\contract DeepNesting {
        \\    function complex(uint a, uint b, uint c) public {
        \\        if (a > 0) {
        \\            if (b > 0) {
        \\                if (c > 0) {
        \\                    return;
        \\                }
        \\            }
        \\        }
        \\    }
        \\}
    ;

    const result = try parseSolidity(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.solidity);
    const m = metrics_mod.computeMetrics(result.tree, source, lang_config.metrics);

    // if at depth 0 = 1, if at depth 1 = 2, if at depth 2 = 3 => total = 6
    try std.testing.expectEqual(@as(u32, 6), m.cognitive_complexity);
    try std.testing.expectEqual(@as(u32, 11), m.total_lines);
}

test "metrics: comments counted correctly" {
    const source =
        \\// SPDX-License-Identifier: MIT
        \\pragma solidity ^0.8.0;
        \\
        \\/// @notice Documented
        \\contract Documented {
        \\    // state var
        \\    uint256 private value;
        \\
        \\    /// @notice Sets value
        \\    /// @param newValue New value
        \\    function setValue(uint256 newValue) public {
        \\        value = newValue;
        \\    }
        \\}
    ;

    const result = try parseSolidity(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    const lang_config = cfg.getConfig(.solidity);
    const m = metrics_mod.computeMetrics(result.tree, source, lang_config.metrics);

    // 5 comment lines: SPDX, @notice Documented, state var, @notice Sets, @param
    try std.testing.expectEqual(@as(u32, 5), m.comment_lines);
    try std.testing.expectEqual(@as(u32, 2), m.blank_lines);
    try std.testing.expect(m.comment_density > 0);
}

test "metrics: estimated hours proportional to nloc" {
    const small_source =
        \\contract Small {
        \\    function foo() public { uint x = 1; }
        \\}
    ;
    const large_source =
        \\contract Large {
        \\    function foo() public { uint x = 1; }
        \\    function bar() public { uint y = 2; }
        \\    function baz() public { uint z = 3; }
        \\    function qux() public { uint w = 4; }
        \\    function quux() public { uint v = 5; }
        \\}
    ;

    const small = try parseSolidity(small_source);
    defer small.tree.destroy();
    defer small.parser.destroy();

    const large = try parseSolidity(large_source);
    defer large.tree.destroy();
    defer large.parser.destroy();

    const lang_config = cfg.getConfig(.solidity);
    const sm = metrics_mod.computeMetrics(small.tree, small_source, lang_config.metrics);
    const lm = metrics_mod.computeMetrics(large.tree, large_source, lang_config.metrics);

    try std.testing.expect(lm.nloc > sm.nloc);
    try std.testing.expect(lm.estimated_hours > sm.estimated_hours);
}

// ── Graph Construction Tests ──────────────────────────────────────────

test "pipeline: parse solidity and build graph nodes" {
    const source =
        \\contract Test {
        \\    function a() public {
        \\        b();
        \\    }
        \\    function b() public {}
        \\}
    ;

    const result = try parseSolidity(source);
    defer result.tree.destroy();
    defer result.parser.destroy();

    // We can't easily test the full pipeline without file I/O,
    // but we can verify tree-sitter parses correctly and finds the expected nodes
    const root = result.tree.rootNode();
    try std.testing.expectEqualStrings("source_file", root.kind());
    try std.testing.expect(root.childCount() > 0);

    // Find contract_declaration
    var found_contract = false;
    var found_functions: u32 = 0;
    var cursor = result.tree.walk();
    defer cursor.destroy();

    var descend = true;
    outer: while (true) {
        if (descend) {
            const node = cursor.node();
            if (std.mem.eql(u8, node.kind(), "contract_declaration")) found_contract = true;
            if (std.mem.eql(u8, node.kind(), "function_definition")) found_functions += 1;
        }
        if (descend and cursor.gotoFirstChild()) continue;
        descend = true;
        if (cursor.gotoNextSibling()) continue;
        while (true) {
            if (!cursor.gotoParent()) break :outer;
            if (cursor.gotoNextSibling()) break;
        }
    }

    try std.testing.expect(found_contract);
    try std.testing.expectEqual(@as(u32, 2), found_functions);
}

// ── Call Chains Tests ─────────────────────────────────────────────────

test "call_chains: linear chain A -> B -> C" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    const a_id = graph.nodeId("a", "test.sol", 1);
    const b_id = graph.nodeId("b", "test.sol", 5);
    const c_id = graph.nodeId("c", "test.sol", 9);

    _ = try g.addNode(.{ .id = a_id, .kind = .callable, .language_kind = "function_definition", .name = "a", .qualified_name = "Test.a", .language = .solidity });
    _ = try g.addNode(.{ .id = b_id, .kind = .callable, .language_kind = "function_definition", .name = "b", .qualified_name = "Test.b", .language = .solidity });
    _ = try g.addNode(.{ .id = c_id, .kind = .callable, .language_kind = "function_definition", .name = "c", .qualified_name = "Test.c", .language = .solidity });

    var t1: std.ArrayListUnmanaged(u64) = .empty;
    try t1.append(allocator, b_id);
    try g.addRef(.{
        .id = graph.refId("test.sol", 10),
        .from = a_id,
        .kind = .call,
        .target_name = "b",
        .site = .{ .file = "test.sol", .start_byte = 10, .end_byte = 20, .line = 2, .column = 0 },
        .targets = t1,
        .resolved = true,
    });

    var t2: std.ArrayListUnmanaged(u64) = .empty;
    try t2.append(allocator, c_id);
    try g.addRef(.{
        .id = graph.refId("test.sol", 30),
        .from = b_id,
        .kind = .call,
        .target_name = "c",
        .site = .{ .file = "test.sol", .start_byte = 30, .end_byte = 40, .line = 6, .column = 0 },
        .targets = t2,
        .resolved = true,
    });

    const results = try call_chains.computeCallChains(&g, null, 10, allocator);
    defer {
        for (results) |*cs| {
            for (cs.chains.items) |ch| allocator.free(ch.path);
            cs.chains.deinit(allocator);
        }
        allocator.free(results);
    }

    // Only 'a' is a root (b and c have incoming calls)
    try std.testing.expectEqual(@as(usize, 1), results.len);
    try std.testing.expectEqualStrings("a", results[0].root_name);
    try std.testing.expect(results[0].chains.items.len > 0);

    // Should have chain: a -> b -> c
    const chain = try call_chains.formatChain(results[0].chains.items[0], allocator);
    defer allocator.free(chain);
    try std.testing.expectEqualStrings("a -> b -> c", chain);
}

test "call_chains: diamond — no duplicate paths" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    // A calls B and C, both call D
    const a_id = graph.nodeId("A", "test.sol", 1);
    const b_id = graph.nodeId("B", "test.sol", 2);
    const c_id = graph.nodeId("C", "test.sol", 3);
    const d_id = graph.nodeId("D", "test.sol", 4);

    _ = try g.addNode(.{ .id = a_id, .kind = .callable, .language_kind = "function_definition", .name = "A", .qualified_name = "A", .language = .solidity });
    _ = try g.addNode(.{ .id = b_id, .kind = .callable, .language_kind = "function_definition", .name = "B", .qualified_name = "B", .language = .solidity });
    _ = try g.addNode(.{ .id = c_id, .kind = .callable, .language_kind = "function_definition", .name = "C", .qualified_name = "C", .language = .solidity });
    _ = try g.addNode(.{ .id = d_id, .kind = .callable, .language_kind = "function_definition", .name = "D", .qualified_name = "D", .language = .solidity });

    var t_ab: std.ArrayListUnmanaged(u64) = .empty;
    try t_ab.append(allocator, b_id);
    try g.addRef(.{
        .id = graph.refId("test.sol", 10),
        .from = a_id,
        .kind = .call,
        .target_name = "B",
        .site = .{ .file = "test.sol", .start_byte = 10, .end_byte = 20, .line = 1, .column = 0 },
        .targets = t_ab,
        .resolved = true,
    });

    var t_ac: std.ArrayListUnmanaged(u64) = .empty;
    try t_ac.append(allocator, c_id);
    try g.addRef(.{
        .id = graph.refId("test.sol", 30),
        .from = a_id,
        .kind = .call,
        .target_name = "C",
        .site = .{ .file = "test.sol", .start_byte = 30, .end_byte = 40, .line = 1, .column = 10 },
        .targets = t_ac,
        .resolved = true,
    });

    var t_bd: std.ArrayListUnmanaged(u64) = .empty;
    try t_bd.append(allocator, d_id);
    try g.addRef(.{
        .id = graph.refId("test.sol", 50),
        .from = b_id,
        .kind = .call,
        .target_name = "D",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 2, .column = 0 },
        .targets = t_bd,
        .resolved = true,
    });

    var t_cd: std.ArrayListUnmanaged(u64) = .empty;
    try t_cd.append(allocator, d_id);
    try g.addRef(.{
        .id = graph.refId("test.sol", 70),
        .from = c_id,
        .kind = .call,
        .target_name = "D",
        .site = .{ .file = "test.sol", .start_byte = 70, .end_byte = 80, .line = 3, .column = 0 },
        .targets = t_cd,
        .resolved = true,
    });

    const results = try call_chains.computeCallChains(&g, null, 10, allocator);
    defer {
        for (results) |*cs| {
            for (cs.chains.items) |ch| allocator.free(ch.path);
            cs.chains.deinit(allocator);
        }
        allocator.free(results);
    }

    // A is the only root
    try std.testing.expectEqual(@as(usize, 1), results.len);
    // Should have at least 2 chains: A->B->D and A->C->D
    try std.testing.expect(results[0].chains.items.len >= 2);
}

// ── Output Formatting Tests ───────────────────────────────────────────

test "output: TOON graph dump includes nodes and edges" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    const container_id = graph.nodeId("Vault", "src/Vault.sol", 4);
    _ = try g.addNode(.{
        .id = container_id,
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Vault",
        .qualified_name = "Vault",
        .language = .solidity,
        .locator = .{ .file = "src/Vault.sol", .start_byte = 0, .end_byte = 100, .line = 4, .column = 0 },
    });

    const fn_id = graph.nodeId("withdraw", "src/Vault.sol", 10);
    _ = try g.addNode(.{
        .id = fn_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "Vault.withdraw",
        .container = container_id,
        .visibility = "public",
        .language = .solidity,
        .locator = .{ .file = "src/Vault.sol", .start_byte = 50, .end_byte = 100, .line = 10, .column = 4 },
    });

    try g.addContains(container_id, fn_id);

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try output.writeToonGraph(&g, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "nodes[2]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "contains[1]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "Vault") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "withdraw") != null);
}

// ── Deep Walker Tests ────────────────────────────────────────────────

test "deep walker: site-based lookup follows correct callee" {
    // This is the key regression test for the bug that motivated the refactor:
    // function with two calls should follow each to the correct callee, not all callees.
    const allocator = std.testing.allocator;

    const source =
        \\contract Test {
        \\    function caller() public {
        \\        foo();
        \\        bar();
        \\    }
        \\    function foo() internal {}
        \\    function bar() internal {}
        \\}
    ;

    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    const file_id = graph.nodeId("test.sol", "test.sol", 1);
    _ = try g.addNode(.{
        .id = file_id,
        .kind = .file,
        .language_kind = "source_file",
        .name = "test.sol",
        .qualified_name = "test.sol",
        .language = .solidity,
        .ast_node = tree.rootNode(),
        .locator = .{ .file = "test.sol", .start_byte = 0, .end_byte = @intCast(source.len), .line = 1, .column = 0 },
    });

    // Find the two call_expression nodes in the AST
    var call_sites: [2]struct { start_byte: u32, text: []const u8 } = undefined;
    var call_count: usize = 0;
    var cursor = tree.walk();
    defer cursor.destroy();
    var descend = true;
    outer: while (true) {
        if (descend) {
            const node = cursor.node();
            if (std.mem.eql(u8, node.kind(), "call_expression") and call_count < 2) {
                call_sites[call_count] = .{
                    .start_byte = node.startByte(),
                    .text = source[node.startByte()..node.endByte()],
                };
                call_count += 1;
            }
        }
        if (descend and cursor.gotoFirstChild()) continue;
        descend = true;
        if (cursor.gotoNextSibling()) continue;
        while (true) {
            if (!cursor.gotoParent()) break :outer;
            if (cursor.gotoNextSibling()) break;
        }
    }

    try std.testing.expectEqual(@as(usize, 2), call_count);

    // Create caller + foo + bar graph nodes
    const caller_id = graph.nodeId("caller", "test.sol", 2);
    _ = try g.addNode(.{
        .id = caller_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "caller",
        .qualified_name = "Test.caller",
        .language = .solidity,
    });

    const foo_id = graph.nodeId("foo", "test.sol", 6);
    _ = try g.addNode(.{
        .id = foo_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "foo",
        .qualified_name = "Test.foo",
        .language = .solidity,
    });

    const bar_id = graph.nodeId("bar", "test.sol", 7);
    _ = try g.addNode(.{
        .id = bar_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "bar",
        .qualified_name = "Test.bar",
        .language = .solidity,
    });

    // Create references: foo() call → foo, bar() call → bar
    var foo_targets: std.ArrayListUnmanaged(u64) = .empty;
    try foo_targets.append(allocator, foo_id);
    try g.addRef(.{
        .id = graph.refId("test.sol", call_sites[0].start_byte),
        .from = caller_id,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "test.sol", .start_byte = call_sites[0].start_byte, .end_byte = call_sites[0].start_byte + 5, .line = 3, .column = 0 },
        .targets = foo_targets,
        .resolved = true,
    });

    var bar_targets: std.ArrayListUnmanaged(u64) = .empty;
    try bar_targets.append(allocator, bar_id);
    try g.addRef(.{
        .id = graph.refId("test.sol", call_sites[1].start_byte),
        .from = caller_id,
        .kind = .call,
        .target_name = "bar",
        .site = .{ .file = "test.sol", .start_byte = call_sites[1].start_byte, .end_byte = call_sites[1].start_byte + 5, .line = 4, .column = 0 },
        .targets = bar_targets,
        .resolved = true,
    });

    try g.buildSiteIndex();

    // Verify each ref maps to exactly its callee
    const ref1 = g.lookupRef(graph.refId("test.sol", call_sites[0].start_byte));
    try std.testing.expect(ref1 != null);
    try std.testing.expectEqual(foo_id, ref1.?.firstTarget().?);

    const ref2 = g.lookupRef(graph.refId("test.sol", call_sites[1].start_byte));
    try std.testing.expect(ref2 != null);
    try std.testing.expectEqual(bar_id, ref2.?.firstTarget().?);

    // The two refs should have different IDs (the old gapId model would collide)
    try std.testing.expect(ref1.?.id != ref2.?.id);
}

// ── Reference Resolution Tests ───────────────────────────────────────

test "resolution: round-trip gaps → CSV → apply" {
    const allocator = std.testing.allocator;
    const resolution = @import("resolution.zig");

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    // Create a target node that the resolution will point to
    const target_id = graph.nodeId("onlyOwner", "src/Ownable.sol", 15);
    _ = try g.addNode(.{
        .id = target_id,
        .kind = .modifier,
        .language_kind = "modifier_definition",
        .name = "onlyOwner",
        .qualified_name = "Ownable.onlyOwner",
        .language = .solidity,
    });

    // Create an unresolved ref (gap)
    const rid = graph.refId("src/Vault.sol", 100);
    try g.addRef(.{
        .id = rid,
        .from = 42,
        .kind = .modifier_use,
        .target_name = "onlyOwner",
        .site = .{ .file = "src/Vault.sol", .start_byte = 100, .end_byte = 120, .line = 10, .column = 4 },
        .targets = .empty,
        .gap = .high,
        .resolved = true,
    });

    // Format a CSV that resolves this gap
    var csv_buf: [256]u8 = undefined;
    const csv = try std.fmt.bufPrint(&csv_buf, "ref_id,target_file,target_line,target_name\n{x},src/Ownable.sol,15,onlyOwner\n", .{rid});

    const resolutions = try resolution.parseResolutionFile(csv, allocator);
    defer allocator.free(resolutions);
    try std.testing.expectEqual(@as(usize, 1), resolutions.len);

    var result = resolution.ResolutionResult.init(allocator);
    defer result.deinit();
    try resolution.applyResolutions(&g, resolutions, &result);

    try std.testing.expectEqual(@as(u32, 1), result.resolved);
    try std.testing.expectEqual(@as(u32, 0), result.stale);
    try std.testing.expectEqual(@as(u32, 0), result.broken);

    // The ref should now have a target and no gap
    try g.buildSiteIndex();
    const ref = g.lookupRef(rid).?;
    try std.testing.expect(ref.hasTargets());
    try std.testing.expectEqual(target_id, ref.firstTarget().?);
    try std.testing.expect(ref.gap == null);
}

test "call_chains: max_depth limits traversal" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    // A → B → C → D (depth 3)
    const ids = [4]u64{
        graph.nodeId("a", "t.sol", 1),
        graph.nodeId("b", "t.sol", 2),
        graph.nodeId("c", "t.sol", 3),
        graph.nodeId("d", "t.sol", 4),
    };
    const names = [4][]const u8{ "a", "b", "c", "d" };

    for (ids, names, 1..) |id, name, line| {
        _ = try g.addNode(.{
            .id = id,
            .kind = .callable,
            .language_kind = "function_definition",
            .name = name,
            .qualified_name = name,
            .language = .solidity,
            .locator = .{ .file = "t.sol", .start_byte = 0, .end_byte = 10, .line = @intCast(line), .column = 0 },
        });
    }

    // Create call chain: a→b→c→d
    var byte_offset: u32 = 10;
    for (0..3) |i| {
        var t: std.ArrayListUnmanaged(u64) = .empty;
        try t.append(allocator, ids[i + 1]);
        try g.addRef(.{
            .id = graph.refId("t.sol", byte_offset),
            .from = ids[i],
            .kind = .call,
            .target_name = names[i + 1],
            .site = .{ .file = "t.sol", .start_byte = byte_offset, .end_byte = byte_offset + 5, .line = @intCast(i + 1), .column = 0 },
            .targets = t,
            .resolved = true,
        });
        byte_offset += 20;
    }

    // max_depth=1 should only find a→b
    const results1 = try call_chains.computeCallChains(&g, null, 1, allocator);
    defer {
        for (results1) |*cs| {
            for (cs.chains.items) |ch| allocator.free(ch.path);
            cs.chains.deinit(allocator);
        }
        allocator.free(results1);
    }
    try std.testing.expectEqual(@as(usize, 1), results1.len);
    // Chain should be truncated
    for (results1[0].chains.items) |ch| {
        try std.testing.expect(ch.path.len <= 2);
    }
}

test "call_chains: root filter selects specific function" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    const a_id = graph.nodeId("a", "t.sol", 1);
    const b_id = graph.nodeId("b", "t.sol", 2);

    _ = try g.addNode(.{ .id = a_id, .kind = .callable, .language_kind = "function_definition", .name = "a", .qualified_name = "a", .language = .solidity });
    _ = try g.addNode(.{ .id = b_id, .kind = .callable, .language_kind = "function_definition", .name = "b", .qualified_name = "b", .language = .solidity });

    // Both are roots (no incoming calls), but filter for "b" only
    const filter = [_][]const u8{"b"};
    const results = try call_chains.computeCallChains(&g, &filter, 10, allocator);
    defer {
        for (results) |*cs| {
            for (cs.chains.items) |ch| allocator.free(ch.path);
            cs.chains.deinit(allocator);
        }
        allocator.free(results);
    }

    try std.testing.expectEqual(@as(usize, 1), results.len);
    try std.testing.expectEqualStrings("b", results[0].root_name);
}

test "reference: provisional ref appears in gaps output" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    // Node for from_name lookup
    _ = try g.addNode(.{
        .id = 1,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "Vault.withdraw",
        .language = .solidity,
    });

    // Provisional ref: has attrs but also a gap
    try g.addRef(.{
        .id = graph.refId("test.sol", 50),
        .from = 1,
        .kind = .call,
        .target_name = "call",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .targets = .empty,
        .target_kind = .external,
        .gap = .low,
        .resolved = true,
    });

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try output.writeToonGaps(&g, &w);
    try w.flush();

    const out = buf[0..w.end];
    // Should include the provisional gap
    try std.testing.expect(std.mem.indexOf(u8, out, "gaps[1]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "call") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "low") != null);
}

test "reference: dropped refs not in gaps output" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    // Dropped ref: resolved but no gap, no target (local variable)
    try g.addRef(.{
        .id = graph.refId("test.sol", 50),
        .from = 1,
        .kind = .state_read,
        .target_name = "amount",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .targets = .empty,
        .resolved = true,
    });

    try std.testing.expectEqual(@as(u32, 0), g.gapCount());
}

test "graph: refs output shows resolved targets" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    _ = try g.addNode(.{
        .id = 1,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "caller",
        .qualified_name = "caller",
        .language = .solidity,
        .locator = .{ .file = "t.sol", .start_byte = 0, .end_byte = 50, .line = 1, .column = 0 },
    });

    _ = try g.addNode(.{
        .id = 2,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "callee",
        .qualified_name = "callee",
        .language = .solidity,
        .locator = .{ .file = "t.sol", .start_byte = 50, .end_byte = 100, .line = 5, .column = 0 },
    });

    var targets: std.ArrayListUnmanaged(u64) = .empty;
    try targets.append(allocator, 2);
    try g.addRef(.{
        .id = graph.refId("t.sol", 30),
        .from = 1,
        .kind = .call,
        .target_name = "callee",
        .site = .{ .file = "t.sol", .start_byte = 30, .end_byte = 40, .line = 3, .column = 0 },
        .targets = targets,
        .resolved = true,
    });

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try output.writeToonGraph(&g, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "refs[1]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "callee") != null);
}
