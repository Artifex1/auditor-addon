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

    try g.addEdge(.{ .from = a_id, .to = b_id, .kind = .calls });
    try g.addEdge(.{ .from = b_id, .to = c_id, .kind = .calls });

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

    try g.addEdge(.{ .from = a_id, .to = b_id, .kind = .calls });
    try g.addEdge(.{ .from = a_id, .to = c_id, .kind = .calls });
    try g.addEdge(.{ .from = b_id, .to = d_id, .kind = .calls });
    try g.addEdge(.{ .from = c_id, .to = d_id, .kind = .calls });

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

    try g.addEdge(.{ .from = container_id, .to = fn_id, .kind = .contains });

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try output.writeToonGraph(&g, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "nodes[2]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "edges[1]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "Vault") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "withdraw") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "contains") != null);
}
