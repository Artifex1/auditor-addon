const std = @import("std");
const graph = @import("graph.zig");

// ── §8.3 Resolution File (CSV) ────────────────────────────────────────
//
// Format:
//   gap_id,edge_kind,target_file,target_line,target_name
//   a4f2e81b,calls,src/Ownable.sol,15,onlyOwner

pub const Resolution = struct {
    gap_id: u64,
    edge_kind: graph.EdgeKind,
    target_file: []const u8,
    target_line: u32,
    target_name: []const u8,
};

pub const ResolutionResult = struct {
    resolved: u32 = 0,
    stale: u32 = 0,
    broken: u32 = 0,
    warnings: std.ArrayList([]const u8) = .empty,
    errors: std.ArrayList([]const u8) = .empty,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) ResolutionResult {
        return .{
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *ResolutionResult) void {
        self.warnings.deinit(self.allocator);
        self.errors.deinit(self.allocator);
    }
};

/// Parse a resolution CSV file. Returns owned slice of Resolution.
pub fn parseResolutionFile(contents: []const u8, allocator: std.mem.Allocator) ![]Resolution {
    var resolutions: std.ArrayList(Resolution) = .empty;

    var lines = std.mem.splitScalar(u8, contents, '\n');

    // Skip header line
    _ = lines.next();

    while (lines.next()) |line| {
        const trimmed = std.mem.trim(u8, line, &std.ascii.whitespace);
        if (trimmed.len == 0) continue;

        const res = try parseCsvLine(trimmed) orelse continue;
        try resolutions.append(allocator, res);
    }

    return resolutions.toOwnedSlice(allocator);
}

fn parseCsvLine(line: []const u8) !?Resolution {
    var fields: [5][]const u8 = undefined;
    var field_count: usize = 0;
    var it = std.mem.splitScalar(u8, line, ',');

    while (it.next()) |field| {
        if (field_count >= 5) return null;
        fields[field_count] = field;
        field_count += 1;
    }

    if (field_count != 5) return null;

    // Parse gap_id as hex
    const gap_id = std.fmt.parseInt(u64, fields[0], 16) catch return null;

    // Parse edge_kind
    const edge_kind = parseEdgeKind(fields[1]) orelse return null;

    // Parse line number
    const target_line = std.fmt.parseInt(u32, fields[3], 10) catch return null;

    return Resolution{
        .gap_id = gap_id,
        .edge_kind = edge_kind,
        .target_file = fields[2],
        .target_line = target_line,
        .target_name = fields[4],
    };
}

fn parseEdgeKind(s: []const u8) ?graph.EdgeKind {
    const map = std.StaticStringMap(graph.EdgeKind).initComptime(.{
        .{ "imports", .imports },
        .{ "contains", .contains },
        .{ "calls", .calls },
        .{ "reads", .reads },
        .{ "writes", .writes },
        .{ "has_modifier", .has_modifier },
        .{ "inherits", .inherits },
        .{ "emits", .emits },
    });
    return map.get(s);
}

/// Apply resolutions to the graph per §3.3:
/// - For each resolution: look up gap by gap_id
/// - Compute target node ID from (target_name, target_file, target_line)
/// - If both gap and target exist: merge edge, eliminate gap
/// - If gap not found: stale (warning)
/// - If target not found: broken (error)
pub fn applyResolutions(
    g: *graph.SymbolGraph,
    resolutions: []const Resolution,
    result: *ResolutionResult,
) !void {
    for (resolutions) |res| {
        const gap = g.lookupGap(res.gap_id);
        if (gap == null) {
            result.stale += 1;
            try result.warnings.append(result.allocator, "stale resolution: gap not found");
            continue;
        }

        // Compute target node ID using the same hash as §2.5
        const target_id = graph.nodeId(res.target_name, res.target_file, res.target_line);
        const target_node = g.lookupNode(target_id);

        if (target_node == null) {
            result.broken += 1;
            try result.errors.append(result.allocator, "broken resolution: target node not found");
            continue;
        }

        // Merge: create concrete edge, eliminate gap
        try g.addEdge(.{
            .from = gap.?.from,
            .to = target_id,
            .kind = res.edge_kind,
            .attrs = .{
                .call_site_byte = if (gap.?.call_site) |cs| cs.start_byte else null,
                .call_site_line = if (gap.?.call_site) |cs| cs.line else null,
            },
        });

        _ = g.removeGap(res.gap_id);
        result.resolved += 1;
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

test "parse CSV resolution file" {
    const csv =
        \\gap_id,edge_kind,target_file,target_line,target_name
        \\a4f2e81b,calls,src/Ownable.sol,15,onlyOwner
        \\b7c3d012,inherits,src/Ownable.sol,3,Ownable
    ;

    const resolutions = try parseResolutionFile(csv, std.testing.allocator);
    defer std.testing.allocator.free(resolutions);

    try std.testing.expectEqual(@as(usize, 2), resolutions.len);
    try std.testing.expectEqual(graph.EdgeKind.calls, resolutions[0].edge_kind);
    try std.testing.expectEqualStrings("onlyOwner", resolutions[0].target_name);
    try std.testing.expectEqual(@as(u32, 15), resolutions[0].target_line);
    try std.testing.expectEqual(graph.EdgeKind.inherits, resolutions[1].edge_kind);
}

test "parse empty and malformed CSV lines" {
    const csv =
        \\gap_id,edge_kind,target_file,target_line,target_name
        \\
        \\not,enough,fields
        \\a4f2e81b,calls,src/Ownable.sol,15,onlyOwner
    ;

    const resolutions = try parseResolutionFile(csv, std.testing.allocator);
    defer std.testing.allocator.free(resolutions);

    try std.testing.expectEqual(@as(usize, 1), resolutions.len);
}

test "apply resolutions: stale gap" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const resolutions = [_]Resolution{.{
        .gap_id = 0xdeadbeef,
        .edge_kind = .calls,
        .target_file = "src/Foo.sol",
        .target_line = 10,
        .target_name = "foo",
    }};

    var result = ResolutionResult.init(std.testing.allocator);
    defer result.deinit();

    try applyResolutions(&g, &resolutions, &result);
    try std.testing.expectEqual(@as(u32, 1), result.stale);
    try std.testing.expectEqual(@as(u32, 0), result.resolved);
}
