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
    allocator: std.mem.Allocator,
) void {
    var it = g.nodes.iterator();
    while (it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (node.kind != .file) continue;
        const ast_root = node.ast_node orelse continue;
        const file = if (node.locator) |loc| loc.file else "";

        var visited: std.AutoHashMapUnmanaged(u64, void) = .empty;
        defer visited.deinit(allocator);

        var call_stack: std.ArrayList(u64) = .empty;
        defer call_stack.deinit(allocator);
        call_stack.append(allocator, node.id) catch continue;

        const ctx = WalkContext{
            .current_file = file,
            .depth = 0,
            .call_stack = call_stack.items,
            .current_node = node.id,
        };

        walkAstNodeDeep(g, ast_root, ctx, callback, max_depth, 0, call_expression_type, &visited, &call_stack, allocator);
    }

    if (callback.finalize_fn) |finalize| finalize();
}

/// Deep walk: full AST traversal with call-edge following.
fn walkAstNodeDeep(
    g: *const graph.SymbolGraph,
    node: ts.Node,
    ctx: WalkContext,
    callback: WalkCallback,
    max_depth: u32,
    depth: u32,
    call_expression_type: []const u8,
    visited: *std.AutoHashMapUnmanaged(u64, void),
    call_stack: *std.ArrayList(u64),
    allocator: std.mem.Allocator,
) void {
    const updated_ctx = updateContext(g, node, ctx);

    callback.enter_fn(node, updated_ctx);

    var i: u32 = 0;
    while (i < node.childCount()) : (i += 1) {
        const child = node.child(i) orelse continue;
        const child_kind = child.kind();

        // Follow resolved call edges when encountering a call expression
        if (depth < max_depth and std.mem.eql(u8, child_kind, call_expression_type)) {
            for (g.edges.items) |edge| {
                if (edge.from == updated_ctx.current_node and edge.kind == .calls) {
                    if (edge.from == edge.to) continue; // skip self-edges (external calls)
                    if (visited.contains(edge.to)) continue;
                    if (g.lookupNode(edge.to)) |callee| {
                        if (callee.ast_node) |callee_ast| {
                            visited.put(allocator, callee.id, {}) catch continue;
                            call_stack.append(allocator, callee.id) catch continue;

                            const deep_ctx = WalkContext{
                                .current_file = if (callee.locator) |loc| loc.file else updated_ctx.current_file,
                                .depth = depth + 1,
                                .call_stack = call_stack.items,
                                .current_node = callee.id,
                            };

                            walkAstNodeDeep(g, callee_ast, deep_ctx, callback, max_depth, depth + 1, call_expression_type, visited, call_stack, allocator);

                            _ = call_stack.pop();
                        }
                    }
                }
            }
        }

        walkAstNodeDeep(g, child, updated_ctx, callback, max_depth, depth, call_expression_type, visited, call_stack, allocator);
    }

    callback.exit_fn(node, updated_ctx);
}

// ── Context Tracking ──────────────────────────────────────────────────

/// If this AST node corresponds to a graph node (callable, container, modifier),
/// return a context with current_node updated. Otherwise return ctx unchanged.
fn updateContext(g: *const graph.SymbolGraph, node: ts.Node, ctx: WalkContext) WalkContext {
    const line = node.startPoint().row + 1;
    const start_byte = node.startByte();

    // Look for a graph node at this position
    var it = g.nodes.iterator();
    while (it.next()) |entry| {
        const gn = entry.value_ptr.*;
        switch (gn.kind) {
            .callable, .container, .modifier => {
                if (gn.ast_node) |gn_ast| {
                    if (gn_ast.startByte() == start_byte) {
                        _ = line;
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
