const std = @import("std");
const ts = @import("tree-sitter");
const config = @import("languages/config.zig");

// ── §2.2 Node Taxonomy ────────────────────────────────────────────────

pub const NodeKind = enum {
    file,
    container,
    callable,
};

// ── §2.4 Reference Types ─────────────────────────────────────────────

pub const RefKind = enum {
    import,
    call,
    inheritance,
    using_for, // using X for Y — library attachment directive
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

/// Resolution state of a reference. Single source of truth for "did the
/// resolver classify this edge, and if so, how?"
///
///   .pending     — resolver hasn't run (or didn't touch this ref)
///   .resolved    — N>=1 confident targets, no gap
///   .ambiguous   — N>=1 targets, low-confidence (implicit .low gap priority)
///   .gap         — 0 targets, reportable gap at given priority
///   .classified  — 0 targets, deliberately not tracked (type constructor, etc.)
pub const Resolution = union(enum) {
    pending,
    resolved: std.ArrayListUnmanaged(u64),
    ambiguous: std.ArrayListUnmanaged(u64),
    gap: Priority,
    classified,
};

pub const Reference = struct {
    id: u64, // hash(file, start_byte, end_byte, kind)
    from: u64, // enclosing scope node (callable or container)
    kind: RefKind,
    target_name: []const u8,
    site: SourceLocator,

    resolution: Resolution = .pending,
    target_kind: ?CallTargetKind = null,

    // AST node for the reference site (e.g., the call_expression node).
    // Enables resolve hooks to inspect syntax (e.g., detect super.foo() qualifier).
    ast_node: ?ts.Node = null,

    pub fn targets(self: *const Reference) []const u64 {
        return switch (self.resolution) {
            .resolved, .ambiguous => |list| list.items,
            else => &.{},
        };
    }

    pub fn hasTargets(self: *const Reference) bool {
        return self.targets().len > 0;
    }

    pub fn firstTarget(self: *const Reference) ?u64 {
        const t = self.targets();
        return if (t.len > 0) t[0] else null;
    }

    /// Priority at which this ref should be reported as a gap, or null if not
    /// reportable. `.ambiguous` variants report at `.low` implicitly.
    pub fn gapPriority(self: *const Reference) ?Priority {
        return switch (self.resolution) {
            .gap => |p| p,
            .ambiguous => .low,
            else => null,
        };
    }

    pub fn isFinalized(self: *const Reference) bool {
        return self.resolution != .pending;
    }

    /// Append a target. Promotes `.pending` → `.resolved` with a new list.
    /// On `.resolved` or `.ambiguous`, appends to the existing list.
    /// Invalid from `.gap` / `.classified` — resolvers must not finalize-then-retarget.
    pub fn addTarget(self: *Reference, allocator: std.mem.Allocator, target_id: u64) !void {
        switch (self.resolution) {
            .pending => {
                var list: std.ArrayListUnmanaged(u64) = .empty;
                try list.append(allocator, target_id);
                self.resolution = .{ .resolved = list };
            },
            .resolved => |*list| try list.append(allocator, target_id),
            .ambiguous => |*list| try list.append(allocator, target_id),
            .gap, .classified => unreachable,
        }
    }

    /// Flip `.resolved` → `.ambiguous` in place (keeps the target list).
    pub fn markAmbiguous(self: *Reference) void {
        switch (self.resolution) {
            .resolved => |list| self.resolution = .{ .ambiguous = list },
            .ambiguous => {},
            else => unreachable,
        }
    }

    /// Drop any accumulated targets and set state to `.gap`.
    pub fn markGap(self: *Reference, allocator: std.mem.Allocator, priority: Priority) void {
        self.clearResolution(allocator);
        self.resolution = .{ .gap = priority };
    }

    /// Drop any accumulated targets and set state to `.classified`.
    pub fn markClassified(self: *Reference, allocator: std.mem.Allocator) void {
        self.clearResolution(allocator);
        self.resolution = .classified;
    }

    /// Reset to `.pending`, freeing any target list.
    pub fn clearResolution(self: *Reference, allocator: std.mem.Allocator) void {
        switch (self.resolution) {
            .resolved, .ambiguous => |*list| list.deinit(allocator),
            else => {},
        }
        self.resolution = .pending;
    }

    pub fn deinit(self: *Reference, allocator: std.mem.Allocator) void {
        switch (self.resolution) {
            .resolved, .ambiguous => |*list| list.deinit(allocator),
            else => {},
        }
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

pub fn refId(file: []const u8, start_byte: u32, end_byte: u32, kind: RefKind) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(file);
    hasher.update(std.mem.asBytes(&start_byte));
    hasher.update(std.mem.asBytes(&end_byte));
    hasher.update(std.mem.asBytes(&kind));
    return hasher.final();
}

/// Resolve the subtree root to search inside a container node: follow the
/// language config's `body_field` when present, otherwise the raw AST.
/// Non-container nodes return their AST unchanged.
pub fn containerBodyRoot(gn: *const GraphNode, ast: ts.Node) ts.Node {
    if (gn.kind != .container) return ast;
    const lc = config.getConfig(gn.language);
    for (lc.containers) |cm| {
        if (!std.mem.eql(u8, cm.ts_type, gn.language_kind)) continue;
        if (cm.body_field) |bf| return ast.childByFieldName(bf) orelse ast;
        return ast;
    }
    return ast;
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

    // Non-owning pointer to source text keyed by file path — for AST node text extraction.
    sources: ?*const std.StringHashMapUnmanaged([]const u8) = null,

    // Non-owning pointer to parsed trees keyed by file path — for tree→file lookup in nodeText.
    trees: ?*const std.StringHashMapUnmanaged(*ts.Tree) = null,

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
            r.deinit(self.allocator);
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
            if (ref.from == from_id and ref.hasTargets()) {
                if (kind_filter) |k| {
                    if (ref.kind != k) continue;
                }
                try result.append(allocator, ref);
            }
        }
        return try result.toOwnedSlice(allocator);
    }

    /// Get all references from a node (resolved or not), optionally filtered by kind.
    /// Unlike getOutgoingRefs, does not require targets — use for import dedup etc.
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
            if (!ref.hasTargets()) continue;
            if (kind_filter) |k| {
                if (ref.kind != k) continue;
            }
            for (ref.targets()) |target| {
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
            if (!ref.hasTargets()) continue;
            if (ref.kind != kind_filter) continue;
            for (ref.targets()) |target| {
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
            if (ref.from == container_id and ref.kind == .inheritance and ref.hasTargets()) {
                for (ref.targets()) |target| {
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
            if (ref.gapPriority() == null) continue;
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

    // ── Source Text ──────────────────────────────────────────────────

    /// Find the file path whose parsed tree owns this node (O(n) over files).
    /// Returns null if no trees map is attached or the node's tree isn't tracked.
    pub fn fileForNode(self: *const SymbolGraph, node: ts.Node) ?[]const u8 {
        const tree_map = self.trees orelse return null;
        var it = tree_map.iterator();
        while (it.next()) |entry| {
            if (@intFromPtr(entry.value_ptr.*) == @intFromPtr(node.tree)) {
                return entry.key_ptr.*;
            }
        }
        return null;
    }

    /// Get text for a tree-sitter node by slicing the source buffer for its file.
    pub fn nodeText(self: *const SymbolGraph, node: ts.Node) ?[]const u8 {
        const srcs = self.sources orelse return null;
        const file = self.fileForNode(node) orelse return null;
        const source = srcs.get(file) orelse return null;
        const start = node.startByte();
        const end = node.endByte();
        if (end > source.len) return null;
        return source[start..end];
    }

    /// Look up the source text for a file by path.
    pub fn sourceForFile(self: *const SymbolGraph, file: []const u8) ?[]const u8 {
        const srcs = self.sources orelse return null;
        return srcs.get(file);
    }

    /// Look up the source text for a ts.Node by matching its tree pointer.
    pub fn sourceForNode(self: *const SymbolGraph, node: ts.Node) ?[]const u8 {
        const srcs = self.sources orelse return null;
        const file = self.fileForNode(node) orelse return null;
        return srcs.get(file);
    }

    // ── Resolution (§4.1, §4.3) ─────────────────────────────────────

    pub const ResolveResult = struct {
        node: *GraphNode,
        ambiguous: bool,
    };

    /// Scoped resolution: check own container, then walk inheritance chain.
    pub fn resolveInScope(self: *const SymbolGraph, container_id: u64, name: []const u8, expected_kind: NodeKind) ?ResolveResult {
        // Check own container first
        const matches = self.lookupChildrenByName(container_id, name, expected_kind, self.allocator) catch return null;
        defer self.allocator.free(matches);
        if (matches.len > 0) {
            return .{ .node = matches[0], .ambiguous = matches.len > 1 };
        }

        return self.resolveInParents(container_id, name, expected_kind);
    }

    /// Collect resolved library container IDs from all .using_for refs in this
    /// container and all ancestors (C3 MRO walk). De-duplicated. Caller frees.
    pub fn getUsingForLibraries(
        self: *const SymbolGraph,
        container_id: u64,
        allocator: std.mem.Allocator,
    ) ![]const u64 {
        var mro = try self.computeC3Mro(container_id);
        defer mro.deinit(allocator);

        var seen: std.AutoHashMapUnmanaged(u64, void) = .empty;
        defer seen.deinit(allocator);
        var result: std.ArrayListUnmanaged(u64) = .empty;
        errdefer result.deinit(allocator);

        for (mro.items) |cid| {
            for (self.refs.items) |ref| {
                if (ref.kind != .using_for) continue;
                if (ref.from != cid) continue;
                for (ref.targets()) |lib_id| {
                    const gop = try seen.getOrPut(allocator, lib_id);
                    if (!gop.found_existing) try result.append(allocator, lib_id);
                }
            }
        }
        return result.toOwnedSlice(allocator);
    }

    /// Resolve in parent containers only (skips own container).
    /// Used for super-qualified calls.
    pub fn resolveInParentsOnly(self: *const SymbolGraph, container_id: u64, name: []const u8, expected_kind: NodeKind) ?ResolveResult {
        return self.resolveInParents(container_id, name, expected_kind);
    }

    // ── AST-Scoped Lookup (§graph-minimalism) ────────────────────────
    // Name+type lookup over the container's body AST (not the graph).
    // Walks the full C3 MRO chain so inherited declarations resolve too.
    // Used for types the minimal graph no longer indexes: variables,
    // events, errors, modifiers, struct/enum declarations.

    /// First matching AST node of `ts_type` with `name` field = `name` in
    /// the container's body or any ancestor's body (via MRO). Null if none.
    pub fn findInScope(
        self: *const SymbolGraph,
        container_id: u64,
        name: []const u8,
        ts_type: []const u8,
    ) ?ts.Node {
        var mro = self.computeC3Mro(container_id) catch return null;
        defer mro.deinit(self.allocator);
        for (mro.items) |cid| {
            if (self.scanContainerBody(cid, ts_type, name)) |found| return found;
        }
        return null;
    }

    /// Existence variant of `findInScope`.
    pub fn existsInScope(
        self: *const SymbolGraph,
        container_id: u64,
        name: []const u8,
        ts_type: []const u8,
    ) bool {
        return self.findInScope(container_id, name, ts_type) != null;
    }

    /// Scan one container's body for a direct child of `ts_type` whose `name`
    /// field text equals `name`. No MRO walk.
    fn scanContainerBody(
        self: *const SymbolGraph,
        container_id: u64,
        ts_type: []const u8,
        name: []const u8,
    ) ?ts.Node {
        const gn = self.lookupNode(container_id) orelse return null;
        const ast = gn.ast_node orelse return null;
        const search_root = containerBodyRoot(gn, ast);

        var i: u32 = 0;
        while (i < search_root.namedChildCount()) : (i += 1) {
            const child = search_root.namedChild(i) orelse continue;
            if (!std.mem.eql(u8, child.kind(), ts_type)) continue;
            const name_node = child.childByFieldName("name") orelse continue;
            const text = self.nodeText(name_node) orelse continue;
            if (std.mem.eql(u8, text, name)) return child;
        }
        return null;
    }

    fn resolveInParents(self: *const SymbolGraph, container_id: u64, name: []const u8, expected_kind: NodeKind) ?ResolveResult {
        const gn = self.lookupNode(container_id) orelse return null;
        const strategy = config.getConfig(gn.language).inheritance_strategy;
        switch (strategy) {
            .c3_linearization => return self.resolveC3(container_id, name, expected_kind),
            .single_chain => return self.resolveSingleChain(container_id, name, expected_kind),
            .flat => return null,
            .embedded_promotion => return self.resolveEmbedded(container_id, name, expected_kind),
        }
    }

    /// C3 linearization (Solidity, Python): right-to-left depth-first, deduplicated.
    fn resolveC3(self: *const SymbolGraph, container_id: u64, name: []const u8, expected_kind: NodeKind) ?ResolveResult {
        var mro = self.computeC3Mro(container_id) catch return null;
        defer mro.deinit(self.allocator);
        // Skip index 0 — that's the container itself, already checked by the caller
        for (mro.items[1..]) |parent_id| {
            const matches = self.lookupChildrenByName(parent_id, name, expected_kind, self.allocator) catch return null;
            defer self.allocator.free(matches);
            if (matches.len > 0) return .{ .node = matches[0], .ambiguous = matches.len > 1 };
        }
        return null;
    }

    /// Computes the C3 linearization MRO for container_id.
    fn computeC3Mro(self: *const SymbolGraph, container_id: u64) !std.ArrayList(u64) {
        const ally = self.allocator;
        var result: std.ArrayList(u64) = .empty;
        try result.append(ally, container_id);

        const parents = try self.getResolvedInheritanceTargets(container_id, ally);
        defer ally.free(parents);
        if (parents.len == 0) return result;

        var lists: std.ArrayList(std.ArrayList(u64)) = .empty;
        defer {
            for (lists.items) |*l| l.deinit(ally);
            lists.deinit(ally);
        }
        for (parents) |pid| {
            const parent_mro = try self.computeC3Mro(pid);
            try lists.append(ally, parent_mro);
        }
        var parents_list: std.ArrayList(u64) = .empty;
        try parents_list.appendSlice(ally, parents);
        try lists.append(ally, parents_list);

        // C3 merge
        while (true) {
            var all_empty = true;
            for (lists.items) |l| {
                if (l.items.len > 0) { all_empty = false; break; }
            }
            if (all_empty) break;

            var good_head: ?u64 = null;
            for (lists.items) |candidate_list| {
                if (candidate_list.items.len == 0) continue;
                const head = candidate_list.items[0];
                var in_tail = false;
                for (lists.items) |other| {
                    if (other.items.len <= 1) continue;
                    for (other.items[1..]) |tail_id| {
                        if (tail_id == head) { in_tail = true; break; }
                    }
                    if (in_tail) break;
                }
                if (!in_tail) { good_head = head; break; }
            }
            const head = good_head orelse break;
            try result.append(ally, head);
            for (lists.items) |*l| {
                if (l.items.len > 0 and l.items[0] == head) {
                    _ = l.orderedRemove(0);
                }
            }
        }

        return result;
    }

    /// Single chain (Java): one parent class + interfaces.
    fn resolveSingleChain(self: *const SymbolGraph, container_id: u64, name: []const u8, expected_kind: NodeKind) ?ResolveResult {
        const parents = self.getResolvedInheritanceTargets(container_id, self.allocator) catch return null;
        defer self.allocator.free(parents);

        if (parents.len > 0) {
            const parent_id = parents[0];
            const matches = self.lookupChildrenByName(parent_id, name, expected_kind, self.allocator) catch return null;
            defer self.allocator.free(matches);
            if (matches.len > 0) return .{ .node = matches[0], .ambiguous = matches.len > 1 };
            return self.resolveSingleChain(parent_id, name, expected_kind);
        }
        return null;
    }

    /// Embedded promotion (Go): shallowest embedding wins.
    fn resolveEmbedded(self: *const SymbolGraph, container_id: u64, name: []const u8, expected_kind: NodeKind) ?ResolveResult {
        const parents = self.getResolvedInheritanceTargets(container_id, self.allocator) catch return null;
        defer self.allocator.free(parents);

        var found: ?*GraphNode = null;
        for (parents) |parent_id| {
            if (self.lookupChildByName(parent_id, name, expected_kind)) |match| {
                if (found != null) return null; // ambiguous
                found = match;
            }
        }
        if (found) |f| return .{ .node = f, .ambiguous = false };

        var deep_result: ?ResolveResult = null;
        for (parents) |parent_id| {
            if (self.resolveEmbedded(parent_id, name, expected_kind)) |match| {
                if (deep_result != null) return null; // ambiguous
                deep_result = match;
            }
        }
        return deep_result;
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
    const id1 = refId("src/Vault.sol", 100, 150, .call);
    const id2 = refId("src/Vault.sol", 100, 150, .call);
    try std.testing.expectEqual(id1, id2);
}

test "refId differs for different byte offsets" {
    const id1 = refId("src/Vault.sol", 100, 150, .call);
    const id2 = refId("src/Vault.sol", 200, 250, .call);
    try std.testing.expect(id1 != id2);
}

test "refId differs for different files" {
    const id1 = refId("src/Vault.sol", 100, 150, .call);
    const id2 = refId("src/Ownable.sol", 100, 150, .call);
    try std.testing.expect(id1 != id2);
}

test "refId differs for nested calls with same start_byte" {
    // Inner call: IERC20(asset()) — start=100, end=115
    const id1 = refId("src/Vault.sol", 100, 115, .call);
    // Outer call: IERC20(asset()).balanceOf(...) — start=100, end=150
    const id2 = refId("src/Vault.sol", 100, 150, .call);
    try std.testing.expect(id1 != id2);
}

test "refId differs for different kinds at same span" {
    const id1 = refId("src/Vault.sol", 100, 150, .call);
    const id2 = refId("src/Vault.sol", 100, 150, .inheritance);
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
        .id = refId("test.sol", 50, 70, .call),
        .from = 1,
        .kind = .call,
        .target_name = "withdraw",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 70, .line = 5, .column = 4 },
    };
    defer ref.deinit(std.testing.allocator);

    // Starts pending
    try std.testing.expect(!ref.isFinalized());
    try std.testing.expect(!ref.hasTargets());

    // Resolve with target
    try ref.addTarget(std.testing.allocator, 42);

    try std.testing.expect(ref.isFinalized());
    try std.testing.expect(ref.hasTargets());
    try std.testing.expectEqual(@as(u64, 42), ref.firstTarget().?);
    try std.testing.expect(ref.gapPriority() == null);
}

test "Reference lifecycle: pending → gap" {
    var ref = Reference{
        .id = refId("test.sol", 50, 70, .call),
        .from = 1,
        .kind = .call,
        .target_name = "onlyOwner",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 70, .line = 5, .column = 4 },
        .resolution = .{ .gap = .high },
    };
    defer ref.deinit(std.testing.allocator);

    try std.testing.expect(ref.isFinalized());
    try std.testing.expect(!ref.hasTargets());
    try std.testing.expectEqual(Priority.high, ref.gapPriority().?);
}

test "Reference lifecycle: ambiguous (target + low-priority gap)" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    var ref = Reference{
        .id = refId("test.sol", 50, 70, .call),
        .from = 1,
        .kind = .call,
        .target_name = "method",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 70, .line = 5, .column = 4 },
        .target_kind = .cross_module,
    };
    defer ref.deinit(std.testing.allocator);

    try ref.addTarget(std.testing.allocator, 42);
    ref.markAmbiguous();

    try std.testing.expect(ref.isFinalized());
    try std.testing.expect(ref.hasTargets());
    try std.testing.expectEqual(Priority.low, ref.gapPriority().?);
    try std.testing.expectEqual(CallTargetKind.cross_module, ref.target_kind.?);
}

test "Reference multi-target (dynamic dispatch)" {
    var ref = Reference{
        .id = refId("test.sol", 50, 70, .call),
        .from = 1,
        .kind = .call,
        .target_name = "withdraw",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 70, .line = 5, .column = 4 },
    };
    defer ref.deinit(std.testing.allocator);

    try ref.addTarget(std.testing.allocator, 100);
    try ref.addTarget(std.testing.allocator, 200);
    ref.markAmbiguous();

    try std.testing.expectEqual(@as(usize, 2), ref.targets().len);
    try std.testing.expectEqual(@as(u64, 100), ref.targets()[0]);
    try std.testing.expectEqual(@as(u64, 200), ref.targets()[1]);
}

test "SymbolGraph addRef and site_index lookup" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const rid = refId("test.sol", 50, 70, .call);
    try g.addRef(.{
        .id = rid,
        .from = 1,
        .kind = .call,
        .target_name = "withdraw",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 70, .line = 5, .column = 4 },
        .resolution = .{ .gap = .medium },
    });

    try g.buildSiteIndex();

    const found = g.lookupRef(rid);
    try std.testing.expect(found != null);
    try std.testing.expectEqualStrings("withdraw", found.?.target_name);

    // Not found
    const missing = g.lookupRef(refId("other.sol", 50, 70, .call));
    try std.testing.expect(missing == null);
}

test "nested call_expressions at same start_byte are both reachable in site_index" {
    // Regression: IERC20(asset()).balanceOf(...) produces two call_expression nodes
    // that share start_byte. Before the fix, buildSiteIndex would overwrite the first.
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // Inner call: IERC20(asset()) — start=100, end=115
    const rid_inner = refId("src/Vault.sol", 100, 115, .call);
    try g.addRef(.{
        .id = rid_inner,
        .from = 1,
        .kind = .call,
        .target_name = "IERC20",
        .site = .{ .file = "src/Vault.sol", .start_byte = 100, .end_byte = 115, .line = 77, .column = 0 },
        .resolution = .{ .gap = .medium },
    });

    // Outer call: IERC20(asset()).balanceOf(address(this)) — start=100, end=150
    const rid_outer = refId("src/Vault.sol", 100, 150, .call);
    try g.addRef(.{
        .id = rid_outer,
        .from = 1,
        .kind = .call,
        .target_name = "balanceOf",
        .site = .{ .file = "src/Vault.sol", .start_byte = 100, .end_byte = 150, .line = 77, .column = 0 },
        .resolution = .{ .gap = .medium },
    });

    try std.testing.expect(rid_inner != rid_outer);

    try g.buildSiteIndex();

    // Both must be independently reachable
    const inner = g.lookupRef(rid_inner);
    const outer = g.lookupRef(rid_outer);
    try std.testing.expect(inner != null);
    try std.testing.expect(outer != null);
    try std.testing.expectEqualStrings("IERC20", inner.?.target_name);
    try std.testing.expectEqualStrings("balanceOf", outer.?.target_name);
}

test "SymbolGraph getOutgoingRefs filters by kind and resolved" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // Resolved call ref with target
    var ref1_targets: std.ArrayListUnmanaged(u64) = .empty;
    try ref1_targets.append(std.testing.allocator, 10);
    try g.addRef(.{
        .id = refId("test.sol", 50, 60, .call),
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .resolution = .{ .resolved = ref1_targets },
    });

    // Resolved inheritance ref with target
    var ref2_targets: std.ArrayListUnmanaged(u64) = .empty;
    try ref2_targets.append(std.testing.allocator, 20);
    try g.addRef(.{
        .id = refId("test.sol", 70, 80, .inheritance),
        .from = 1,
        .kind = .inheritance,
        .target_name = "Parent",
        .site = .{ .file = "test.sol", .start_byte = 70, .end_byte = 80, .line = 7, .column = 0 },
        .resolution = .{ .resolved = ref2_targets },
    });

    // Unresolved gap (no targets)
    try g.addRef(.{
        .id = refId("test.sol", 90, 100, .call),
        .from = 1,
        .kind = .call,
        .target_name = "bar",
        .site = .{ .file = "test.sol", .start_byte = 90, .end_byte = 100, .line = 9, .column = 0 },
        .resolution = .{ .gap = .medium },
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
        .id = refId("test.sol", 50, 60, .call),
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .resolution = .{ .resolved = targets },
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
        .id = refId("test.sol", 50, 60, .call),
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .resolution = .{ .resolved = targets },
    });

    try std.testing.expect(g.hasIncomingRefs(10, .call));
    try std.testing.expect(!g.hasIncomingRefs(10, .inheritance));
    try std.testing.expect(!g.hasIncomingRefs(999, .call));
}

test "SymbolGraph getResolvedInheritanceTargets preserves order" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // contract C is A, B → inheritance refs added in order A, B
    var t1: std.ArrayListUnmanaged(u64) = .empty;
    try t1.append(std.testing.allocator, 100);
    try g.addRef(.{
        .id = refId("test.sol", 10, 20, .inheritance),
        .from = 1,
        .kind = .inheritance,
        .target_name = "A",
        .site = .{ .file = "test.sol", .start_byte = 10, .end_byte = 20, .line = 1, .column = 0 },
        .resolution = .{ .resolved = t1 },
    });

    var t2: std.ArrayListUnmanaged(u64) = .empty;
    try t2.append(std.testing.allocator, 200);
    try g.addRef(.{
        .id = refId("test.sol", 30, 40, .inheritance),
        .from = 1,
        .kind = .inheritance,
        .target_name = "B",
        .site = .{ .file = "test.sol", .start_byte = 30, .end_byte = 40, .line = 1, .column = 20 },
        .resolution = .{ .resolved = t2 },
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
        .id = refId("test.sol", 50, 60, .call),
        .from = 1,
        .kind = .call,
        .target_name = "missing",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .resolution = .{ .gap = .high },
    });

    // Resolved (classified — e.g. struct constructor)
    try g.addRef(.{
        .id = refId("test.sol", 70, 80, .call),
        .from = 1,
        .kind = .call,
        .target_name = "found",
        .site = .{ .file = "test.sol", .start_byte = 70, .end_byte = 80, .line = 7, .column = 0 },
        .resolution = .classified,
    });

    // External low-level call — gap=.low
    try g.addRef(.{
        .id = refId("test.sol", 90, 100, .call),
        .from = 1,
        .kind = .call,
        .target_name = "external",
        .site = .{ .file = "test.sol", .start_byte = 90, .end_byte = 100, .line = 9, .column = 0 },
        .resolution = .{ .gap = .low },
    });

    try std.testing.expectEqual(@as(u32, 2), g.gapCount()); // two gaps, classified doesn't count
    try std.testing.expectEqual(@as(u32, 3), g.refCount());
}

test "SymbolGraph lookupRefMut allows mutation" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const rid = refId("test.sol", 50, 60, .call);
    try g.addRef(.{
        .id = rid,
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .resolution = .{ .gap = .medium },
    });

    try g.buildSiteIndex();

    // Mutate: resolve provisional gap by clearing and adding target
    if (g.lookupRefMut(rid)) |ref| {
        ref.clearResolution(g.allocator);
        try ref.addTarget(g.allocator, 42);
    }

    const ref = g.lookupRef(rid).?;
    try std.testing.expect(ref.isFinalized());
    try std.testing.expect(ref.gapPriority() == null);
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
        .id = nodeId("deposit", "test.sol", 3),
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "deposit",
        .qualified_name = "Vault.deposit",
        .container = cid,
        .language = .solidity,
    });

    // Find callable by name
    try std.testing.expect(g.lookupChildByName(cid, "withdraw", .callable) != null);
    try std.testing.expect(g.lookupChildByName(cid, "deposit", .callable) != null);
    // Wrong kind
    try std.testing.expect(g.lookupChildByName(cid, "withdraw", .container) == null);
    // Not found
    try std.testing.expect(g.lookupChildByName(cid, "missing", .callable) == null);
}

test "two calls to same target produce different refIds" {
    // This is the key bug the old model had — gapId(from, "transfer", .calls) would collide
    const id1 = refId("src/Vault.sol", 100, 150, .call); // first call to transfer()
    const id2 = refId("src/Vault.sol", 200, 250, .call); // second call to transfer()
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
        .id = refId("test.sol", 50, 60, .call),
        .from = fn_id,
        .kind = .call,
        .target_name = "withdraw",
        .site = .{ .file = "test.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .resolution = .{ .resolved = targets },
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
        .id = refId("src/Scoped.sol", 10, 20, .call),
        .from = 1,
        .kind = .call,
        .target_name = "transfer",
        .site = .{ .file = "src/Scoped.sol", .start_byte = 10, .end_byte = 20, .line = 5, .column = 0 },
        .resolution = .{ .gap = .medium },
    });
    try g.addRef(.{
        .id = refId("deps/Dep.sol", 10, 20, .call),
        .from = 2,
        .kind = .call,
        .target_name = "approve",
        .site = .{ .file = "deps/Dep.sol", .start_byte = 10, .end_byte = 20, .line = 3, .column = 0 },
        .resolution = .{ .gap = .high },
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
        .id = refId("any.sol", 10, 20, .call),
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "any.sol", .start_byte = 10, .end_byte = 20, .line = 1, .column = 0 },
    };

    try std.testing.expect(g.isRefInScope(ref));
}

test "findInScope walks MRO and returns inherited AST nodes" {
    const allocator = std.testing.allocator;

    const source =
        \\contract Base {
        \\    event BaseEvent(uint);
        \\    struct BaseStruct { uint x; }
        \\}
        \\contract Derived is Base {
        \\    event DerivedEvent(uint);
        \\}
    ;
    const parser = ts.Parser.create();
    defer parser.destroy();
    try parser.setLanguage(config.Language.solidity.grammarFn()());
    const tree = parser.parseString(source, null) orelse return error.ParseFailed;
    defer tree.destroy();

    var sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    defer sources.deinit(allocator);
    try sources.put(allocator, "t.sol", source);

    var trees_map: std.StringHashMapUnmanaged(*ts.Tree) = .empty;
    defer trees_map.deinit(allocator);
    try trees_map.put(allocator, "t.sol", tree);

    var g = SymbolGraph.init(allocator);
    defer g.deinit();
    g.sources = &sources;
    g.trees = &trees_map;

    // Locate contract_declaration AST nodes in order: Base, Derived.
    const root = tree.rootNode();
    var base_ast: ?ts.Node = null;
    var derived_ast: ?ts.Node = null;
    var i: u32 = 0;
    while (i < root.namedChildCount()) : (i += 1) {
        const child = root.namedChild(i) orelse continue;
        if (!std.mem.eql(u8, child.kind(), "contract_declaration")) continue;
        if (base_ast == null) base_ast = child else derived_ast = child;
    }

    const base_id: u64 = 1;
    const derived_id: u64 = 2;
    _ = try g.addNode(.{
        .id = base_id,
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Base",
        .qualified_name = "Base",
        .language = .solidity,
        .ast_node = base_ast.?,
        .locator = .{ .file = "t.sol", .start_byte = 0, .end_byte = 0, .line = 1, .column = 0 },
    });
    _ = try g.addNode(.{
        .id = derived_id,
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Derived",
        .qualified_name = "Derived",
        .language = .solidity,
        .ast_node = derived_ast.?,
        .locator = .{ .file = "t.sol", .start_byte = 0, .end_byte = 0, .line = 5, .column = 0 },
    });

    // Wire inheritance Derived → Base as a resolved ref (so C3 MRO walks it).
    var targets: std.ArrayListUnmanaged(u64) = .empty;
    try targets.append(allocator, base_id);
    try g.addRef(.{
        .id = refId("t.sol", 0, 0, .inheritance),
        .from = derived_id,
        .kind = .inheritance,
        .target_name = "Base",
        .site = .{ .file = "t.sol", .start_byte = 0, .end_byte = 0, .line = 5, .column = 0 },
        .resolution = .{ .resolved = targets },
    });

    // Own scope: Derived has DerivedEvent.
    try std.testing.expect(g.existsInScope(derived_id, "DerivedEvent", "event_definition"));
    // Inherited: Derived sees BaseEvent through MRO.
    try std.testing.expect(g.existsInScope(derived_id, "BaseEvent", "event_definition"));
    // MRO also walks structs: BaseStruct is visible from Derived.
    try std.testing.expect(g.existsInScope(derived_id, "BaseStruct", "struct_declaration"));
    // Wrong ts_type: no match.
    try std.testing.expect(!g.existsInScope(derived_id, "BaseEvent", "struct_declaration"));
    // Unknown name: no match.
    try std.testing.expect(!g.existsInScope(derived_id, "Nope", "event_definition"));
}

test "isRefInScope filters by scoped_files" {
    var g = SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    var scope: std.StringHashMapUnmanaged(void) = .empty;
    defer scope.deinit(std.testing.allocator);
    try scope.put(std.testing.allocator, "src/In.sol", {});
    g.scoped_files = &scope;

    const in_scope = Reference{
        .id = refId("src/In.sol", 10, 20, .call),
        .from = 1,
        .kind = .call,
        .target_name = "foo",
        .site = .{ .file = "src/In.sol", .start_byte = 10, .end_byte = 20, .line = 1, .column = 0 },
    };
    const out_of_scope = Reference{
        .id = refId("deps/Out.sol", 10, 20, .call),
        .from = 2,
        .kind = .call,
        .target_name = "bar",
        .site = .{ .file = "deps/Out.sol", .start_byte = 10, .end_byte = 20, .line = 1, .column = 0 },
    };

    try std.testing.expect(g.isRefInScope(in_scope));
    try std.testing.expect(!g.isRefInScope(out_of_scope));
}
