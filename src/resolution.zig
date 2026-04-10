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

pub const ParseErrorReason = enum {
    wrong_field_count,
    invalid_ref_id,
    invalid_line_number,
};

pub const ParseError = struct {
    row: u32,
    raw_line: []const u8,
    reason: ParseErrorReason,
};

pub const StaleReason = enum {
    not_found,
    already_resolved,
};

pub const StaleResolution = struct {
    row: u32,
    ref_id: u64,
    target_name: []const u8,
    reason: StaleReason,
};

pub const BrokenResolution = struct {
    row: u32,
    ref_id: u64,
    target_name: []const u8,
    target_file: []const u8,
    target_line: u32,
};

pub const ParsedResolution = struct {
    res: Resolution,
    csv_row: u32,
};

pub const ResolutionDiag = struct {
    parse_errors: std.ArrayList(ParseError) = .empty,
    stale: std.ArrayList(StaleResolution) = .empty,
    broken: std.ArrayList(BrokenResolution) = .empty,
    resolved_count: u32 = 0,
    allocator: std.mem.Allocator,
    /// Backing buffers whose slices are referenced by diagnostic entries.
    owned_buffers: std.ArrayList([]const u8) = .empty,

    pub fn init(allocator: std.mem.Allocator) ResolutionDiag {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *ResolutionDiag) void {
        self.parse_errors.deinit(self.allocator);
        self.stale.deinit(self.allocator);
        self.broken.deinit(self.allocator);
        for (self.owned_buffers.items) |buf| self.allocator.free(buf);
        self.owned_buffers.deinit(self.allocator);
    }

    /// Transfer ownership of a buffer to this diag so slices into it remain valid.
    pub fn ownBuffer(self: *ResolutionDiag, buf: []const u8) !void {
        try self.owned_buffers.append(self.allocator, buf);
    }

    pub fn hasDiagnostics(self: *const ResolutionDiag) bool {
        return self.parse_errors.items.len > 0 or
            self.stale.items.len > 0 or
            self.broken.items.len > 0;
    }
};

/// Parse a resolution CSV file. Returns owned slice of ParsedResolution.
/// Parse errors are recorded in `diag` instead of silently skipped.
pub fn parseResolutionFile(contents: []const u8, allocator: std.mem.Allocator, diag: *ResolutionDiag) ![]ParsedResolution {
    var resolutions: std.ArrayList(ParsedResolution) = .empty;

    var lines = std.mem.splitScalar(u8, contents, '\n');

    // Skip header line (row 1)
    _ = lines.next();
    var row: u32 = 1;

    while (lines.next()) |line| {
        row += 1;
        const trimmed = std.mem.trim(u8, line, &std.ascii.whitespace);
        if (trimmed.len == 0) continue;

        if (parseCsvLine(trimmed)) |res| {
            try resolutions.append(allocator, .{ .res = res, .csv_row = row });
        } else {
            // Determine the specific failure reason
            const reason = diagnoseCsvLine(trimmed);
            try diag.parse_errors.append(allocator, .{
                .row = row,
                .raw_line = trimmed,
                .reason = reason,
            });
        }
    }

    return resolutions.toOwnedSlice(allocator);
}

fn parseCsvLine(line: []const u8) ?Resolution {
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

/// Diagnose why a CSV line failed to parse (called only after parseCsvLine returns null).
fn diagnoseCsvLine(line: []const u8) ParseErrorReason {
    var field_count: usize = 0;
    var fields: [4][]const u8 = undefined;
    var it = std.mem.splitScalar(u8, line, ',');

    while (it.next()) |field| {
        if (field_count < 4) fields[field_count] = field;
        field_count += 1;
    }

    if (field_count != 4) return .wrong_field_count;

    // Check ref_id (hex)
    _ = std.fmt.parseInt(u64, fields[0], 16) catch return .invalid_ref_id;

    // Check line number (decimal)
    _ = std.fmt.parseInt(u32, fields[2], 10) catch return .invalid_line_number;

    return .wrong_field_count; // fallback (shouldn't reach here)
}

/// Apply resolutions to the graph:
/// - For each resolution: look up reference by ref_id
/// - Compute target node ID from (target_name, target_file, target_line)
/// - If ref found and has gap: add target, clear gap
/// - If ref not found or ref.gap is null: stale (warning)
/// - If target not found: broken (error)
pub fn applyResolutions(
    g: *graph.SymbolGraph,
    resolutions: []const ParsedResolution,
    diag: *ResolutionDiag,
) !void {
    // Ensure site_index is built for O(1) ref lookups
    try g.buildSiteIndex();

    // Track which refs we've already started resolving (for multi-row dispatch).
    // First row for a ref clears provisional targets + gap. Subsequent rows append.
    var seen_refs: std.AutoHashMapUnmanaged(u64, void) = .empty;
    defer seen_refs.deinit(diag.allocator);

    for (resolutions) |pr| {
        const res = pr.res;
        const ref = g.lookupRefMut(res.ref_id) orelse {
            try diag.stale.append(diag.allocator, .{
                .row = pr.csv_row,
                .ref_id = res.ref_id,
                .target_name = res.target_name,
                .reason = .not_found,
            });
            continue;
        };

        const first_time = !seen_refs.contains(res.ref_id);

        // First row must target a ref with a gap annotation.
        // Subsequent rows for the same ref are additional dispatch targets.
        if (first_time and ref.gap == null) {
            try diag.stale.append(diag.allocator, .{
                .row = pr.csv_row,
                .ref_id = res.ref_id,
                .target_name = res.target_name,
                .reason = .already_resolved,
            });
            continue;
        }

        // Compute target node ID using the same hash as §2.5.
        // Import refs target the file node (matching expandImports semantics):
        // the CSV target_file is the resolved dependency path, target_name/line are ignored.
        const target_id = if (ref.kind == .import)
            graph.nodeId(res.target_file, res.target_file, 1)
        else
            graph.nodeId(res.target_name, res.target_file, res.target_line);
        if (g.lookupNode(target_id) == null) {
            try diag.broken.append(diag.allocator, .{
                .row = pr.csv_row,
                .ref_id = res.ref_id,
                .target_name = res.target_name,
                .target_file = res.target_file,
                .target_line = res.target_line,
            });
            continue;
        }

        // First resolution for this ref: clear any provisional targets from static
        // analysis. The agent's answer replaces the default.
        if (first_time) {
            ref.targets.clearRetainingCapacity();
            ref.gap = null;
            try seen_refs.put(diag.allocator, res.ref_id, {});
        }

        // Add target (first or additional dispatch target)
        try ref.addTarget(g.allocator, target_id);
        ref.resolved = true;
        diag.resolved_count += 1;
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

test "parse CSV resolution file" {
    const csv =
        \\ref_id,target_file,target_line,target_name
        \\a4f2e81b,src/Ownable.sol,15,onlyOwner
        \\b7c3d012,src/Ownable.sol,3,Ownable
    ;

    var diag = ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();
    const resolutions = try parseResolutionFile(csv, std.testing.allocator, &diag);
    defer std.testing.allocator.free(resolutions);

    try std.testing.expectEqual(@as(usize, 2), resolutions.len);
    try std.testing.expectEqual(@as(usize, 0), diag.parse_errors.items.len);
    try std.testing.expectEqual(@as(u64, 0xa4f2e81b), resolutions[0].res.ref_id);
    try std.testing.expectEqualStrings("onlyOwner", resolutions[0].res.target_name);
    try std.testing.expectEqual(@as(u32, 15), resolutions[0].res.target_line);
    try std.testing.expectEqualStrings("src/Ownable.sol", resolutions[0].res.target_file);
    try std.testing.expectEqual(@as(u32, 2), resolutions[0].csv_row);
    try std.testing.expectEqual(@as(u64, 0xb7c3d012), resolutions[1].res.ref_id);
    try std.testing.expectEqualStrings("Ownable", resolutions[1].res.target_name);
    try std.testing.expectEqual(@as(u32, 3), resolutions[1].csv_row);
}

test "parse empty and malformed CSV lines" {
    const csv =
        \\ref_id,target_file,target_line,target_name
        \\
        \\not,enough,fields
        \\a4f2e81b,src/Ownable.sol,15,onlyOwner
    ;

    var diag = ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();
    const resolutions = try parseResolutionFile(csv, std.testing.allocator, &diag);
    defer std.testing.allocator.free(resolutions);

    try std.testing.expectEqual(@as(usize, 1), resolutions.len);
    try std.testing.expectEqual(@as(usize, 1), diag.parse_errors.items.len);
    try std.testing.expectEqual(@as(u32, 3), diag.parse_errors.items[0].row);
    try std.testing.expectEqual(ParseErrorReason.wrong_field_count, diag.parse_errors.items[0].reason);
}

test "apply resolutions: stale ref (not found)" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const resolutions = [_]ParsedResolution{.{
        .res = .{ .ref_id = 0xdeadbeef, .target_file = "src/Foo.sol", .target_line = 10, .target_name = "foo" },
        .csv_row = 2,
    }};

    var diag = ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();

    try applyResolutions(&g, &resolutions, &diag);
    try std.testing.expectEqual(@as(usize, 1), diag.stale.items.len);
    try std.testing.expectEqual(@as(u32, 0), diag.resolved_count);
    try std.testing.expectEqual(StaleReason.not_found, diag.stale.items[0].reason);
    try std.testing.expectEqual(@as(u32, 2), diag.stale.items[0].row);
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
    const rid = graph.refId("src/Vault.sol", 100, 120, .call);
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

    var diag = ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();
    const resolutions = try parseResolutionFile(csv, std.testing.allocator, &diag);
    defer std.testing.allocator.free(resolutions);

    try applyResolutions(&g, resolutions, &diag);

    try std.testing.expectEqual(@as(u32, 1), diag.resolved_count);

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
    const rid = graph.refId("src/Vault.sol", 100, 120, .call);
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

    var diag = ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();
    const resolutions = try parseResolutionFile(csv, std.testing.allocator, &diag);
    defer std.testing.allocator.free(resolutions);

    try applyResolutions(&g, resolutions, &diag);

    try std.testing.expectEqual(@as(u32, 2), diag.resolved_count);

    try g.buildSiteIndex();
    const ref = g.lookupRef(rid).?;
    try std.testing.expectEqual(@as(usize, 2), ref.targets.items.len);
    try std.testing.expect(ref.gap == null);
}

test "apply resolutions: nested call_expressions with same start_byte resolve independently" {
    // Regression: IERC20(asset()).balanceOf(...) — two .call refs sharing start_byte=100
    // but different end_bytes. Both should be resolvable via CSV with distinct ref_ids.
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // Target nodes
    const ierc20_id = graph.nodeId("IERC20", "deps/IERC20.sol", 5);
    _ = try g.addNode(.{ .id = ierc20_id, .kind = .callable, .language_kind = "function_definition", .name = "IERC20", .qualified_name = "IERC20", .language = .solidity });
    const balance_id = graph.nodeId("balanceOf", "deps/IERC20.sol", 20);
    _ = try g.addNode(.{ .id = balance_id, .kind = .callable, .language_kind = "function_definition", .name = "balanceOf", .qualified_name = "IERC20.balanceOf", .language = .solidity });

    // Inner ref: IERC20(asset()) — start=100, end=115
    const rid_inner = graph.refId("src/Vault.sol", 100, 115, .call);
    try g.addRef(.{
        .id = rid_inner,
        .from = 1,
        .kind = .call,
        .target_name = "IERC20",
        .site = .{ .file = "src/Vault.sol", .start_byte = 100, .end_byte = 115, .line = 77, .column = 0 },
        .targets = .empty,
        .gap = .medium,
        .resolved = true,
    });

    // Outer ref: ...balanceOf(address(this)) — start=100, end=150
    const rid_outer = graph.refId("src/Vault.sol", 100, 150, .call);
    try g.addRef(.{
        .id = rid_outer,
        .from = 1,
        .kind = .call,
        .target_name = "balanceOf",
        .site = .{ .file = "src/Vault.sol", .start_byte = 100, .end_byte = 150, .line = 77, .column = 0 },
        .targets = .empty,
        .gap = .medium,
        .resolved = true,
    });

    // CSV with both resolutions — distinct ref_ids
    var csv_buf: [512]u8 = undefined;
    const csv = try std.fmt.bufPrint(&csv_buf, "ref_id,target_file,target_line,target_name\n{x},deps/IERC20.sol,5,IERC20\n{x},deps/IERC20.sol,20,balanceOf\n", .{ rid_inner, rid_outer });

    var diag = ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();
    const resolutions = try parseResolutionFile(csv, std.testing.allocator, &diag);
    defer std.testing.allocator.free(resolutions);

    try applyResolutions(&g, resolutions, &diag);

    // Both resolved, zero stale/broken
    try std.testing.expectEqual(@as(u32, 2), diag.resolved_count);
    try std.testing.expectEqual(@as(usize, 0), diag.stale.items.len);
    try std.testing.expectEqual(@as(usize, 0), diag.broken.items.len);

    try g.buildSiteIndex();
    const inner = g.lookupRef(rid_inner).?;
    const outer = g.lookupRef(rid_outer).?;
    try std.testing.expect(inner.gap == null);
    try std.testing.expect(outer.gap == null);
    try std.testing.expectEqual(ierc20_id, inner.firstTarget().?);
    try std.testing.expectEqual(balance_id, outer.firstTarget().?);
}

test "apply resolutions: broken target (node not found)" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    const rid = graph.refId("src/Vault.sol", 100, 120, .call);
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

    var diag = ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();
    const resolutions = try parseResolutionFile(csv, std.testing.allocator, &diag);
    defer std.testing.allocator.free(resolutions);

    try applyResolutions(&g, resolutions, &diag);

    try std.testing.expectEqual(@as(u32, 0), diag.resolved_count);
    try std.testing.expectEqual(@as(usize, 1), diag.broken.items.len);
    try std.testing.expectEqualStrings("src/Missing.sol", diag.broken.items[0].target_file);
    try std.testing.expectEqual(@as(u32, 99), diag.broken.items[0].target_line);

    // Gap should still be set (resolution failed)
    try g.buildSiteIndex();
    const ref = g.lookupRef(rid).?;
    try std.testing.expect(ref.gap != null);
    try std.testing.expect(!ref.hasTargets());
}

test "apply resolutions: succeeds after pre-parsing target file into graph" {
    // Simulates the fix: resolution target file is parsed into the graph
    // before applyResolutions runs, so the target node lookup succeeds.
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // 1. Ref with gap in scoped file (the user's contract)
    const rid = graph.refId("src/Vault.sol", 100, 120, .call);
    try g.addRef(.{
        .id = rid,
        .from = 1,
        .kind = .call,
        .target_name = "onlyOwner",
        .site = .{ .file = "src/Vault.sol", .start_byte = 100, .end_byte = 120, .line = 10, .column = 0 },
        .targets = .empty,
        .gap = .medium,
        .resolved = true,
    });

    // 2. Target node from dependency file (simulates pre-parse of resolution target)
    const target_id = graph.nodeId("onlyOwner", "deps/Ownable.sol", 15);
    _ = try g.addNode(.{
        .id = target_id,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "onlyOwner",
        .qualified_name = "Ownable.onlyOwner",
        .language = .solidity,
        .locator = .{ .file = "deps/Ownable.sol", .start_byte = 0, .end_byte = 50, .line = 15, .column = 0 },
    });

    // 3. Apply resolution — should succeed now that target exists
    var csv_buf: [256]u8 = undefined;
    const csv = try std.fmt.bufPrint(&csv_buf, "ref_id,target_file,target_line,target_name\n{x},deps/Ownable.sol,15,onlyOwner\n", .{rid});

    var diag = ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();
    const resolutions = try parseResolutionFile(csv, std.testing.allocator, &diag);
    defer std.testing.allocator.free(resolutions);

    try applyResolutions(&g, resolutions, &diag);

    try std.testing.expectEqual(@as(u32, 1), diag.resolved_count);
    try std.testing.expectEqual(@as(usize, 0), diag.broken.items.len);
    try std.testing.expectEqual(@as(usize, 0), diag.stale.items.len);

    // Ref should now have the target and no gap
    try g.buildSiteIndex();
    const ref = g.lookupRef(rid).?;
    try std.testing.expect(ref.gap == null);
    try std.testing.expect(ref.hasTargets());
    try std.testing.expectEqual(target_id, ref.firstTarget().?);
}

test "apply resolutions: scoped_files excludes dependency gaps from count" {
    // After resolution, dependency file nodes are in the graph but out of scope.
    // gapCount should only count gaps from scoped files.
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // Gap in scoped file
    try g.addRef(.{
        .id = graph.refId("src/Vault.sol", 50, 60, .call),
        .from = 1,
        .kind = .call,
        .target_name = "transfer",
        .site = .{ .file = "src/Vault.sol", .start_byte = 50, .end_byte = 60, .line = 5, .column = 0 },
        .targets = .empty,
        .gap = .medium,
        .resolved = true,
    });

    // Gap in dependency file (from pre-parsed resolution target)
    try g.addRef(.{
        .id = graph.refId("deps/Ownable.sol", 30, 40, .call),
        .from = 2,
        .kind = .call,
        .target_name = "context",
        .site = .{ .file = "deps/Ownable.sol", .start_byte = 30, .end_byte = 40, .line = 8, .column = 0 },
        .targets = .empty,
        .gap = .high,
        .resolved = true,
    });

    // Without scope: 2 gaps
    try std.testing.expectEqual(@as(u32, 2), g.gapCount());

    // Set scope to user's file only
    var scope: std.StringHashMapUnmanaged(void) = .empty;
    defer scope.deinit(std.testing.allocator);
    try scope.put(std.testing.allocator, "src/Vault.sol", {});
    g.scoped_files = &scope;

    // With scope: only 1 gap (the one in src/Vault.sol)
    try std.testing.expectEqual(@as(u32, 1), g.gapCount());
}

test "apply resolutions: import gap resolves to file node" {
    // Import gaps target the file node (nodeId(path, path, 1)), not a symbol node.
    // The CSV target_name is ignored for imports — only target_file matters.
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // File node for the dependency (created by parseAndWalkFile)
    const dep_path = "deps/@openzeppelin-contracts/token/ERC20/IERC20.sol";
    const file_node_id = graph.nodeId(dep_path, dep_path, 1);
    _ = try g.addNode(.{
        .id = file_node_id,
        .kind = .file,
        .language_kind = "source_file",
        .name = dep_path,
        .qualified_name = dep_path,
        .language = .solidity,
    });

    // Import ref with unresolved gap (set by resolve() step 1)
    const rid = graph.refId("src/Vault.sol", 20, 80, .import);
    try g.addRef(.{
        .id = rid,
        .from = 1,
        .kind = .import,
        .target_name = "@openzeppelin/contracts/token/ERC20/IERC20.sol",
        .site = .{ .file = "src/Vault.sol", .start_byte = 20, .end_byte = 80, .line = 4, .column = 0 },
        .targets = .empty,
        .gap = .high,
        .resolved = true,
    });

    // CSV: agent provides the resolved file path — target_name can be anything
    var csv_buf: [512]u8 = undefined;
    const csv = try std.fmt.bufPrint(
        &csv_buf,
        "ref_id,target_file,target_line,target_name\n{x},{s},4,IERC20\n",
        .{ rid, dep_path },
    );

    var diag = ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();
    const resolutions = try parseResolutionFile(csv, std.testing.allocator, &diag);
    defer std.testing.allocator.free(resolutions);

    try applyResolutions(&g, resolutions, &diag);

    try std.testing.expectEqual(@as(u32, 1), diag.resolved_count);
    try std.testing.expectEqual(@as(usize, 0), diag.broken.items.len);
    try std.testing.expectEqual(@as(usize, 0), diag.stale.items.len);

    // Import gap cleared, target is the file node
    try g.buildSiteIndex();
    const ref = g.lookupRef(rid).?;
    try std.testing.expect(ref.gap == null);
    try std.testing.expectEqual(file_node_id, ref.firstTarget().?);
}
