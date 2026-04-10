const std = @import("std");
const ts = @import("tree-sitter");
const graph = @import("graph.zig");

// ── SPEC.md §7 — AST Handle Management ───────────────────────────────
//
// Lua can't hold Zig value types. The handle table maps integer indices
// to ts.Node values. Lua only ever sees the integer handle.
// The table is cleared between rule invocations to prevent unbounded growth.

pub const AstBridge = struct {
    allocator: std.mem.Allocator,
    handles: std.ArrayList(ts.Node),
    /// Symbol graph — single source of truth for sources, trees, and node text.
    g: *const graph.SymbolGraph,

    pub fn init(allocator: std.mem.Allocator, g: *const graph.SymbolGraph) AstBridge {
        return .{
            .allocator = allocator,
            .handles = .empty,
            .g = g,
        };
    }

    pub fn deinit(self: *AstBridge) void {
        self.handles.deinit(self.allocator);
    }

    /// Clear all handles. Called between rule invocations (§7).
    pub fn clear(self: *AstBridge) void {
        self.handles.shrinkRetainingCapacity(0);
    }

    /// Register a ts.Node and return its integer handle.
    pub fn pushNode(self: *AstBridge, node: ts.Node) !u32 {
        const idx: u32 = @intCast(self.handles.items.len);
        try self.handles.append(self.allocator, node);
        return idx;
    }

    /// Look up a ts.Node by handle.
    pub fn getNode(self: *const AstBridge, handle: u32) ?ts.Node {
        if (handle >= self.handles.items.len) return null;
        return self.handles.items[handle];
    }

    // ── SPEC.md §6.4 — ast.* API implementations ────────────────────

    /// ast.node(graph_node_id) -> handle
    pub fn nodeFromGraph(self: *AstBridge, g: *const graph.SymbolGraph, node_id: u64) !?u32 {
        const gn = g.lookupNode(node_id) orelse return null;
        const ast_node = gn.ast_node orelse return null;
        return try self.pushNode(ast_node);
    }

    /// ast.children(handle) -> []handle
    pub fn children(self: *AstBridge, handle: u32) ![]u32 {
        const node = self.getNode(handle) orelse return &.{};
        const count = node.childCount();
        var result: std.ArrayList(u32) = .empty;
        var i: u32 = 0;
        while (i < count) : (i += 1) {
            if (node.child(i)) |child| {
                const h = try self.pushNode(child);
                try result.append(self.allocator, h);
            }
        }
        return try result.toOwnedSlice(self.allocator);
    }

    /// ast.named_children(handle) -> []handle
    pub fn namedChildren(self: *AstBridge, handle: u32) ![]u32 {
        const node = self.getNode(handle) orelse return &.{};
        const count = node.namedChildCount();
        var result: std.ArrayList(u32) = .empty;
        var i: u32 = 0;
        while (i < count) : (i += 1) {
            if (node.namedChild(i)) |child| {
                const h = try self.pushNode(child);
                try result.append(self.allocator, h);
            }
        }
        return try result.toOwnedSlice(self.allocator);
    }

    /// ast.child(handle, index) -> ?handle
    pub fn childAt(self: *AstBridge, handle: u32, index: u32) !?u32 {
        const node = self.getNode(handle) orelse return null;
        const child = node.child(index) orelse return null;
        return try self.pushNode(child);
    }

    /// ast.child_by_field(handle, field_name) -> ?handle
    pub fn childByField(self: *AstBridge, handle: u32, field_name: []const u8) !?u32 {
        const node = self.getNode(handle) orelse return null;
        const child = node.childByFieldName(field_name) orelse return null;
        return try self.pushNode(child);
    }

    /// ast.parent(handle) -> ?handle
    pub fn parentOf(self: *AstBridge, handle: u32) !?u32 {
        const node = self.getNode(handle) orelse return null;
        const p = node.parent() orelse return null;
        return try self.pushNode(p);
    }

    /// ast.next_sibling(handle) -> ?handle
    pub fn nextSibling(self: *AstBridge, handle: u32) !?u32 {
        const node = self.getNode(handle) orelse return null;
        const sib = node.nextNamedSibling() orelse return null;
        return try self.pushNode(sib);
    }

    /// ast.prev_sibling(handle) -> ?handle
    pub fn prevSibling(self: *AstBridge, handle: u32) !?u32 {
        const node = self.getNode(handle) orelse return null;
        const sib = node.prevNamedSibling() orelse return null;
        return try self.pushNode(sib);
    }

    /// ast.type(handle) -> string
    pub fn nodeType(self: *const AstBridge, handle: u32) ?[]const u8 {
        const node = self.getNode(handle) orelse return null;
        return node.kind();
    }

    /// ast.text(handle) -> string — delegates to SymbolGraph.nodeText()
    pub fn textOf(self: *const AstBridge, handle: u32) ?[]const u8 {
        const node = self.getNode(handle) orelse return null;
        return self.g.nodeText(node);
    }

    /// ast.find(handle, type_name) -> []handle (recursive descendant search)
    pub fn findDescendants(self: *AstBridge, handle: u32, type_name: []const u8) ![]u32 {
        const node = self.getNode(handle) orelse return &.{};
        var result: std.ArrayList(u32) = .empty;
        try self.findDescendantsRecursive(node, type_name, &result);
        return try result.toOwnedSlice(self.allocator);
    }

    fn findDescendantsRecursive(self: *AstBridge, node: ts.Node, type_name: []const u8, result: *std.ArrayList(u32)) !void {
        var i: u32 = 0;
        while (i < node.childCount()) : (i += 1) {
            if (node.child(i)) |child| {
                if (std.mem.eql(u8, child.kind(), type_name)) {
                    const h = try self.pushNode(child);
                    try result.append(self.allocator, h);
                }
                try self.findDescendantsRecursive(child, type_name, result);
            }
        }
    }

    /// ast.start_line(handle) -> u32 (1-indexed)
    pub fn startLine(self: *const AstBridge, handle: u32) ?u32 {
        const node = self.getNode(handle) orelse return null;
        return node.startPoint().row + 1;
    }

    /// ast.end_line(handle) -> u32 (1-indexed)
    pub fn endLine(self: *const AstBridge, handle: u32) ?u32 {
        const node = self.getNode(handle) orelse return null;
        return node.endPoint().row + 1;
    }

    /// ast.start_byte(handle) -> u32
    pub fn startByte(self: *const AstBridge, handle: u32) ?u32 {
        const node = self.getNode(handle) orelse return null;
        return node.startByte();
    }

    /// ast.end_byte(handle) -> u32
    pub fn endByte(self: *const AstBridge, handle: u32) ?u32 {
        const node = self.getNode(handle) orelse return null;
        return node.endByte();
    }

    /// ast.is_named(handle) -> bool
    pub fn isNamed(self: *const AstBridge, handle: u32) ?bool {
        const node = self.getNode(handle) orelse return null;
        return node.isNamed();
    }
};

// ── Tests ──────────────────────────────────────────────────────────────

const cfg = @import("languages/config.zig");

test "pushNode and getNode round-trip" {
    const allocator = std.testing.allocator;

    const source = "contract Foo {}";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();
    var bridge = AstBridge.init(allocator, &g);
    defer bridge.deinit();

    const root = tree.rootNode();
    const handle = try bridge.pushNode(root);
    const retrieved = bridge.getNode(handle);

    try std.testing.expect(retrieved != null);
    try std.testing.expectEqualStrings("source_file", retrieved.?.kind());
}

test "getNode returns null for invalid handle" {
    const allocator = std.testing.allocator;

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();
    var bridge = AstBridge.init(allocator, &g);
    defer bridge.deinit();

    try std.testing.expect(bridge.getNode(999) == null);
}

test "nodeType returns tree-sitter kind" {
    const allocator = std.testing.allocator;

    const source = "contract Foo {}";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();
    var bridge = AstBridge.init(allocator, &g);
    defer bridge.deinit();

    const handle = try bridge.pushNode(tree.rootNode());
    try std.testing.expectEqualStrings("source_file", bridge.nodeType(handle).?);
}

test "children returns child handles" {
    const allocator = std.testing.allocator;

    const source = "contract Foo { function bar() public {} }";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();
    var bridge = AstBridge.init(allocator, &g);
    defer bridge.deinit();

    const root_handle = try bridge.pushNode(tree.rootNode());
    const child_handles = try bridge.children(root_handle);
    defer allocator.free(child_handles);

    try std.testing.expect(child_handles.len > 0);
    // First named child should be contract_declaration
    for (child_handles) |ch| {
        const kind = bridge.nodeType(ch);
        if (kind != null and std.mem.eql(u8, kind.?, "contract_declaration")) {
            return; // found it
        }
    }
    return error.NoContractFound;
}

test "clear resets handle table" {
    const allocator = std.testing.allocator;

    const source = "contract Foo {}";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();
    var bridge = AstBridge.init(allocator, &g);
    defer bridge.deinit();

    _ = try bridge.pushNode(tree.rootNode());
    try std.testing.expectEqual(@as(usize, 1), bridge.handles.items.len);

    bridge.clear();
    try std.testing.expectEqual(@as(usize, 0), bridge.handles.items.len);
}

test "textOf returns source text slice via graph" {
    const allocator = std.testing.allocator;

    const source = "contract Foo {}";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    defer sources.deinit(allocator);
    try sources.put(allocator, "test.sol", source);

    var trees: std.StringHashMapUnmanaged(*ts.Tree) = .empty;
    defer trees.deinit(allocator);
    try trees.put(allocator, "test.sol", tree);

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();
    g.sources = &sources;
    g.trees = &trees;

    var bridge = AstBridge.init(allocator, &g);
    defer bridge.deinit();

    const handle = try bridge.pushNode(tree.rootNode());
    const text = bridge.textOf(handle);
    try std.testing.expect(text != null);
    try std.testing.expectEqualStrings(source, text.?);
}

test "textOf picks correct source with multiple files" {
    const allocator = std.testing.allocator;

    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());

    // File A: short source
    const source_a = "contract A {}";
    const tree_a = parser.parseString(source_a, null) orelse return error.ParseFailed;
    defer tree_a.destroy();

    // File B: longer source (would match A's byte range in the old buggy code)
    const source_b = "contract B { function foo() public {} }";
    const tree_b = parser.parseString(source_b, null) orelse return error.ParseFailed;
    defer tree_b.destroy();

    var sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    defer sources.deinit(allocator);
    try sources.put(allocator, "a.sol", source_a);
    try sources.put(allocator, "b.sol", source_b);

    var trees: std.StringHashMapUnmanaged(*ts.Tree) = .empty;
    defer trees.deinit(allocator);
    try trees.put(allocator, "a.sol", tree_a);
    try trees.put(allocator, "b.sol", tree_b);

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();
    g.sources = &sources;
    g.trees = &trees;

    var bridge = AstBridge.init(allocator, &g);
    defer bridge.deinit();

    // Node from tree A must return text from source A
    const handle_a = try bridge.pushNode(tree_a.rootNode());
    try std.testing.expectEqualStrings(source_a, bridge.textOf(handle_a).?);

    // Node from tree B must return text from source B
    const handle_b = try bridge.pushNode(tree_b.rootNode());
    try std.testing.expectEqualStrings(source_b, bridge.textOf(handle_b).?);
}

test "startLine returns 1-indexed line number" {
    const allocator = std.testing.allocator;

    const source = "contract Foo {}";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var g = graph.SymbolGraph.init(allocator);
    defer g.deinit();
    var bridge = AstBridge.init(allocator, &g);
    defer bridge.deinit();

    const handle = try bridge.pushNode(tree.rootNode());
    try std.testing.expectEqual(@as(u32, 1), bridge.startLine(handle).?);
}
