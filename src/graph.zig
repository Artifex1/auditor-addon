const std = @import("std");
const ts = @import("tree-sitter");
const config = @import("languages/config.zig");

// ── §2.2 Node Taxonomy ────────────────────────────────────────────────

pub const NodeKind = enum {
    file,
    container,
    callable,
    variable,
    modifier,
    event,
};

// ── §2.3 Edge Types ───────────────────────────────────────────────────

pub const EdgeKind = enum {
    imports,
    contains,
    calls,
    reads,
    writes,
    has_modifier,
    inherits,
    emits,
};

pub const CallTargetKind = enum {
    internal,
    cross_module,
    external,
    interface_dispatch,
    unknown,
};

pub const EdgeAttrs = struct {
    call_site_byte: ?u32 = null,
    call_site_line: ?u32 = null,
    target_kind: ?CallTargetKind = null,
};

// ── §2.1 Graph Node ───────────────────────────────────────────────────

pub const SourceLocator = struct {
    file: []const u8,
    start_byte: u32,
    end_byte: u32,
    line: u32, // 1-indexed
    column: u32, // 0-indexed
};

pub const GraphNode = struct {
    id: u64,
    kind: NodeKind,
    language_kind: []const u8, // raw tree-sitter node type
    name: []const u8,
    qualified_name: []const u8,
    container: ?u64 = null,
    visibility: ?[]const u8 = null,
    language: config.Language,
    locator: ?SourceLocator = null,
    ast_node: ?ts.Node = null,
    properties: std.StringHashMapUnmanaged([]const u8) = .empty,
};

// ── §2.3 Graph Edge ───────────────────────────────────────────────────

pub const GraphEdge = struct {
    from: u64,
    to: u64,
    kind: EdgeKind,
    attrs: ?EdgeAttrs = null,
};

// ── §2.4 Edge Gaps ────────────────────────────────────────────────────

pub const Priority = enum {
    high,
    medium,
    low,
};

pub const EdgeGap = struct {
    id: u64,
    from: u64,
    expected_target: []const u8,
    edge_kind: EdgeKind,
    call_site: ?SourceLocator = null,
    priority: Priority,
};

// ── §4.1 Pending References ───────────────────────────────────────────

pub const RefKind = enum {
    import,
    call,
    inheritance,
    state_read,
    state_write,
    modifier_use,
    event_emit,
};

pub const PendingRef = struct {
    from: u64, // source node (callable or container)
    container: u64, // container context for scoped lookups
    target_name: []const u8,
    call_site: SourceLocator,
    kind: RefKind,
};

// ── §2.5 Content-Addressed IDs ────────────────────────────────────────

pub fn nodeId(name: []const u8, file: []const u8, line: u32) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(name);
    hasher.update(file);
    hasher.update(std.mem.asBytes(&line));
    return hasher.final();
}

pub fn gapId(from: u64, expected_target: []const u8, edge_kind: EdgeKind) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(std.mem.asBytes(&from));
    hasher.update(expected_target);
    hasher.update(std.mem.asBytes(&@intFromEnum(edge_kind)));
    return hasher.final();
}

// ── Symbol Graph ──────────────────────────────────────────────────────

pub const SymbolGraph = struct {
    allocator: std.mem.Allocator,
    arena: std.heap.ArenaAllocator,

    nodes: std.AutoHashMapUnmanaged(u64, *GraphNode),
    edges: std.ArrayListUnmanaged(GraphEdge),
    gaps: std.AutoHashMapUnmanaged(u64, *EdgeGap),
    pending_refs: std.ArrayListUnmanaged(PendingRef),

    // Reverse index: container_id → children node IDs
    children_index: std.AutoHashMapUnmanaged(u64, std.ArrayListUnmanaged(u64)),

    pub fn init(backing_allocator: std.mem.Allocator) SymbolGraph {
        return .{
            .allocator = backing_allocator,
            .arena = std.heap.ArenaAllocator.init(backing_allocator),
            .nodes = .empty,
            .edges = .empty,
            .gaps = .empty,
            .pending_refs = .empty,
            .children_index = .empty,
        };
    }

    pub fn deinit(self: *SymbolGraph) void {
        // Free inner ArrayListUnmanaged allocations in children_index
        var ci_it = self.children_index.iterator();
        while (ci_it.next()) |entry| {
            entry.value_ptr.deinit(self.allocator);
        }
        self.children_index.deinit(self.allocator);
        self.pending_refs.deinit(self.allocator);
        self.gaps.deinit(self.allocator);
        self.edges.deinit(self.allocator);
        self.nodes.deinit(self.allocator);
        self.arena.deinit();
    }

    /// Allocate a string that lives as long as the graph.
    pub fn dupeString(self: *SymbolGraph, s: []const u8) ![]const u8 {
        return self.arena.allocator().dupe(u8, s);
    }

    pub fn addNode(self: *SymbolGraph, node: GraphNode) !*GraphNode {
        const alloc = self.arena.allocator();
        const ptr = try alloc.create(GraphNode);
        ptr.* = node;
        try self.nodes.put(self.allocator, node.id, ptr);

        // Update children index for container relationship
        if (node.container) |container_id| {
            const gop = try self.children_index.getOrPut(self.allocator, container_id);
            if (!gop.found_existing) {
                gop.value_ptr.* = .empty;
            }
            try gop.value_ptr.append(self.allocator, node.id);
        }

        return ptr;
    }

    pub fn addEdge(self: *SymbolGraph, edge: GraphEdge) !void {
        try self.edges.append(self.allocator, edge);
    }

    pub fn addGap(self: *SymbolGraph, gap: EdgeGap) !*EdgeGap {
        const alloc = self.arena.allocator();
        const ptr = try alloc.create(EdgeGap);
        ptr.* = gap;
        try self.gaps.put(self.allocator, gap.id, ptr);
        return ptr;
    }

    pub fn addPendingRef(self: *SymbolGraph, ref: PendingRef) !void {
        try self.pending_refs.append(self.allocator, ref);
    }

    pub fn lookupNode(self: *const SymbolGraph, id: u64) ?*GraphNode {
        return self.nodes.get(id);
    }

    pub fn lookupGap(self: *const SymbolGraph, id: u64) ?*EdgeGap {
        return self.gaps.get(id);
    }

    /// Get all outgoing edges from a node, optionally filtered by kind.
    pub fn getOutgoingEdges(self: *const SymbolGraph, from_id: u64, kind_filter: ?EdgeKind, allocator: std.mem.Allocator) ![]const GraphEdge {
        var result: std.ArrayListUnmanaged(GraphEdge) = .empty;
        for (self.edges.items) |edge| {
            if (edge.from == from_id) {
                if (kind_filter) |k| {
                    if (edge.kind != k) continue;
                }
                try result.append(allocator, edge);
            }
        }
        return try result.toOwnedSlice(allocator);
    }

    /// Get all incoming edges to a node, optionally filtered by kind.
    pub fn getIncomingEdges(self: *const SymbolGraph, to_id: u64, kind_filter: ?EdgeKind, allocator: std.mem.Allocator) ![]const GraphEdge {
        var result: std.ArrayListUnmanaged(GraphEdge) = .empty;
        for (self.edges.items) |edge| {
            if (edge.to == to_id) {
                if (kind_filter) |k| {
                    if (edge.kind != k) continue;
                }
                try result.append(allocator, edge);
            }
        }
        return try result.toOwnedSlice(allocator);
    }

    /// Get children node IDs of a container.
    pub fn getChildren(self: *const SymbolGraph, container_id: u64) []const u64 {
        if (self.children_index.get(container_id)) |list| {
            return list.items;
        }
        return &.{};
    }

    /// Find a container node by name (for inheritance resolution).
    pub fn lookupContainerByName(self: *const SymbolGraph, name: []const u8) ?*GraphNode {
        var it = self.nodes.iterator();
        while (it.next()) |entry| {
            const node = entry.value_ptr.*;
            if (node.kind == .container and std.mem.eql(u8, node.name, name)) {
                return node;
            }
        }
        return null;
    }

    /// Find a child of a container by name and expected kind.
    pub fn lookupChildByName(self: *const SymbolGraph, container_id: u64, name: []const u8, expected_kind: NodeKind) ?*GraphNode {
        for (self.getChildren(container_id)) |child_id| {
            if (self.lookupNode(child_id)) |child| {
                if (child.kind == expected_kind and std.mem.eql(u8, child.name, name)) {
                    return child;
                }
            }
        }
        return null;
    }

    /// Remove a gap by ID (used when resolution promotes it to a concrete edge).
    pub fn removeGap(self: *SymbolGraph, id: u64) bool {
        return self.gaps.remove(id);
    }

    /// Get all nodes of a specific kind.
    pub fn getNodesByKind(self: *const SymbolGraph, kind: NodeKind, allocator: std.mem.Allocator) ![]const *GraphNode {
        var result: std.ArrayListUnmanaged(*GraphNode) = .empty;
        var it = self.nodes.iterator();
        while (it.next()) |entry| {
            if (entry.value_ptr.*.kind == kind) {
                try result.append(allocator, entry.value_ptr.*);
            }
        }
        return try result.toOwnedSlice(allocator);
    }

    /// Get total counts for summary output.
    pub fn nodeCount(self: *const SymbolGraph) u32 {
        return @intCast(self.nodes.count());
    }

    pub fn edgeCount(self: *const SymbolGraph) u32 {
        return @intCast(self.edges.items.len);
    }

    pub fn gapCount(self: *const SymbolGraph) u32 {
        return @intCast(self.gaps.count());
    }
};

// ── Tests ──────────────────────────────────────────────────────────────

test "nodeId is deterministic" {
    const id1 = nodeId("withdraw", "src/Vault.sol", 10);
    const id2 = nodeId("withdraw", "src/Vault.sol", 10);
    try std.testing.expectEqual(id1, id2);
}

test "nodeId differs for different inputs" {
    const id1 = nodeId("withdraw", "src/Vault.sol", 10);
    const id2 = nodeId("deposit", "src/Vault.sol", 10);
    const id3 = nodeId("withdraw", "src/Vault.sol", 11);
    try std.testing.expect(id1 != id2);
    try std.testing.expect(id1 != id3);
}

test "gapId is deterministic" {
    const id1 = gapId(123, "onlyOwner", .calls);
    const id2 = gapId(123, "onlyOwner", .calls);
    try std.testing.expectEqual(id1, id2);
}

test "gapId differs for different edge kinds" {
    const id1 = gapId(123, "Ownable", .calls);
    const id2 = gapId(123, "Ownable", .inherits);
    try std.testing.expect(id1 != id2);
}

test "SymbolGraph add and lookup node" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const id = nodeId("Vault", "src/Vault.sol", 4);
    _ = try g.addNode(.{
        .id = id,
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Vault",
        .qualified_name = "Vault",
        .language = .solidity,
    });

    const found = g.lookupNode(id);
    try std.testing.expect(found != null);
    try std.testing.expectEqualStrings("Vault", found.?.name);
}

test "SymbolGraph children index" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const container_id = nodeId("Vault", "src/Vault.sol", 4);
    _ = try g.addNode(.{
        .id = container_id,
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Vault",
        .qualified_name = "Vault",
        .language = .solidity,
    });

    const fn_id = nodeId("withdraw", "src/Vault.sol", 10);
    _ = try g.addNode(.{
        .id = fn_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "Vault.withdraw",
        .container = container_id,
        .language = .solidity,
    });

    const children = g.getChildren(container_id);
    try std.testing.expectEqual(@as(usize, 1), children.len);
    try std.testing.expectEqual(fn_id, children[0]);
}

test "SymbolGraph add and lookup gap" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const from = nodeId("withdraw", "src/Vault.sol", 10);
    const gap = gapId(from, "onlyOwner", .calls);
    _ = try g.addGap(.{
        .id = gap,
        .from = from,
        .expected_target = "onlyOwner",
        .edge_kind = .calls,
        .priority = .high,
    });

    try std.testing.expect(g.lookupGap(gap) != null);
    try std.testing.expect(g.removeGap(gap));
    try std.testing.expect(g.lookupGap(gap) == null);
}

test "SymbolGraph edges" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    try g.addEdge(.{ .from = 1, .to = 2, .kind = .calls });
    try g.addEdge(.{ .from = 1, .to = 3, .kind = .contains });
    try g.addEdge(.{ .from = 4, .to = 1, .kind = .calls });

    const outgoing = try g.getOutgoingEdges(1, null, std.testing.allocator);
    defer std.testing.allocator.free(outgoing);
    try std.testing.expectEqual(@as(usize, 2), outgoing.len);

    const calls_only = try g.getOutgoingEdges(1, .calls, std.testing.allocator);
    defer std.testing.allocator.free(calls_only);
    try std.testing.expectEqual(@as(usize, 1), calls_only.len);

    const incoming = try g.getIncomingEdges(1, .calls, std.testing.allocator);
    defer std.testing.allocator.free(incoming);
    try std.testing.expectEqual(@as(usize, 1), incoming.len);
}
