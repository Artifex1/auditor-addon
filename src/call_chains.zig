const std = @import("std");
const graph = @import("graph.zig");

// ── SPEC.md §11 — Call Chains ─────────────────────────────────────────
//
// Maps caller→callee relationships through the graph.
// DFS from root nodes (callables with no incoming calls edges).

pub const CallChain = struct {
    path: []const []const u8, // sequence of callable names
};

pub const RootChainSet = struct {
    root_name: []const u8,
    root_id: u64,
    chains: std.ArrayList(CallChain),
};

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

/// Find root nodes: callables with no incoming `calls` edges,
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
            // Check if this callable has any incoming calls edges
            const incoming = try g.getIncomingEdges(node.id, .calls, allocator);
            defer allocator.free(incoming);
            if (incoming.len == 0) {
                try roots.append(allocator, node);
            }
        }
    }

    return roots.toOwnedSlice(allocator);
}

/// DFS traversal following outgoing calls edges.
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

    // Get outgoing calls
    const callees = try g.getOutgoingEdges(node_id, .calls, allocator);
    defer allocator.free(callees);

    if (callees.len == 0) {
        // Leaf node — record chain if it has more than just the root
        if (path.items.len > 1) {
            const chain_path = try allocator.dupe([]const u8, path.items);
            try chains.append(allocator, .{ .path = chain_path });
        }
    } else {
        for (callees) |edge| {
            if (g.lookupNode(edge.to)) |callee_node| {
                try dfs(g, callee_node.id, callee_node.name, path, visited, chains, max_depth, depth + 1, allocator);
            }
        }

        // If this is a non-leaf that also has calls, record the direct path too
        // (only if no children were visited — all children were in visited set)
        // Actually per spec: record each unique caller→callee path. The DFS
        // already records at leaves, which captures full paths.
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

    try g.addEdge(.{ .from = a_id, .to = b_id, .kind = .calls });

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
