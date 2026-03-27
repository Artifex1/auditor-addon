const std = @import("std");
const ts = @import("tree-sitter");
const graph = @import("graph.zig");

// ── SPEC.md §5 — Walker ──────────────────────────────────────────────
//
// §5.1 Scope Walker: walks AST nodes within a single function body.
//       Does not follow call edges.
// §5.2 Deep Walker: follows calls edges across function boundaries.
//       Uses ast_node references directly.
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
    reset_fn: ?*const fn () void = null,
    finalize_fn: ?*const fn () void = null,
};

// ── §5.1 Scope Walker (Shallow) ──────────────────────────────────────

/// Walk all callable nodes in the graph, traversing each one's AST body
/// depth-first. Calls reset() before each callable, enter()/exit() for
/// each AST node, and finalize() after.
pub fn walkScope(
    g: *const graph.SymbolGraph,
    callback: WalkCallback,
) void {
    var it = g.nodes.iterator();
    while (it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (node.kind != .callable) continue;
        const ast_node = node.ast_node orelse continue;
        const file = if (node.locator) |loc| loc.file else "";

        // §5.1: reset before each function walk
        if (callback.reset_fn) |reset| reset();

        const ctx = WalkContext{
            .current_file = file,
            .depth = 0,
            .call_stack = &.{node.id},
            .current_node = node.id,
        };

        walkAstNode(ast_node, ctx, callback);

        // finalize after walk
        if (callback.finalize_fn) |finalize| finalize();
    }
}

/// Depth-first walk of a single AST node and its children.
fn walkAstNode(node: ts.Node, ctx: WalkContext, callback: WalkCallback) void {
    callback.enter_fn(node, ctx);

    var i: u32 = 0;
    while (i < node.childCount()) : (i += 1) {
        if (node.child(i)) |child| {
            walkAstNode(child, ctx, callback);
        }
    }

    callback.exit_fn(node, ctx);
}

// ── §5.2 Deep Walker ─────────────────────────────────────────────────

/// Walk all callable nodes, following calls edges across function
/// boundaries up to max_depth. Also follows has_modifier edges.
pub fn walkDeep(
    g: *const graph.SymbolGraph,
    callback: WalkCallback,
    max_depth: u32,
    allocator: std.mem.Allocator,
) void {
    var it = g.nodes.iterator();
    while (it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (node.kind != .callable) continue;
        const ast_node = node.ast_node orelse continue;
        const file = if (node.locator) |loc| loc.file else "";

        if (callback.reset_fn) |reset| reset();

        var call_stack: std.ArrayList(u64) = .empty;
        defer call_stack.deinit(allocator);
        call_stack.append(allocator, node.id) catch continue;

        var visited: std.AutoHashMapUnmanaged(u64, void) = .empty;
        defer visited.deinit(allocator);
        visited.put(allocator, node.id, {}) catch continue;

        // §5.2: walk modifier bodies first
        walkModifiers(g, node.id, callback, file, &call_stack, allocator);

        const ctx = WalkContext{
            .current_file = file,
            .depth = 0,
            .call_stack = call_stack.items,
            .current_node = node.id,
        };

        walkAstNodeDeep(g, ast_node, ctx, callback, max_depth, 0, &visited, &call_stack, allocator);

        if (callback.finalize_fn) |finalize| finalize();
    }
}

/// Walk modifier bodies before the function body (§5.2).
fn walkModifiers(
    g: *const graph.SymbolGraph,
    callable_id: u64,
    callback: WalkCallback,
    file: []const u8,
    call_stack: *std.ArrayList(u64),
    allocator: std.mem.Allocator,
) void {
    // Find has_modifier edges from this callable
    for (g.edges.items) |edge| {
        if (edge.from == callable_id and edge.kind == .has_modifier) {
            if (g.lookupNode(edge.to)) |mod_node| {
                if (mod_node.ast_node) |mod_ast| {
                    const ctx = WalkContext{
                        .current_file = file,
                        .depth = 0,
                        .call_stack = call_stack.items,
                        .current_node = mod_node.id,
                    };
                    walkAstNode(mod_ast, ctx, callback);
                }
            }
        }
    }
    _ = allocator;
}

/// Deep walk: follows call edges across functions.
fn walkAstNodeDeep(
    g: *const graph.SymbolGraph,
    node: ts.Node,
    ctx: WalkContext,
    callback: WalkCallback,
    max_depth: u32,
    depth: u32,
    visited: *std.AutoHashMapUnmanaged(u64, void),
    call_stack: *std.ArrayList(u64),
    allocator: std.mem.Allocator,
) void {
    callback.enter_fn(node, ctx);

    var i: u32 = 0;
    while (i < node.childCount()) : (i += 1) {
        const child = node.child(i) orelse continue;
        const child_kind = child.kind();

        // Check if this is a call expression — follow the call edge
        if (depth < max_depth and std.mem.eql(u8, child_kind, "call_expression")) {
            // Find outgoing calls edges from current callable
            for (g.edges.items) |edge| {
                if (edge.from == ctx.current_node and edge.kind == .calls) {
                    if (visited.contains(edge.to)) continue;
                    if (g.lookupNode(edge.to)) |callee| {
                        if (callee.ast_node) |callee_ast| {
                            visited.put(allocator, callee.id, {}) catch continue;
                            call_stack.append(allocator, callee.id) catch continue;

                            const deep_ctx = WalkContext{
                                .current_file = if (callee.locator) |loc| loc.file else ctx.current_file,
                                .depth = depth + 1,
                                .call_stack = call_stack.items,
                                .current_node = callee.id,
                            };

                            walkAstNodeDeep(g, callee_ast, deep_ctx, callback, max_depth, depth + 1, visited, call_stack, allocator);

                            _ = call_stack.pop();
                        }
                    }
                }
            }
        }

        walkAstNodeDeep(g, child, ctx, callback, max_depth, depth, visited, call_stack, allocator);
    }

    callback.exit_fn(node, ctx);
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

test "walkScope calls enter and exit for each AST node in callable body" {
    const allocator = std.testing.allocator;

    const source = "contract Foo { function bar() public { uint x = 1; } }";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    const fn_node = findNodeByKind(tree, "function_definition") orelse return error.NoFunction;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    const fn_id = graph.nodeId("bar", "test.sol", 1);
    _ = try g.addNode(.{
        .id = fn_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "bar",
        .qualified_name = "Foo.bar",
        .language = .solidity,
        .ast_node = fn_node,
        .locator = .{ .file = "test.sol", .start_byte = 0, .end_byte = @intCast(source.len), .line = 1, .column = 0 },
    });

    const S = struct {
        var enter_count: u32 = 0;
        var exit_count: u32 = 0;
        var reset_called: bool = false;

        fn enter(_: ts.Node, _: WalkContext) void {
            enter_count += 1;
        }
        fn exit(_: ts.Node, _: WalkContext) void {
            exit_count += 1;
        }
        fn reset() void {
            reset_called = true;
        }
    };

    S.enter_count = 0;
    S.exit_count = 0;
    S.reset_called = false;

    walkScope(&g, .{
        .enter_fn = &S.enter,
        .exit_fn = &S.exit,
        .reset_fn = &S.reset,
    });

    try std.testing.expect(S.enter_count > 0);
    try std.testing.expectEqual(S.enter_count, S.exit_count);
    try std.testing.expect(S.reset_called);
}

test "walkScope skips non-callable nodes" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();

    // Add a container node (no ast_node) — should be skipped
    _ = try g.addNode(.{
        .id = graph.nodeId("Foo", "test.sol", 1),
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Foo",
        .qualified_name = "Foo",
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
