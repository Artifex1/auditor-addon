const std = @import("std");
const ts = @import("tree-sitter");
const graph = @import("graph.zig");

// ── SPEC.md §5 — Walker ──────────────────────────────────────────────
//
// §5.1 Scope Walker: walks full file ASTs top-to-bottom.
//       Does not follow call edges.
// §5.2 Deep Walker: same as scope, but follows resolved calls edges
//       across function boundaries up to max_depth.
// §5.3 Walk Context: provided to Lua hooks.

pub const WalkContext = struct {
    current_file: []const u8,
    depth: u32,
    call_stack: []const u64,
    current_node: u64,
};

/// Callback type for walker hooks.
pub const WalkCallback = struct {
    enter_fn: *const fn (node: ts.Node, ctx: WalkContext) void,
    exit_fn: *const fn (node: ts.Node, ctx: WalkContext) void,
    finalize_fn: ?*const fn () void = null,
};

// ── §5.1 Scope Walker ────────────────────────────────────────────────

/// Walk all file ASTs top-to-bottom. Fires enter()/exit() for every node.
/// Calls finalize() once after all files are walked.
pub fn walkScope(
    g: *const graph.SymbolGraph,
    callback: WalkCallback,
) void {
    var it = g.nodes.iterator();
    while (it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (node.kind != .file) continue;
        const ast_root = node.ast_node orelse continue;
        const file = if (node.locator) |loc| loc.file else "";

        if (g.scoped_files) |scope| {
            if (!scope.contains(file)) continue;
        }

        const ctx = WalkContext{
            .current_file = file,
            .depth = 0,
            .call_stack = &.{node.id},
            .current_node = node.id,
        };

        walkAstNode(g, ast_root, ctx, callback);
    }

    if (callback.finalize_fn) |finalize| finalize();
}

/// Depth-first walk of a single AST node and its children.
/// Updates current_node when entering a graph-tracked scope (callable, container, modifier).
fn walkAstNode(g: *const graph.SymbolGraph, node: ts.Node, ctx: WalkContext, callback: WalkCallback) void {
    // Check if this AST node corresponds to a graph node (callable, container, modifier).
    // If so, update current_node for the duration of this subtree.
    const updated_ctx = updateContext(g, node, ctx);

    callback.enter_fn(node, updated_ctx);

    var i: u32 = 0;
    while (i < node.childCount()) : (i += 1) {
        if (node.child(i)) |child| {
            walkAstNode(g, child, updated_ctx, callback);
        }
    }

    callback.exit_fn(node, updated_ctx);
}

// ── §5.2 Deep Walker ─────────────────────────────────────────────────

/// Walk all file ASTs top-to-bottom, following resolved calls edges
/// across function boundaries up to max_depth. Calls finalize() once
/// after all files are walked.
pub fn walkDeep(
    g: *const graph.SymbolGraph,
    callback: WalkCallback,
    max_depth: u32,
    call_expression_type: []const u8,
    modifier_invocation_type: ?[]const u8,
    allocator: std.mem.Allocator,
) !void {
    var it = g.nodes.iterator();
    while (it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (node.kind != .file) continue;
        const ast_root = node.ast_node orelse continue;
        const file = if (node.locator) |loc| loc.file else "";

        if (g.scoped_files) |scope| {
            if (!scope.contains(file)) continue;
        }

        var visited: std.AutoHashMapUnmanaged(u64, void) = .empty;
        defer visited.deinit(allocator);

        var call_stack: std.ArrayListUnmanaged(u64) = .empty;
        defer call_stack.deinit(allocator);
        try call_stack.append(allocator, node.id);

        const ctx = WalkContext{
            .current_file = file,
            .depth = 0,
            .call_stack = call_stack.items,
            .current_node = node.id,
        };

        try walkAstNodeDeep(g, ast_root, ctx, callback, max_depth, 0, call_expression_type, modifier_invocation_type, &visited, &call_stack, allocator);
    }

    if (callback.finalize_fn) |finalize| finalize();
}

/// Deep walk: full AST traversal with call-reference following.
fn walkAstNodeDeep(
    g: *const graph.SymbolGraph,
    node: ts.Node,
    ctx: WalkContext,
    callback: WalkCallback,
    max_depth: u32,
    depth: u32,
    call_expression_type: []const u8,
    modifier_invocation_type: ?[]const u8,
    visited: *std.AutoHashMapUnmanaged(u64, void),
    call_stack: *std.ArrayListUnmanaged(u64),
    allocator: std.mem.Allocator,
) !void {
    const updated_ctx = updateContext(g, node, ctx);

    callback.enter_fn(node, updated_ctx);

    var i: u32 = 0;
    while (i < node.childCount()) : (i += 1) {
        const child = node.child(i) orelse continue;
        const child_kind = child.kind();

        if (depth < max_depth) {
            // Follow resolved call references when encountering a call expression
            // or a modifier invocation — both use site-based ref lookup.
            const is_followable = std.mem.eql(u8, child_kind, call_expression_type) or
                (modifier_invocation_type != null and std.mem.eql(u8, child_kind, modifier_invocation_type.?));

            if (is_followable) {
                const rid = graph.refId(updated_ctx.current_file, child.startByte());
                if (g.lookupRef(rid)) |ref| {
                    for (ref.targets.items) |target| {
                        if (visited.contains(target)) continue;
                        if (g.lookupNode(target)) |callee| {
                            if (callee.ast_node) |callee_ast| {
                                try visited.put(allocator, callee.id, {});
                                try call_stack.append(allocator, callee.id);

                                const deep_ctx = WalkContext{
                                    .current_file = if (callee.locator) |loc| loc.file else updated_ctx.current_file,
                                    .depth = depth + 1,
                                    .call_stack = call_stack.items,
                                    .current_node = callee.id,
                                };

                                try walkAstNodeDeep(g, callee_ast, deep_ctx, callback, max_depth, depth + 1, call_expression_type, modifier_invocation_type, visited, call_stack, allocator);

                                _ = call_stack.pop();
                            }
                        }
                    }
                }
            }
        }

        try walkAstNodeDeep(g, child, updated_ctx, callback, max_depth, depth, call_expression_type, modifier_invocation_type, visited, call_stack, allocator);
    }

    callback.exit_fn(node, updated_ctx);
}

// ── Context Tracking ──────────────────────────────────────────────────

/// If this AST node corresponds to a graph node (callable, container, modifier),
/// return a context with current_node updated. Otherwise return ctx unchanged.
fn updateContext(g: *const graph.SymbolGraph, node: ts.Node, ctx: WalkContext) WalkContext {
    const start_byte = node.startByte();
    var it = g.nodes.iterator();
    while (it.next()) |entry| {
        const gn = entry.value_ptr.*;
        switch (gn.kind) {
            .callable, .container, .modifier => {
                if (gn.ast_node) |gn_ast| {
                    if (gn_ast.startByte() == start_byte) {
                        return .{
                            .current_file = ctx.current_file,
                            .depth = ctx.depth,
                            .call_stack = ctx.call_stack,
                            .current_node = gn.id,
                        };
                    }
                }
            },
            else => {},
        }
    }
    return ctx;
}

// ── Tests ──────────────────────────────────────────────────────────────

const cfg = @import("languages/config.zig");

fn findNodeByKind(tree: *const ts.Tree, kind_name: []const u8) ?ts.Node {
    var cursor = tree.walk();
    defer cursor.destroy();
    var descend = true;
    while (true) {
        if (descend) {
            const node = cursor.node();
            if (std.mem.eql(u8, node.kind(), kind_name)) return node;
        }
        if (descend and cursor.gotoFirstChild()) continue;
        descend = true;
        if (cursor.gotoNextSibling()) continue;
        while (true) {
            if (!cursor.gotoParent()) return null;
            if (cursor.gotoNextSibling()) break;
        }
    }
}

test "walkScope walks full file AST including contract and function nodes" {
    const allocator = std.testing.allocator;

    const source = "contract Foo { function bar() public { uint x = 1; } }";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    // File node with AST root
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

    const S = struct {
        var enter_count: u32 = 0;
        var exit_count: u32 = 0;
        var finalize_called: bool = false;
        var saw_contract: bool = false;
        var saw_function: bool = false;

        fn enter(node: ts.Node, _: WalkContext) void {
            enter_count += 1;
            if (std.mem.eql(u8, node.kind(), "contract_declaration")) saw_contract = true;
            if (std.mem.eql(u8, node.kind(), "function_definition")) saw_function = true;
        }
        fn exit(_: ts.Node, _: WalkContext) void {
            exit_count += 1;
        }
        fn finalize() void {
            finalize_called = true;
        }
    };

    S.enter_count = 0;
    S.exit_count = 0;
    S.finalize_called = false;
    S.saw_contract = false;
    S.saw_function = false;

    walkScope(&g, .{
        .enter_fn = &S.enter,
        .exit_fn = &S.exit,
        .finalize_fn = &S.finalize,
    });

    try std.testing.expect(S.enter_count > 0);
    try std.testing.expectEqual(S.enter_count, S.exit_count);
    try std.testing.expect(S.finalize_called);
    try std.testing.expect(S.saw_contract);
    try std.testing.expect(S.saw_function);
}

test "walkScope skips nodes without ast_node" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    // File node without ast_node — should be skipped
    _ = try g.addNode(.{
        .id = graph.nodeId("test.sol", "test.sol", 1),
        .kind = .file,
        .language_kind = "source_file",
        .name = "test.sol",
        .qualified_name = "test.sol",
        .language = .solidity,
    });

    const S = struct {
        var enter_count: u32 = 0;
        fn enter(_: ts.Node, _: WalkContext) void {
            enter_count += 1;
        }
        fn exit(_: ts.Node, _: WalkContext) void {}
    };
    S.enter_count = 0;

    walkScope(&g, .{
        .enter_fn = &S.enter,
        .exit_fn = &S.exit,
    });

    try std.testing.expectEqual(@as(u32, 0), S.enter_count);
}

test "walkScope skips files outside scoped_files" {
    const allocator = std.testing.allocator;

    const source = "contract Foo { function bar() public {} }";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    // Scoped file with AST
    _ = try g.addNode(.{
        .id = graph.nodeId("scoped.sol", "scoped.sol", 1),
        .kind = .file,
        .language_kind = "source_file",
        .name = "scoped.sol",
        .qualified_name = "scoped.sol",
        .language = .solidity,
        .ast_node = tree.rootNode(),
        .locator = .{ .file = "scoped.sol", .start_byte = 0, .end_byte = @intCast(source.len), .line = 1, .column = 0 },
    });

    // Out-of-scope file with same AST (would be walked if not filtered)
    _ = try g.addNode(.{
        .id = graph.nodeId("dep.sol", "dep.sol", 1),
        .kind = .file,
        .language_kind = "source_file",
        .name = "dep.sol",
        .qualified_name = "dep.sol",
        .language = .solidity,
        .ast_node = tree.rootNode(),
        .locator = .{ .file = "dep.sol", .start_byte = 0, .end_byte = @intCast(source.len), .line = 1, .column = 0 },
    });

    // Set scope to only scoped.sol
    var scope: std.StringHashMapUnmanaged(void) = .empty;
    defer scope.deinit(allocator);
    try scope.put(allocator, "scoped.sol", {});
    g.scoped_files = &scope;

    const S = struct {
        var files_seen: [2]bool = .{ false, false };
        fn enter(_: ts.Node, ctx: WalkContext) void {
            if (std.mem.eql(u8, ctx.current_file, "scoped.sol")) files_seen[0] = true;
            if (std.mem.eql(u8, ctx.current_file, "dep.sol")) files_seen[1] = true;
        }
        fn exit(_: ts.Node, _: WalkContext) void {}
    };
    S.files_seen = .{ false, false };

    walkScope(&g, .{ .enter_fn = &S.enter, .exit_fn = &S.exit });

    try std.testing.expect(S.files_seen[0]); // scoped.sol walked
    try std.testing.expect(!S.files_seen[1]); // dep.sol skipped
}

test "walkScope walks all files when scoped_files is null" {
    const allocator = std.testing.allocator;

    const source = "contract Foo {}";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    _ = try g.addNode(.{
        .id = graph.nodeId("a.sol", "a.sol", 1),
        .kind = .file,
        .language_kind = "source_file",
        .name = "a.sol",
        .qualified_name = "a.sol",
        .language = .solidity,
        .ast_node = tree.rootNode(),
        .locator = .{ .file = "a.sol", .start_byte = 0, .end_byte = @intCast(source.len), .line = 1, .column = 0 },
    });
    _ = try g.addNode(.{
        .id = graph.nodeId("b.sol", "b.sol", 1),
        .kind = .file,
        .language_kind = "source_file",
        .name = "b.sol",
        .qualified_name = "b.sol",
        .language = .solidity,
        .ast_node = tree.rootNode(),
        .locator = .{ .file = "b.sol", .start_byte = 0, .end_byte = @intCast(source.len), .line = 1, .column = 0 },
    });

    // scoped_files is null (default) — both files should be walked
    const S = struct {
        var file_count: u32 = 0;
        fn enter(_: ts.Node, _: WalkContext) void {}
        fn exit(_: ts.Node, _: WalkContext) void {}
        fn finalize() void {
            file_count += 1;
        }
    };
    S.file_count = 0;

    // Count unique files via enter on source_file nodes
    const S2 = struct {
        var count: u32 = 0;
        fn enter(node: ts.Node, _: WalkContext) void {
            if (std.mem.eql(u8, node.kind(), "source_file")) count += 1;
        }
        fn exit(_: ts.Node, _: WalkContext) void {}
    };
    S2.count = 0;

    walkScope(&g, .{ .enter_fn = &S2.enter, .exit_fn = &S2.exit });

    try std.testing.expectEqual(@as(u32, 2), S2.count);
}
