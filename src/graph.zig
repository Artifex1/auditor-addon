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

// ── §2.4 Reference Types ─────────────────────────────────────────────

pub const RefKind = enum {
    import,
    call,
    inheritance,
    state_read,
    state_write,
    modifier_use,
    event_emit,
};

pub const CallTargetKind = enum {
    internal,
    cross_module,
    external,
    interface_dispatch,
    unknown,
};

pub const Priority = enum {
    high,
    medium,
    low,
};

pub const Reference = struct {
    id: u64, // hash(file, start_byte)
    from: u64, // enclosing scope node (callable or container)
    kind: RefKind,
    target_name: []const u8,
    site: SourceLocator,

    // Resolution: 0..N target node IDs
    targets: std.ArrayListUnmanaged(u64),
    target_kind: ?CallTargetKind = null,

    // Gap signal (orthogonal to targets)
    gap: ?Priority = null,
    resolved: bool = false,

    pub fn hasTargets(self: *const Reference) bool {
        return self.targets.items.len > 0;
    }

    pub fn firstTarget(self: *const Reference) ?u64 {
        if (self.targets.items.len > 0) return self.targets.items[0];
        return null;
    }

    pub fn addTarget(self: *Reference, allocator: std.mem.Allocator, target_id: u64) !void {
        try self.targets.append(allocator, target_id);
    }
};

// ── §2.3 Contains Edge (Structural) ──────────────────────────────────

pub const ContainsEdge = struct {
    from: u64,
    to: u64,
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

// ── §2.5 Content-Addressed IDs ────────────────────────────────────────

pub fn nodeId(name: []const u8, file: []const u8, line: u32) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(name);
    hasher.update(file);
    hasher.update(std.mem.asBytes(&line));
    return hasher.final();
}

pub fn refId(file: []const u8, start_byte: u32) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(file);
    hasher.update(std.mem.asBytes(&start_byte));
    return hasher.final();
}

pub fn refIdWithKind(file: []const u8, start_byte: u32, kind: RefKind) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(file);
    hasher.update(std.mem.asBytes(&start_byte));
    hasher.update(std.mem.asBytes(&kind));
    return hasher.final();
}

// ── §2.6 Symbol Graph ────────────────────────────────────────────────

pub const SymbolGraph = struct {
    allocator: std.mem.Allocator,
    arena: std.heap.ArenaAllocator,

    nodes: std.AutoHashMapUnmanaged(u64, *GraphNode),
    contains: std.ArrayListUnmanaged(ContainsEdge),
    refs: std.ArrayListUnmanaged(Reference),

    // Indices
    children_index: std.AutoHashMapUnmanaged(u64, std.ArrayListUnmanaged(u64)),
    site_index: std.AutoHashMapUnmanaged(u64, u32), // ref.id → index in refs

    // Scope filter: when set, getNodesByKind/gapCount/walker only see scoped files.
    // Non-owning pointer — set by the command after pipeline.run().
    scoped_files: ?*const std.StringHashMapUnmanaged(void) = null,

    pub fn init(backing_allocator: std.mem.Allocator) SymbolGraph {
        return .{
            .allocator = backing_allocator,
            .arena = std.heap.ArenaAllocator.init(backing_allocator),
            .nodes = .empty,
            .contains = .empty,
            .refs = .empty,
            .children_index = .empty,
            .site_index = .empty,
        };
    }

    pub fn deinit(self: *SymbolGraph) void {
        // Free inner ArrayListUnmanaged allocations in children_index
        var ci_it = self.children_index.iterator();
        while (ci_it.next()) |entry| {
            entry.value_ptr.deinit(self.allocator);
        }
        self.children_index.deinit(self.allocator);

        // Free target lists inside references
        for (self.refs.items) |*r| {
            r.targets.deinit(self.allocator);
        }
        self.refs.deinit(self.allocator);

        self.site_index.deinit(self.allocator);
        self.contains.deinit(self.allocator);
        self.nodes.deinit(self.allocator);
        self.arena.deinit();
    }

    /// Allocate a string that lives as long as the graph.
    pub fn dupeString(self: *SymbolGraph, s: []const u8) ![]const u8 {
        return self.arena.allocator().dupe(u8, s);
    }

    // ── Node operations ──────────────────────────────────────────────

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

    pub fn lookupNode(self: *const SymbolGraph, id: u64) ?*GraphNode {
        return self.nodes.get(id);
    }

    /// Derive the enclosing container for a scope node.
    /// If the node is itself a container, returns its own ID.
    /// Otherwise returns node.container (the parent container).
    pub fn containerOf(self: *const SymbolGraph, scope_id: u64) ?u64 {
        const node = self.nodes.get(scope_id) orelse return null;
        if (node.kind == .container or node.kind == .file) return scope_id;
        return node.container orelse scope_id;
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

    pub fn lookupChildrenByName(self: *const SymbolGraph, container_id: u64, name: []const u8, expected_kind: NodeKind, allocator: std.mem.Allocator) ![]const *GraphNode {
        var result: std.ArrayListUnmanaged(*GraphNode) = .empty;
        errdefer result.deinit(allocator);
        for (self.getChildren(container_id)) |child_id| {
            if (self.lookupNode(child_id)) |child| {
                if (child.kind == expected_kind and std.mem.eql(u8, child.name, name)) {
                    try result.append(allocator, child);
                }
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

    /// Get all nodes of a specific kind.
    pub fn getNodesByKind(self: *const SymbolGraph, kind: NodeKind, allocator: std.mem.Allocator) ![]const *GraphNode {
        var result: std.ArrayListUnmanaged(*GraphNode) = .empty;
        errdefer result.deinit(allocator);
        var it = self.nodes.iterator();
        while (it.next()) |entry| {
            const node = entry.value_ptr.*;
            if (node.kind != kind) continue;
            if (self.scoped_files) |scope| {
                const file = if (node.locator) |loc| loc.file else "";
                if (file.len > 0 and !scope.contains(file)) continue;
            }
            try result.append(allocator, node);
        }
        return try result.toOwnedSlice(allocator);
    }

    // ── Contains edge operations ─────────────────────────────────────

    pub fn addContains(self: *SymbolGraph, from: u64, to: u64) !void {
        try self.contains.append(self.allocator, .{ .from = from, .to = to });
    }

    // ── Reference operations ─────────────────────────────────────────

    pub fn addRef(self: *SymbolGraph, ref: Reference) !void {
        try self.refs.append(self.allocator, ref);
    }

    /// Build site_index after resolution. Maps each ref.id → index in refs.
    pub fn buildSiteIndex(self: *SymbolGraph) !void {
        self.site_index.clearRetainingCapacity();
        for (self.refs.items, 0..) |ref, idx| {
            try self.site_index.put(self.allocator, ref.id, @intCast(idx));
        }
    }

    /// O(1) lookup of reference by ref_id (requires buildSiteIndex).
    pub fn lookupRef(self: *const SymbolGraph, rid: u64) ?*const Reference {
        if (self.site_index.get(rid)) |idx| {
            return &self.refs.items[idx];
        }
        return null;
    }

    /// Mutable O(1) lookup of reference by ref_id.
    pub fn lookupRefMut(self: *SymbolGraph, rid: u64) ?*Reference {
        if (self.site_index.get(rid)) |idx| {
            return &self.refs.items[idx];
        }
        return null;
    }

    /// Get all outgoing references from a node, optionally filtered by kind.
    /// Returns a slice allocated with the provided allocator.
    pub fn getOutgoingRefs(self: *const SymbolGraph, from_id: u64, kind_filter: ?RefKind, allocator: std.mem.Allocator) ![]const Reference {
        var result: std.ArrayListUnmanaged(Reference) = .empty;
        errdefer result.deinit(allocator);
        for (self.refs.items) |ref| {
            if (ref.from == from_id and ref.resolved and ref.hasTargets()) {
                if (kind_filter) |k| {
                    if (ref.kind != k) continue;
                }
                try result.append(allocator, ref);
            }
        }
        return try result.toOwnedSlice(allocator);
    }

    /// Get all references from a node (resolved or not), optionally filtered by kind.
    /// Unlike getOutgoingRefs, does not require ref.resolved — use for import dedup etc.
    pub fn getAllRefsFrom(self: *const SymbolGraph, from_id: u64, kind_filter: ?RefKind, allocator: std.mem.Allocator) ![]const Reference {
        var result: std.ArrayListUnmanaged(Reference) = .empty;
        errdefer result.deinit(allocator);
        for (self.refs.items) |ref| {
            if (ref.from != from_id) continue;
            if (kind_filter) |k| {
                if (ref.kind != k) continue;
            }
            try result.append(allocator, ref);
        }
        return try result.toOwnedSlice(allocator);
    }

    /// Get all incoming references to a node, optionally filtered by kind.
    pub fn getIncomingRefs(self: *const SymbolGraph, target_id: u64, kind_filter: ?RefKind, allocator: std.mem.Allocator) ![]const Reference {
        var result: std.ArrayListUnmanaged(Reference) = .empty;
        errdefer result.deinit(allocator);
        for (self.refs.items) |ref| {
            if (!ref.resolved or !ref.hasTargets()) continue;
            if (kind_filter) |k| {
                if (ref.kind != k) continue;
            }
            for (ref.targets.items) |target| {
                if (target == target_id) {
                    try result.append(allocator, ref);
                    break;
                }
            }
        }
        return try result.toOwnedSlice(allocator);
    }

    /// Check if a node has any incoming references of a given kind.
    pub fn hasIncomingRefs(self: *const SymbolGraph, target_id: u64, kind_filter: RefKind) bool {
        for (self.refs.items) |ref| {
            if (!ref.resolved or !ref.hasTargets()) continue;
            if (ref.kind != kind_filter) continue;
            for (ref.targets.items) |target| {
                if (target == target_id) return true;
            }
        }
        return false;
    }

    /// Get resolved inheritance targets for a container (for resolveInScope).
    /// Returns target node IDs in insertion order (preserves declaration order).
    pub fn getResolvedInheritanceTargets(self: *const SymbolGraph, container_id: u64, allocator: std.mem.Allocator) ![]const u64 {
        var result: std.ArrayListUnmanaged(u64) = .empty;
        errdefer result.deinit(allocator);
        for (self.refs.items) |ref| {
            if (ref.from == container_id and ref.kind == .inheritance and ref.resolved and ref.hasTargets()) {
                for (ref.targets.items) |target| {
                    try result.append(allocator, target);
                }
            }
        }
        return try result.toOwnedSlice(allocator);
    }

    // ── Counts ───────────────────────────────────────────────────────

    pub fn nodeCount(self: *const SymbolGraph) u32 {
        return @intCast(self.nodes.count());
    }

    pub fn containsCount(self: *const SymbolGraph) u32 {
        return @intCast(self.contains.items.len);
    }

    pub fn refCount(self: *const SymbolGraph) u32 {
        return @intCast(self.refs.items.len);
    }

    pub fn gapCount(self: *const SymbolGraph) u32 {
        var count: u32 = 0;
        for (self.refs.items) |ref| {
            if (ref.gap == null) continue;
            if (self.scoped_files) |scope| {
                if (!scope.contains(ref.site.file)) continue;
            }
            count += 1;
        }
        return count;
    }

    /// Check whether a ref's site file is within scope (or scope is unset).
    pub fn isRefInScope(self: *const SymbolGraph, ref: Reference) bool {
        const scope = self.scoped_files orelse return true;
        return scope.contains(ref.site.file);
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

test "refId is deterministic" {
    const id1 = refId("src/Vault.sol", 100);
    const id2 = refId("src/Vault.sol", 100);
    try std.testing.expectEqual(id1, id2);
}

test "refId differs for different byte offsets" {
    const id1 = refId("src/Vault.sol", 100);
    const id2 = refId("src/Vault.sol", 200);
    try std.testing.expect(id1 != id2);
}

test "refId differs for different files" {
    const id1 = refId("src/Vault.sol", 100);
    const id2 = refId("src/Ownable.sol", 100);
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

test "SymbolGraph children index via addNode" {
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

test "SymbolGraph contains edges" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    try g.addContains(1, 2);
    try g.addContains(1, 3);

    try std.testing.expectEqual(@as(u32, 2), g.containsCount());
    try std.testing.expectEqual(@as(u64, 2), g.contains.items[0].to);
    try std.testing.expectEqual(@as(u64, 3), g.contains.items[1].to);
}

test "Reference lifecycle: pending → resolved with target" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    var ref = Reference{
        .id = refId("test.sol", 50),
        .from = 1,
        .kind = .call,
        .target_name = "withdraw",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 70, .line = 5, .column = 4 },
        .targets = .empty,
    };

    // Starts pending
    try std.testing.expect(!ref.resolved);
    try std.testing.expect(!ref.hasTargets());

    // Resolve with target
    try ref.addTarget(std.testing.allocator, 42);
    ref.resolved = true;
    defer ref.targets.deinit(std.testing.allocator);

    try std.testing.expect(ref.resolved);
    try std.testing.expect(ref.hasTargets());
    try std.testing.expectEqual(@as(u64, 42), ref.firstTarget().?);
}

test "Reference lifecycle: pending → gap" {
    const ref = Reference{
        .id = refId("test.sol", 50),
        .from = 1,
        .kind = .call,
        .target_name = "onlyOwner",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 70, .line = 5, .column = 4 },
        .targets = .empty,
        .gap = .high,
        .resolved = true,
    };

    try std.testing.expect(ref.resolved);
    try std.testing.expect(!ref.hasTargets());
    try std.testing.expectEqual(Priority.high, ref.gap.?);
}

test "Reference lifecycle: provisional (target + gap)" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    var ref = Reference{
        .id = refId("test.sol", 50),
        .from = 1,
        .kind = .call,
        .target_name = "call",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 70, .line = 5, .column = 4 },
        .targets = .empty,
        .target_kind = .external,
        .gap = .low,
        .resolved = true,
    };
    defer ref.targets.deinit(std.testing.allocator);

    // Has gap AND could have a target
    try std.testing.expect(ref.resolved);
    try std.testing.expect(ref.gap != null);
    try std.testing.expectEqual(CallTargetKind.external, ref.target_kind.?);
}

test "Reference multi-target (dynamic dispatch)" {
    var ref = Reference{
        .id = refId("test.sol", 50),
        .from = 1,
        .kind = .call,
        .target_name = "withdraw",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 70, .line = 5, .column = 4 },
        .targets = .empty,
        .gap = .low,
        .resolved = true,
    };
    defer ref.targets.deinit(std.testing.allocator);

    try ref.addTarget(std.testing.allocator, 100);
    try ref.addTarget(std.testing.allocator, 200);

    try std.testing.expectEqual(@as(usize, 2), ref.targets.items.len);
    try std.testing.expectEqual(@as(u64, 100), ref.targets.items[0]);
    try std.testing.expectEqual(@as(u64, 200), ref.targets.items[1]);
}

test "SymbolGraph addRef and site_index lookup" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const rid = refId("test.sol", 50);
    try g.addRef(.{
        .id = rid,
        .from = 1,
        .kind = .call,
        .target_name = "withdraw",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 70, .line = 5, .column = 4 },
        .targets = .empty,
        .resolved = true,
    });

    try g.buildSiteIndex();

    const found = g.lookupRef(rid);
    try std.testing.expect(found != null);
    try std.testing.expectEqualStrings("withdraw", found.?.target_name);

    // Not found
    const missing = g.lookupRef(refId("other.sol", 50));
    try std.testing.expect(missing == null);
}

test "SymbolGraph getOutgoingRefs filters by kind and resolved" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // Resolved call ref with target
    var ref1_targets: std.ArrayListUnmanaged(u64) = .empty;
    try ref1_targets.append(std.testing.allocator, 10);
    try g.addRef(.{
        .id = refId("test.sol", 50),
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .targets = ref1_targets,
        .resolved = true,
    });

    // Resolved write ref with target
    var ref2_targets: std.ArrayListUnmanaged(u64) = .empty;
    try ref2_targets.append(std.testing.allocator, 20);
    try g.addRef(.{
        .id = refId("test.sol", 70),
        .from = 1,
        .kind = .state_write,
        .target_name = "balance",
        .site = .{ .file = "test.sol", .start_byte = 70, .end_byte = 80, .line = 7, .column = 0 },
        .targets = ref2_targets,
        .resolved = true,
    });

    // Unresolved gap (no targets)
    try g.addRef(.{
        .id = refId("test.sol", 90),
        .from = 1,
        .kind = .call,
        .target_name = "bar",
        .site = .{ .file = "test.sol", .start_byte = 90, .end_byte = 100, .line = 9, .column = 0 },
        .targets = .empty,
        .gap = .medium,
        .resolved = true,
    });

    // All outgoing from node 1
    const all = try g.getOutgoingRefs(1, null, std.testing.allocator);
    defer std.testing.allocator.free(all);
    try std.testing.expectEqual(@as(usize, 2), all.len); // only resolved with targets

    // Only calls
    const calls = try g.getOutgoingRefs(1, .call, std.testing.allocator);
    defer std.testing.allocator.free(calls);
    try std.testing.expectEqual(@as(usize, 1), calls.len);
    try std.testing.expectEqualStrings("foo", calls[0].target_name);
}

test "SymbolGraph getIncomingRefs" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    var targets: std.ArrayListUnmanaged(u64) = .empty;
    try targets.append(std.testing.allocator, 10);

    try g.addRef(.{
        .id = refId("test.sol", 50),
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .targets = targets,
        .resolved = true,
    });

    const incoming = try g.getIncomingRefs(10, .call, std.testing.allocator);
    defer std.testing.allocator.free(incoming);
    try std.testing.expectEqual(@as(usize, 1), incoming.len);
    try std.testing.expectEqual(@as(u64, 1), incoming[0].from);

    // No incoming to nonexistent target
    const none = try g.getIncomingRefs(999, .call, std.testing.allocator);
    defer std.testing.allocator.free(none);
    try std.testing.expectEqual(@as(usize, 0), none.len);
}

test "SymbolGraph hasIncomingRefs" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    var targets: std.ArrayListUnmanaged(u64) = .empty;
    try targets.append(std.testing.allocator, 10);

    try g.addRef(.{
        .id = refId("test.sol", 50),
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .targets = targets,
        .resolved = true,
    });

    try std.testing.expect(g.hasIncomingRefs(10, .call));
    try std.testing.expect(!g.hasIncomingRefs(10, .state_write));
    try std.testing.expect(!g.hasIncomingRefs(999, .call));
}

test "SymbolGraph getResolvedInheritanceTargets preserves order" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // contract C is A, B → inheritance refs added in order A, B
    var t1: std.ArrayListUnmanaged(u64) = .empty;
    try t1.append(std.testing.allocator, 100);
    try g.addRef(.{
        .id = refId("test.sol", 10),
        .from = 1,
        .kind = .inheritance,
        .target_name = "A",
        .site = .{ .file = "test.sol", .start_byte = 10, .end_byte = 20, .line = 1, .column = 0 },
        .targets = t1,
        .resolved = true,
    });

    var t2: std.ArrayListUnmanaged(u64) = .empty;
    try t2.append(std.testing.allocator, 200);
    try g.addRef(.{
        .id = refId("test.sol", 30),
        .from = 1,
        .kind = .inheritance,
        .target_name = "B",
        .site = .{ .file = "test.sol", .start_byte = 30, .end_byte = 40, .line = 1, .column = 20 },
        .targets = t2,
        .resolved = true,
    });

    const parents = try g.getResolvedInheritanceTargets(1, std.testing.allocator);
    defer std.testing.allocator.free(parents);
    try std.testing.expectEqual(@as(usize, 2), parents.len);
    try std.testing.expectEqual(@as(u64, 100), parents[0]); // A first
    try std.testing.expectEqual(@as(u64, 200), parents[1]); // B second
}

test "SymbolGraph gapCount counts refs with gap annotation" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // Gap ref
    try g.addRef(.{
        .id = refId("test.sol", 50),
        .from = 1,
        .kind = .call,
        .target_name = "missing",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .targets = .empty,
        .gap = .high,
        .resolved = true,
    });

    // Resolved (no gap)
    try g.addRef(.{
        .id = refId("test.sol", 70),
        .from = 1,
        .kind = .call,
        .target_name = "found",
        .site = .{ .file = "test.sol", .start_byte = 70, .end_byte = 80, .line = 7, .column = 0 },
        .targets = .empty,
        .resolved = true,
    });

    // Provisional (target + gap)
    try g.addRef(.{
        .id = refId("test.sol", 90),
        .from = 1,
        .kind = .call,
        .target_name = "external",
        .site = .{ .file = "test.sol", .start_byte = 90, .end_byte = 100, .line = 9, .column = 0 },
        .targets = .empty,
        .gap = .low,
        .resolved = true,
    });

    try std.testing.expectEqual(@as(u32, 2), g.gapCount()); // gap + provisional
    try std.testing.expectEqual(@as(u32, 3), g.refCount());
}

test "SymbolGraph lookupRefMut allows mutation" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const rid = refId("test.sol", 50);
    try g.addRef(.{
        .id = rid,
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .targets = .empty,
        .gap = .medium,
    });

    try g.buildSiteIndex();

    // Mutate: add target and clear gap (simulating resolution)
    if (g.lookupRefMut(rid)) |ref| {
        try ref.addTarget(g.allocator, 42);
        ref.gap = null;
        ref.resolved = true;
    }

    const ref = g.lookupRef(rid).?;
    try std.testing.expect(ref.resolved);
    try std.testing.expect(ref.gap == null);
    try std.testing.expectEqual(@as(u64, 42), ref.firstTarget().?);
}

test "lookupContainerByName" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    _ = try g.addNode(.{
        .id = nodeId("Vault", "test.sol", 1),
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Vault",
        .qualified_name = "Vault",
        .language = .solidity,
    });

    _ = try g.addNode(.{
        .id = nodeId("withdraw", "test.sol", 5),
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "Vault.withdraw",
        .language = .solidity,
    });

    try std.testing.expect(g.lookupContainerByName("Vault") != null);
    try std.testing.expect(g.lookupContainerByName("Missing") == null);
    // callable is not a container
    try std.testing.expect(g.lookupContainerByName("withdraw") == null);
}

test "lookupChildByName" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const cid = nodeId("Vault", "test.sol", 1);
    _ = try g.addNode(.{
        .id = cid,
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Vault",
        .qualified_name = "Vault",
        .language = .solidity,
    });

    _ = try g.addNode(.{
        .id = nodeId("withdraw", "test.sol", 5),
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "Vault.withdraw",
        .container = cid,
        .language = .solidity,
    });

    _ = try g.addNode(.{
        .id = nodeId("balance", "test.sol", 3),
        .kind = .variable,
        .language_kind = "state_variable_declaration",
        .name = "balance",
        .qualified_name = "Vault.balance",
        .container = cid,
        .language = .solidity,
    });

    // Find callable by name
    try std.testing.expect(g.lookupChildByName(cid, "withdraw", .callable) != null);
    // Wrong kind
    try std.testing.expect(g.lookupChildByName(cid, "withdraw", .variable) == null);
    // Find variable by name
    try std.testing.expect(g.lookupChildByName(cid, "balance", .variable) != null);
    // Not found
    try std.testing.expect(g.lookupChildByName(cid, "missing", .callable) == null);
}

test "two calls to same target produce different refIds" {
    // This is the key bug the old model had — gapId(from, "transfer", .calls) would collide
    const id1 = refId("src/Vault.sol", 100); // first call to transfer()
    const id2 = refId("src/Vault.sol", 200); // second call to transfer()
    try std.testing.expect(id1 != id2);
}

test "SymbolGraph deinit cleans up all allocations" {
    // This test verifies no leaks by running under the testing allocator
    var g = SymbolGraph.init(std.testing.allocator);

    _ = try g.addNode(.{
        .id = nodeId("Vault", "test.sol", 1),
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Vault",
        .qualified_name = "Vault",
        .language = .solidity,
    });

    const fn_id = nodeId("withdraw", "test.sol", 5);
    _ = try g.addNode(.{
        .id = fn_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "Vault.withdraw",
        .container = nodeId("Vault", "test.sol", 1),
        .language = .solidity,
    });

    try g.addContains(nodeId("Vault", "test.sol", 1), fn_id);

    var targets: std.ArrayListUnmanaged(u64) = .empty;
    try targets.append(std.testing.allocator, fn_id);

    try g.addRef(.{
        .id = refId("test.sol", 50),
        .from = fn_id,
        .kind = .call,
        .target_name = "withdraw",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .targets = targets,
        .resolved = true,
    });

    try g.buildSiteIndex();

    g.deinit(); // testing allocator will catch leaks
}

test "getNodesByKind respects scoped_files" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // Two callables in different files
    _ = try g.addNode(.{
        .id = nodeId("foo", "src/Scoped.sol", 5),
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "foo",
        .qualified_name = "Scoped.foo",
        .language = .solidity,
        .locator = .{ .file = "src/Scoped.sol", .start_byte = 0, .end_byte = 50, .line = 5, .column = 0 },
    });
    _ = try g.addNode(.{
        .id = nodeId("bar", "deps/Dep.sol", 10),
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "bar",
        .qualified_name = "Dep.bar",
        .language = .solidity,
        .locator = .{ .file = "deps/Dep.sol", .start_byte = 0, .end_byte = 50, .line = 10, .column = 0 },
    });

    // Without scope: both returned
    const all = try g.getNodesByKind(.callable, std.testing.allocator);
    defer std.testing.allocator.free(all);
    try std.testing.expectEqual(@as(usize, 2), all.len);

    // With scope: only scoped file returned
    var scope: std.StringHashMapUnmanaged(void) = .empty;
    defer scope.deinit(std.testing.allocator);
    try scope.put(std.testing.allocator, "src/Scoped.sol", {});
    g.scoped_files = &scope;

    const scoped = try g.getNodesByKind(.callable, std.testing.allocator);
    defer std.testing.allocator.free(scoped);
    try std.testing.expectEqual(@as(usize, 1), scoped.len);
    try std.testing.expectEqualStrings("foo", scoped[0].name);
}

test "gapCount respects scoped_files" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // Two refs with gaps in different files
    try g.addRef(.{
        .id = refId("src/Scoped.sol", 10),
        .from = 1,
        .kind = .call,
        .target_name = "transfer",
        .site = .{ .file = "src/Scoped.sol", .start_byte = 10, .end_byte = 20, .line = 5, .column = 0 },
        .targets = .empty,
        .gap = .medium,
        .resolved = true,
    });
    try g.addRef(.{
        .id = refId("deps/Dep.sol", 10),
        .from = 2,
        .kind = .call,
        .target_name = "approve",
        .site = .{ .file = "deps/Dep.sol", .start_byte = 10, .end_byte = 20, .line = 3, .column = 0 },
        .targets = .empty,
        .gap = .high,
        .resolved = true,
    });

    // Without scope: both counted
    try std.testing.expectEqual(@as(u32, 2), g.gapCount());

    // With scope: only scoped ref counted
    var scope: std.StringHashMapUnmanaged(void) = .empty;
    defer scope.deinit(std.testing.allocator);
    try scope.put(std.testing.allocator, "src/Scoped.sol", {});
    g.scoped_files = &scope;

    try std.testing.expectEqual(@as(u32, 1), g.gapCount());
}

test "isRefInScope returns true when scope is null" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const ref = Reference{
        .id = refId("any.sol", 10),
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "any.sol", .start_byte = 10, .end_byte = 20, .line = 1, .column = 0 },
        .targets = .empty,
    };

    try std.testing.expect(g.isRefInScope(ref));
}

test "isRefInScope filters by scoped_files" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    var scope: std.StringHashMapUnmanaged(void) = .empty;
    defer scope.deinit(std.testing.allocator);
    try scope.put(std.testing.allocator, "src/In.sol", {});
    g.scoped_files = &scope;

    const in_scope = Reference{
        .id = refId("src/In.sol", 10),
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "src/In.sol", .start_byte = 10, .end_byte = 20, .line = 1, .column = 0 },
        .targets = .empty,
    };
    const out_of_scope = Reference{
        .id = refId("deps/Out.sol", 10),
        .from = 2,
        .kind = .call,
        .target_name = "bar",
        .site = .{ .file = "deps/Out.sol", .start_byte = 10, .end_byte = 20, .line = 1, .column = 0 },
        .targets = .empty,
    };

    try std.testing.expect(g.isRefInScope(in_scope));
    try std.testing.expect(!g.isRefInScope(out_of_scope));
}
