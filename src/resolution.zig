const std = @import("std");
const graph = @import("graph.zig");

// ── §8.3 Resolution File (CSV) ────────────────────────────────────────
//
// Format:
//   ref_id,target_file,target_line,target_name
//   a4f2e81b,src/Ownable.sol,15,onlyOwner

pub const Resolution = struct {
    ref_id: u64,
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
    var fields: [4][]const u8 = undefined;
    var field_count: usize = 0;
    var it = std.mem.splitScalar(u8, line, ',');

    while (it.next()) |field| {
        if (field_count >= 4) return null;
        fields[field_count] = field;
        field_count += 1;
    }

    if (field_count != 4) return null;

    // Parse ref_id as hex
    const ref_id = std.fmt.parseInt(u64, fields[0], 16) catch return null;

    // Parse line number
    const target_line = std.fmt.parseInt(u32, fields[2], 10) catch return null;

    return Resolution{
        .ref_id = ref_id,
        .target_file = fields[1],
        .target_line = target_line,
        .target_name = fields[3],
    };
}

/// Apply resolutions to the graph:
/// - For each resolution: look up reference by ref_id
/// - Compute target node ID from (target_name, target_file, target_line)
/// - If ref found and has gap: add target, clear gap
/// - If ref not found or ref.gap is null: stale (warning)
/// - If target not found: broken (error)
pub fn applyResolutions(
    g: *graph.SymbolGraph,
    resolutions: []const Resolution,
    result: *ResolutionResult,
) !void {
    // Ensure site_index is built for O(1) ref lookups
    try g.buildSiteIndex();

    // Track which refs we've already started resolving (for multi-row dispatch).
    // First row for a ref clears provisional targets + gap. Subsequent rows append.
    var seen_refs: std.AutoHashMapUnmanaged(u64, void) = .empty;
    defer seen_refs.deinit(result.allocator);

    for (resolutions) |res| {
        const ref = g.lookupRefMut(res.ref_id) orelse {
            result.stale += 1;
            try result.warnings.append(result.allocator, res.target_name);
            continue;
        };

        const first_time = !seen_refs.contains(res.ref_id);

        // First row must target a ref with a gap annotation.
        // Subsequent rows for the same ref are additional dispatch targets.
        if (first_time and ref.gap == null) {
            result.stale += 1;
            try result.warnings.append(result.allocator, res.target_name);
            continue;
        }

        // Compute target node ID using the same hash as §2.5
        const target_id = graph.nodeId(res.target_name, res.target_file, res.target_line);
        if (g.lookupNode(target_id) == null) {
            result.broken += 1;
            try result.errors.append(result.allocator, res.target_name);
            continue;
        }

        // First resolution for this ref: clear any provisional targets from static
        // analysis. The agent's answer replaces the default.
        if (first_time) {
            ref.targets.clearRetainingCapacity();
            ref.gap = null;
            try seen_refs.put(result.allocator, res.ref_id, {});
        }

        // Add target (first or additional dispatch target)
        try ref.addTarget(g.allocator, target_id);
        ref.resolved = true;
        result.resolved += 1;
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

test "parse CSV resolution file" {
    const csv =
        \\ref_id,target_file,target_line,target_name
        \\a4f2e81b,src/Ownable.sol,15,onlyOwner
        \\b7c3d012,src/Ownable.sol,3,Ownable
    ;

    const resolutions = try parseResolutionFile(csv, std.testing.allocator);
    defer std.testing.allocator.free(resolutions);

    try std.testing.expectEqual(@as(usize, 2), resolutions.len);
    try std.testing.expectEqual(@as(u64, 0xa4f2e81b), resolutions[0].ref_id);
    try std.testing.expectEqualStrings("onlyOwner", resolutions[0].target_name);
    try std.testing.expectEqual(@as(u32, 15), resolutions[0].target_line);
    try std.testing.expectEqualStrings("src/Ownable.sol", resolutions[0].target_file);
    try std.testing.expectEqual(@as(u64, 0xb7c3d012), resolutions[1].ref_id);
    try std.testing.expectEqualStrings("Ownable", resolutions[1].target_name);
}

test "parse empty and malformed CSV lines" {
    const csv =
        \\ref_id,target_file,target_line,target_name
        \\
        \\not,enough,fields
        \\a4f2e81b,src/Ownable.sol,15,onlyOwner
    ;

    const resolutions = try parseResolutionFile(csv, std.testing.allocator);
    defer std.testing.allocator.free(resolutions);

    try std.testing.expectEqual(@as(usize, 1), resolutions.len);
}

test "apply resolutions: stale ref (not found)" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const resolutions = [_]Resolution{.{
        .ref_id = 0xdeadbeef,
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

test "apply resolutions: provisional ref gets targets replaced" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // Create a target node the resolution will point to
    const new_target_id = graph.nodeId("withdraw", "src/VaultImpl.sol", 42);
    _ = try g.addNode(.{
        .id = new_target_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "VaultImpl.withdraw",
        .language = .solidity,
    });

    // Create a provisional ref (has a default target + gap)
    const rid = graph.refId("src/Vault.sol", 100);
    var provisional_targets: std.ArrayListUnmanaged(u64) = .empty;
    try provisional_targets.append(std.testing.allocator, 999); // provisional default
    try g.addRef(.{
        .id = rid,
        .from = 1,
        .kind = .call,
        .target_name = "call",
        .site = .{ .file = "src/Vault.sol", .start_byte = 100, .end_byte = 120, .line = 10, .column = 0 },
        .targets = provisional_targets,
        .target_kind = .external,
        .gap = .low,
        .resolved = true,
    });

    var csv_buf: [256]u8 = undefined;
    const csv = try std.fmt.bufPrint(&csv_buf, "ref_id,target_file,target_line,target_name\n{x},src/VaultImpl.sol,42,withdraw\n", .{rid});

    const resolutions = try parseResolutionFile(csv, std.testing.allocator);
    defer std.testing.allocator.free(resolutions);

    var result = ResolutionResult.init(std.testing.allocator);
    defer result.deinit();
    try applyResolutions(&g, resolutions, &result);

    try std.testing.expectEqual(@as(u32, 1), result.resolved);

    // The old provisional target (999) should be replaced, not appended to
    try g.buildSiteIndex();
    const ref = g.lookupRef(rid).?;
    try std.testing.expectEqual(@as(usize, 1), ref.targets.items.len);
    try std.testing.expectEqual(new_target_id, ref.firstTarget().?);
    try std.testing.expect(ref.gap == null);
}

test "apply resolutions: multi-row dispatch (two targets for same ref)" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const target_a = graph.nodeId("withdrawA", "src/A.sol", 10);
    const target_b = graph.nodeId("withdrawB", "src/B.sol", 20);
    _ = try g.addNode(.{ .id = target_a, .kind = .callable, .language_kind = "function_definition", .name = "withdrawA", .qualified_name = "A.withdrawA", .language = .solidity });
    _ = try g.addNode(.{ .id = target_b, .kind = .callable, .language_kind = "function_definition", .name = "withdrawB", .qualified_name = "B.withdrawB", .language = .solidity });

    // Unresolved ref (gap, no targets)
    const rid = graph.refId("src/Vault.sol", 100);
    try g.addRef(.{
        .id = rid,
        .from = 1,
        .kind = .call,
        .target_name = "withdraw",
        .site = .{ .file = "src/Vault.sol", .start_byte = 100, .end_byte = 120, .line = 10, .column = 0 },
        .targets = .empty,
        .gap = .medium,
        .resolved = true,
    });

    // Two CSV rows for the same ref_id → multi-dispatch
    var csv_buf: [512]u8 = undefined;
    const csv = try std.fmt.bufPrint(&csv_buf, "ref_id,target_file,target_line,target_name\n{x},src/A.sol,10,withdrawA\n{x},src/B.sol,20,withdrawB\n", .{ rid, rid });

    const resolutions = try parseResolutionFile(csv, std.testing.allocator);
    defer std.testing.allocator.free(resolutions);

    var result = ResolutionResult.init(std.testing.allocator);
    defer result.deinit();
    try applyResolutions(&g, resolutions, &result);

    try std.testing.expectEqual(@as(u32, 2), result.resolved);

    try g.buildSiteIndex();
    const ref = g.lookupRef(rid).?;
    try std.testing.expectEqual(@as(usize, 2), ref.targets.items.len);
    try std.testing.expect(ref.gap == null);
}

test "apply resolutions: broken target (node not found)" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const rid = graph.refId("src/Vault.sol", 100);
    try g.addRef(.{
        .id = rid,
        .from = 1,
        .kind = .call,
        .target_name = "missing",
        .site = .{ .file = "src/Vault.sol", .start_byte = 100, .end_byte = 120, .line = 10, .column = 0 },
        .targets = .empty,
        .gap = .high,
        .resolved = true,
    });

    var csv_buf: [256]u8 = undefined;
    const csv = try std.fmt.bufPrint(&csv_buf, "ref_id,target_file,target_line,target_name\n{x},src/Missing.sol,99,doesNotExist\n", .{rid});

    const resolutions = try parseResolutionFile(csv, std.testing.allocator);
    defer std.testing.allocator.free(resolutions);

    var result = ResolutionResult.init(std.testing.allocator);
    defer result.deinit();
    try applyResolutions(&g, resolutions, &result);

    try std.testing.expectEqual(@as(u32, 0), result.resolved);
    try std.testing.expectEqual(@as(u32, 1), result.broken);

    // Gap should still be set (resolution failed)
    try g.buildSiteIndex();
    const ref = g.lookupRef(rid).?;
    try std.testing.expect(ref.gap != null);
    try std.testing.expect(!ref.hasTargets());
}
