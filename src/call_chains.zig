const std = @import("std");
const graph = @import("graph.zig");

// ── SPEC.md §11 — Call Chains ─────────────────────────────────────────
//
// Maps caller→callee relationships through the graph.
// DFS from root nodes (callables with no incoming call refs).

pub const CallChain = struct {
    path: []const []const u8, // sequence of callable names
};

pub const RootChainSet = struct {
    root_name: []const u8,
    root_id: u64,
    chains: std.ArrayList(CallChain),

    pub fn deinit(self: *RootChainSet, allocator: std.mem.Allocator) void {
        for (self.chains.items) |chain| {
            allocator.free(chain.path);
        }
        self.chains.deinit(allocator);
    }
};

/// Free an array of RootChainSets returned by computeCallChains.
pub fn freeCallChains(results: []RootChainSet, allocator: std.mem.Allocator) void {
    for (results) |*cs| {
        cs.deinit(allocator);
    }
    allocator.free(results);
}

/// Compute call chains from all roots or specific named roots.
/// Returns one RootChainSet per root.
pub fn computeCallChains(
    g: *const graph.SymbolGraph,
    root_filter: ?[]const []const u8,
    max_depth: u32,
    allocator: std.mem.Allocator,
) ![]RootChainSet {
    var results: std.ArrayList(RootChainSet) = .empty;

    const roots = try findRoots(g, root_filter, allocator);
    defer allocator.free(roots);

    for (roots) |root| {
        var chain_set = RootChainSet{
            .root_name = root.name,
            .root_id = root.id,
            .chains = .empty,
        };

        // DFS from root
        var path: std.ArrayList([]const u8) = .empty;
        defer path.deinit(allocator);

        var visited: std.AutoHashMapUnmanaged(u64, void) = .empty;
        defer visited.deinit(allocator);

        try dfs(g, root.id, root.name, &path, &visited, &chain_set.chains, max_depth, 0, allocator);

        try results.append(allocator, chain_set);
    }

    return results.toOwnedSlice(allocator);
}

/// Find root nodes: callables with no incoming `call` refs,
/// or specific nodes if root_filter is provided.
pub fn findRoots(
    g: *const graph.SymbolGraph,
    root_filter: ?[]const []const u8,
    allocator: std.mem.Allocator,
) ![]*graph.GraphNode {
    var roots: std.ArrayList(*graph.GraphNode) = .empty;

    var it = g.nodes.iterator();
    while (it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (node.kind != .callable) continue;

        if (g.scoped_files) |scope| {
            const file = if (node.locator) |loc| loc.file else "";
            if (file.len > 0 and !scope.contains(file)) continue;
        }

        if (root_filter) |filter| {
            // Only include named roots
            var matched = false;
            for (filter) |name| {
                if (std.mem.eql(u8, node.name, name)) {
                    matched = true;
                    break;
                }
            }
            if (!matched) continue;
            try roots.append(allocator, node);
        } else {
            // Check if this callable has any incoming call refs
            if (!g.hasIncomingRefs(node.id, .call)) {
                try roots.append(allocator, node);
            }
        }
    }

    return roots.toOwnedSlice(allocator);
}

/// DFS traversal following outgoing call refs.
fn dfs(
    g: *const graph.SymbolGraph,
    node_id: u64,
    node_name: []const u8,
    path: *std.ArrayList([]const u8),
    visited: *std.AutoHashMapUnmanaged(u64, void),
    chains: *std.ArrayList(CallChain),
    max_depth: u32,
    depth: u32,
    allocator: std.mem.Allocator,
) !void {
    if (depth > max_depth) return;

    // Cycle detection
    if (visited.contains(node_id)) return;
    try visited.put(allocator, node_id, {});
    try path.append(allocator, node_name);

    // Get outgoing call refs
    const refs = try g.getOutgoingRefs(node_id, .call, allocator);
    defer allocator.free(refs);

    // Collect all callee targets from refs
    var has_callees = false;
    for (refs) |ref| {
        for (ref.targets.items) |target| {
            if (g.lookupNode(target)) |callee_node| {
                has_callees = true;
                try dfs(g, callee_node.id, callee_node.name, path, visited, chains, max_depth, depth + 1, allocator);
            }
        }
    }

    if (!has_callees) {
        // Leaf node — record chain if it has more than just the root
        if (path.items.len > 1) {
            const chain_path = try allocator.dupe([]const u8, path.items);
            try chains.append(allocator, .{ .path = chain_path });
        }
    }

    _ = path.pop();
    _ = visited.remove(node_id);
}

/// Format a chain as "a -> b -> c" for TOON output.
pub fn formatChain(chain: CallChain, allocator: std.mem.Allocator) ![]const u8 {
    return std.mem.join(allocator, " -> ", chain.path);
}

// ── Tests ──────────────────────────────────────────────────────────────

test "findRoots: callable with no incoming calls is root" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // A calls B. A is root, B is not.
    const a_id = graph.nodeId("A", "test.sol", 1);
    _ = try g.addNode(.{
        .id = a_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "A",
        .qualified_name = "A",
        .language = .solidity,
    });

    const b_id = graph.nodeId("B", "test.sol", 5);
    _ = try g.addNode(.{
        .id = b_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "B",
        .qualified_name = "B",
        .language = .solidity,
    });

    var targets: std.ArrayListUnmanaged(u64) = .empty;
    try targets.append(std.testing.allocator, b_id);
    try g.addRef(.{
        .id = graph.refId("test.sol", 10),
        .from = a_id,
        .kind = .call,
        .target_name = "B",
        .site = .{ .file = "test.sol", .start_byte = 10, .end_byte = 20, .line = 2, .column = 0 },
        .targets = targets,
        .resolved = true,
    });

    const roots = try findRoots(&g, null, std.testing.allocator);
    defer std.testing.allocator.free(roots);

    try std.testing.expectEqual(@as(usize, 1), roots.len);
    try std.testing.expectEqualStrings("A", roots[0].name);
}

test "formatChain" {
    const chain = CallChain{ .path = &.{ "withdraw", "_transfer", "_updateBalance" } };
    const formatted = try formatChain(chain, std.testing.allocator);
    defer std.testing.allocator.free(formatted);
    try std.testing.expectEqualStrings("withdraw -> _transfer -> _updateBalance", formatted);
}
