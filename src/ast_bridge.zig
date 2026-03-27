const std = @import("std");
const ts = @import("tree-sitter");
const graph = @import("graph.zig");

// ── SPEC.md §7 — AST Handle Management ───────────────────────────────
//
// Lua can't hold Zig value types. The handle table maps integer indices
// to ts.Node values. Lua only ever sees the integer handle.
// The table is cleared between rule invocations to prevent unbounded growth.

pub const AstBridge = struct {
    handles: std.ArrayList(ts.Node),
    /// Source text keyed by file path — for node text extraction.
    sources: *const std.StringHashMapUnmanaged([]const u8),

    pub fn init(_: std.mem.Allocator, sources: *const std.StringHashMapUnmanaged([]const u8)) AstBridge {
        return .{
            .handles = .empty,
            .sources = sources,
        };
    }

    pub fn deinit(self: *AstBridge, allocator: std.mem.Allocator) void {
        self.handles.deinit(allocator);
    }

    /// Clear all handles. Called between rule invocations (§7).
    pub fn clear(self: *AstBridge, _: std.mem.Allocator) void {
        self.handles.shrinkRetainingCapacity(0);
    }

    /// Register a ts.Node and return its integer handle.
    pub fn pushNode(self: *AstBridge, node: ts.Node, allocator: std.mem.Allocator) !u32 {
        const idx: u32 = @intCast(self.handles.items.len);
        try self.handles.append(allocator, node);
        return idx;
    }

    /// Look up a ts.Node by handle.
    pub fn getNode(self: *const AstBridge, handle: u32) ?ts.Node {
        if (handle >= self.handles.items.len) return null;
        return self.handles.items[handle];
    }

    /// Get text for a node by slicing its file's source buffer.
    pub fn nodeText(self: *const AstBridge, node: ts.Node) ?[]const u8 {
        // We need to find the source for this node's file.
        // Since tree-sitter nodes reference their tree, and we stored sources
        // keyed by file path during pipeline, we iterate to find the matching source.
        // For now, use the node's byte range against any source that contains it.
        // TODO: track file→source mapping more efficiently via the graph locator
        var it = self.sources.iterator();
        while (it.next()) |entry| {
            const source = entry.value_ptr.*;
            const start = node.startByte();
            const end = node.endByte();
            if (end <= source.len) {
                return source[start..end];
            }
        }
        return null;
    }

    // ── SPEC.md §6.4 — ast.* API implementations ────────────────────

    /// ast.node(graph_node_id) -> handle
    pub fn nodeFromGraph(self: *AstBridge, g: *const graph.SymbolGraph, node_id: u64, allocator: std.mem.Allocator) !?u32 {
        const gn = g.lookupNode(node_id) orelse return null;
        const ast_node = gn.ast_node orelse return null;
        return try self.pushNode(ast_node, allocator);
    }

    /// ast.children(handle) -> []handle
    pub fn children(self: *AstBridge, handle: u32, allocator: std.mem.Allocator) ![]u32 {
        const node = self.getNode(handle) orelse return &.{};
        const count = node.childCount();
        var result: std.ArrayList(u32) = .empty;
        var i: u32 = 0;
        while (i < count) : (i += 1) {
            if (node.child(i)) |child| {
                const h = try self.pushNode(child, allocator);
                try result.append(allocator, h);
            }
        }
        return try result.toOwnedSlice(allocator);
    }

    /// ast.named_children(handle) -> []handle
    pub fn namedChildren(self: *AstBridge, handle: u32, allocator: std.mem.Allocator) ![]u32 {
        const node = self.getNode(handle) orelse return &.{};
        const count = node.namedChildCount();
        var result: std.ArrayList(u32) = .empty;
        var i: u32 = 0;
        while (i < count) : (i += 1) {
            if (node.namedChild(i)) |child| {
                const h = try self.pushNode(child, allocator);
                try result.append(allocator, h);
            }
        }
        return try result.toOwnedSlice(allocator);
    }

    /// ast.child(handle, index) -> ?handle
    pub fn childAt(self: *AstBridge, handle: u32, index: u32, allocator: std.mem.Allocator) !?u32 {
        const node = self.getNode(handle) orelse return null;
        const child = node.child(index) orelse return null;
        return try self.pushNode(child, allocator);
    }

    /// ast.child_by_field(handle, field_name) -> ?handle
    pub fn childByField(self: *AstBridge, handle: u32, field_name: []const u8, allocator: std.mem.Allocator) !?u32 {
        const node = self.getNode(handle) orelse return null;
        const child = node.childByFieldName(field_name) orelse return null;
        return try self.pushNode(child, allocator);
    }

    /// ast.parent(handle) -> ?handle
    pub fn parentOf(self: *AstBridge, handle: u32, allocator: std.mem.Allocator) !?u32 {
        const node = self.getNode(handle) orelse return null;
        const p = node.parent() orelse return null;
        return try self.pushNode(p, allocator);
    }

    /// ast.next_sibling(handle) -> ?handle
    pub fn nextSibling(self: *AstBridge, handle: u32, allocator: std.mem.Allocator) !?u32 {
        const node = self.getNode(handle) orelse return null;
        const sib = node.nextNamedSibling() orelse return null;
        return try self.pushNode(sib, allocator);
    }

    /// ast.prev_sibling(handle) -> ?handle
    pub fn prevSibling(self: *AstBridge, handle: u32, allocator: std.mem.Allocator) !?u32 {
        const node = self.getNode(handle) orelse return null;
        const sib = node.prevNamedSibling() orelse return null;
        return try self.pushNode(sib, allocator);
    }

    /// ast.type(handle) -> string
    pub fn nodeType(self: *const AstBridge, handle: u32) ?[]const u8 {
        const node = self.getNode(handle) orelse return null;
        return node.kind();
    }

    /// ast.text(handle) -> string
    pub fn textOf(self: *const AstBridge, handle: u32) ?[]const u8 {
        const node = self.getNode(handle) orelse return null;
        return self.nodeText(node);
    }

    /// ast.find(handle, type_name) -> []handle (recursive descendant search)
    pub fn findDescendants(self: *AstBridge, handle: u32, type_name: []const u8, allocator: std.mem.Allocator) ![]u32 {
        const node = self.getNode(handle) orelse return &.{};
        var result: std.ArrayList(u32) = .empty;
        try self.findDescendantsRecursive(node, type_name, &result, allocator);
        return try result.toOwnedSlice(allocator);
    }

    fn findDescendantsRecursive(self: *AstBridge, node: ts.Node, type_name: []const u8, result: *std.ArrayList(u32), allocator: std.mem.Allocator) !void {
        var i: u32 = 0;
        while (i < node.childCount()) : (i += 1) {
            if (node.child(i)) |child| {
                if (std.mem.eql(u8, child.kind(), type_name)) {
                    const h = try self.pushNode(child, allocator);
                    try result.append(allocator, h);
                }
                try self.findDescendantsRecursive(child, type_name, result, allocator);
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

    var sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    defer sources.deinit(allocator);
    try sources.put(allocator, "test.sol", source);

    var bridge = AstBridge.init(allocator, &sources);
    defer bridge.deinit(allocator);

    const root = tree.rootNode();
    const handle = try bridge.pushNode(root, allocator);
    const retrieved = bridge.getNode(handle);

    try std.testing.expect(retrieved != null);
    try std.testing.expectEqualStrings("source_file", retrieved.?.kind());
}

test "getNode returns null for invalid handle" {
    const allocator = std.testing.allocator;

    var sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    var bridge = AstBridge.init(allocator, &sources);
    defer bridge.deinit(allocator);

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

    var sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    var bridge = AstBridge.init(allocator, &sources);
    defer bridge.deinit(allocator);

    const handle = try bridge.pushNode(tree.rootNode(), allocator);
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

    var sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    var bridge = AstBridge.init(allocator, &sources);
    defer bridge.deinit(allocator);

    const root_handle = try bridge.pushNode(tree.rootNode(), allocator);
    const child_handles = try bridge.children(root_handle, allocator);
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

    var sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    var bridge = AstBridge.init(allocator, &sources);
    defer bridge.deinit(allocator);

    _ = try bridge.pushNode(tree.rootNode(), allocator);
    try std.testing.expectEqual(@as(usize, 1), bridge.handles.items.len);

    bridge.clear(allocator);
    try std.testing.expectEqual(@as(usize, 0), bridge.handles.items.len);
}

test "nodeText returns source text slice" {
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

    var bridge = AstBridge.init(allocator, &sources);
    defer bridge.deinit(allocator);

    const handle = try bridge.pushNode(tree.rootNode(), allocator);
    const text = bridge.textOf(handle);
    try std.testing.expect(text != null);
    try std.testing.expectEqualStrings(source, text.?);
}

test "startLine returns 1-indexed line number" {
    const allocator = std.testing.allocator;

    const source = "contract Foo {}";
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(cfg.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    var bridge = AstBridge.init(allocator, &sources);
    defer bridge.deinit(allocator);

    const handle = try bridge.pushNode(tree.rootNode(), allocator);
    try std.testing.expectEqual(@as(u32, 1), bridge.startLine(handle).?);
}
