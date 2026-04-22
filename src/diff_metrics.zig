const std = @import("std");
const ts = @import("tree-sitter");
const config = @import("languages/config.zig");
const metrics = @import("metrics.zig");
const test_filter = @import("test_filter.zig");

// ── SPEC-CLI.md §3 — diff-metrics ────────────────────────────────────
//
// Compute metrics restricted to lines added/removed between two git refs.
// Shell out to git for diff data; parse --name-status (file status + paths)
// and -U0 hunks (line ranges) ourselves.

pub const FileStatus = enum { added, modified, renamed, deleted };

pub const LineRange = struct {
    start: u32, // 1-indexed inclusive
    count: u32,

    pub fn contains(self: LineRange, line: u32) bool {
        return line >= self.start and line < self.start + self.count;
    }
};

pub const DiffFile = struct {
    status: FileStatus,
    /// For added/modified/renamed: path on head side.
    /// For deleted: path on base side.
    head_path: []const u8,
    /// Old path (only set for renamed + deleted).
    base_path: ?[]const u8,
    added_ranges: []LineRange,
    removed_ranges: []LineRange,

    pub fn hasLineInAdded(self: DiffFile, line: u32) bool {
        for (self.added_ranges) |r| if (r.contains(line)) return true;
        return false;
    }

    pub fn hasLineInRemoved(self: DiffFile, line: u32) bool {
        for (self.removed_ranges) |r| if (r.contains(line)) return true;
        return false;
    }
};

// ── Git invocation + parsing ─────────────────────────────────────────

pub fn runGitDiff(
    gpa: std.mem.Allocator,
    arena: std.mem.Allocator,
    base: []const u8,
    head: []const u8,
    globs: []const []const u8,
) ![]DiffFile {
    // name-status pass
    var ns_argv: std.ArrayList([]const u8) = .empty;
    defer ns_argv.deinit(gpa);
    try ns_argv.appendSlice(gpa, &.{ "git", "diff", "--name-status", "-M", base, head });
    if (globs.len > 0) {
        try ns_argv.append(gpa, "--");
        for (globs) |g| try ns_argv.append(gpa, g);
    }

    const ns = try std.process.Child.run(.{
        .allocator = gpa,
        .argv = ns_argv.items,
        .max_output_bytes = 50 * 1024 * 1024,
    });
    defer gpa.free(ns.stdout);
    defer gpa.free(ns.stderr);

    switch (ns.term) {
        .Exited => |code| if (code != 0) {
            var buf: [1024]u8 = undefined;
            var w = std.fs.File.stderr().writer(&buf);
            _ = w.interface.writeAll("git diff failed:\n") catch {};
            _ = w.interface.writeAll(ns.stderr) catch {};
            _ = w.interface.flush() catch {};
            return error.GitDiffFailed;
        },
        else => return error.GitDiffFailed,
    }

    // Parse name-status → per-file DiffFile (keyed by head_path or base_path for deletes)
    var map: std.StringArrayHashMap(*DiffFile) = .init(gpa);
    defer map.deinit();

    var line_it = std.mem.splitScalar(u8, ns.stdout, '\n');
    while (line_it.next()) |line| {
        if (line.len == 0) continue;
        var fields = std.mem.splitScalar(u8, line, '\t');
        const status_str = fields.next() orelse continue;
        if (status_str.len == 0) continue;
        const path1 = fields.next() orelse continue;
        const path2_opt = fields.next();

        const df = try arena.create(DiffFile);
        df.* = .{
            .status = undefined,
            .head_path = "",
            .base_path = null,
            .added_ranges = &.{},
            .removed_ranges = &.{},
        };

        const status_char = status_str[0];
        switch (status_char) {
            'A' => {
                df.status = .added;
                df.head_path = try arena.dupe(u8, path1);
            },
            'M' => {
                df.status = .modified;
                df.head_path = try arena.dupe(u8, path1);
            },
            'D' => {
                df.status = .deleted;
                df.head_path = try arena.dupe(u8, path1);
                df.base_path = df.head_path;
            },
            'R', 'C' => {
                const p2 = path2_opt orelse continue;
                df.status = .renamed;
                df.base_path = try arena.dupe(u8, path1);
                df.head_path = try arena.dupe(u8, p2);
            },
            'T' => { // type change (symlink ↔ file) — treat as modified
                df.status = .modified;
                df.head_path = try arena.dupe(u8, path1);
            },
            else => continue,
        }

        const key = if (df.status == .deleted) df.base_path.? else df.head_path;
        try map.put(key, df);
    }

    // Hunks pass
    var hk_argv: std.ArrayList([]const u8) = .empty;
    defer hk_argv.deinit(gpa);
    try hk_argv.appendSlice(gpa, &.{ "git", "diff", "-U0", "-M", base, head });
    if (globs.len > 0) {
        try hk_argv.append(gpa, "--");
        for (globs) |g| try hk_argv.append(gpa, g);
    }

    const hk = try std.process.Child.run(.{
        .allocator = gpa,
        .argv = hk_argv.items,
        .max_output_bytes = 200 * 1024 * 1024,
    });
    defer gpa.free(hk.stdout);
    defer gpa.free(hk.stderr);

    switch (hk.term) {
        .Exited => |code| if (code != 0) return error.GitDiffFailed,
        else => return error.GitDiffFailed,
    }

    try parseHunks(gpa, arena, hk.stdout, &map);

    // Collect in insertion order
    var out: std.ArrayList(DiffFile) = .empty;
    for (map.values()) |ptr| {
        try out.append(arena, ptr.*);
    }
    return out.toOwnedSlice(arena);
}

fn parseHunks(
    gpa: std.mem.Allocator,
    arena: std.mem.Allocator,
    stdout: []const u8,
    map: *std.StringArrayHashMap(*DiffFile),
) !void {
    var current: ?*DiffFile = null;
    var added: std.ArrayList(LineRange) = .empty;
    var removed: std.ArrayList(LineRange) = .empty;
    defer added.deinit(gpa);
    defer removed.deinit(gpa);

    var lines = std.mem.splitScalar(u8, stdout, '\n');
    while (lines.next()) |line| {
        if (std.mem.startsWith(u8, line, "diff --git ")) {
            try flush(arena, current, &added, &removed);
            current = null;
        } else if (std.mem.startsWith(u8, line, "--- ")) {
            // May precede +++; use to locate deleted-file entries whose +++ is /dev/null
            const pp = line[4..];
            if (std.mem.startsWith(u8, pp, "a/")) {
                const path = pp[2..];
                if (map.get(path)) |df| {
                    if (df.status == .deleted) current = df;
                }
            }
        } else if (std.mem.startsWith(u8, line, "+++ ")) {
            const pp = line[4..];
            if (std.mem.eql(u8, pp, "/dev/null")) {
                // deletion — `current` already set by the --- line above
            } else if (std.mem.startsWith(u8, pp, "b/")) {
                const path = pp[2..];
                if (map.get(path)) |df| current = df;
            }
        } else if (std.mem.startsWith(u8, line, "@@ ")) {
            if (parseHunkHeader(line)) |hh| {
                if (hh.old_count > 0) try removed.append(gpa, .{ .start = hh.old_start, .count = hh.old_count });
                if (hh.new_count > 0) try added.append(gpa, .{ .start = hh.new_start, .count = hh.new_count });
            }
        }
    }
    try flush(arena, current, &added, &removed);
}

fn flush(
    arena: std.mem.Allocator,
    cur: ?*DiffFile,
    added: *std.ArrayList(LineRange),
    removed: *std.ArrayList(LineRange),
) !void {
    if (cur) |df| {
        df.added_ranges = try arena.dupe(LineRange, added.items);
        df.removed_ranges = try arena.dupe(LineRange, removed.items);
    }
    added.clearRetainingCapacity();
    removed.clearRetainingCapacity();
}

const HunkHeader = struct {
    old_start: u32,
    old_count: u32,
    new_start: u32,
    new_count: u32,
};

fn parseHunkHeader(line: []const u8) ?HunkHeader {
    if (!std.mem.startsWith(u8, line, "@@ ")) return null;
    var i: usize = 3;
    if (i >= line.len or line[i] != '-') return null;
    i += 1;
    const old_start = parseUint(line, &i) orelse return null;
    var old_count: u32 = 1;
    if (i < line.len and line[i] == ',') {
        i += 1;
        old_count = parseUint(line, &i) orelse return null;
    }
    if (i >= line.len or line[i] != ' ') return null;
    i += 1;
    if (i >= line.len or line[i] != '+') return null;
    i += 1;
    const new_start = parseUint(line, &i) orelse return null;
    var new_count: u32 = 1;
    if (i < line.len and line[i] == ',') {
        i += 1;
        new_count = parseUint(line, &i) orelse return null;
    }
    return .{
        .old_start = old_start,
        .old_count = old_count,
        .new_start = new_start,
        .new_count = new_count,
    };
}

fn parseUint(s: []const u8, i: *usize) ?u32 {
    const start = i.*;
    while (i.* < s.len and std.ascii.isDigit(s[i.*])) : (i.* += 1) {}
    if (i.* == start) return null;
    return std.fmt.parseUnsigned(u32, s[start..i.*], 10) catch null;
}

// ── git show — fetch a file's content at a given ref ─────────────────

pub fn gitShow(
    gpa: std.mem.Allocator,
    arena: std.mem.Allocator,
    ref: []const u8,
    path: []const u8,
) !?[]const u8 {
    const spec = try std.fmt.allocPrint(gpa, "{s}:{s}", .{ ref, path });
    defer gpa.free(spec);

    const res = try std.process.Child.run(.{
        .allocator = gpa,
        .argv = &.{ "git", "show", spec },
        .max_output_bytes = 50 * 1024 * 1024,
    });
    defer gpa.free(res.stderr);

    switch (res.term) {
        .Exited => |code| {
            if (code != 0) {
                gpa.free(res.stdout);
                return null;
            }
        },
        else => {
            gpa.free(res.stdout);
            return null;
        },
    }
    const dup = try arena.dupe(u8, res.stdout);
    gpa.free(res.stdout);
    return dup;
}

// ── Per-file metric computation ──────────────────────────────────────

pub const AddedResult = struct {
    nloc: u32,
    comment_lines: u32,
    complexity: u32,
    changed_functions: []const []const u8,
};

/// Walk tree once, compute per-line exclusion masks, then derive:
///   nloc_added = |{L in added ∧ !blank ∧ !test ∧ !comment ∧ !norm_continuation}|
///   comment_lines_added = |{L in added ∧ !blank ∧ !test ∧ comment}|
///   complexity_added = sum over branching nodes with startRow+1 in added
///                      (and not in test subtree) of (1 + branching_ancestors)
///   changed_functions = names of callable nodes whose body spans any added line
pub fn computeAddedMetrics(
    arena: std.mem.Allocator,
    tree: *const ts.Tree,
    source: []const u8,
    m_cfg: config.MetricsConfig,
    lang_config: *const config.LanguageConfig,
    added: []const LineRange,
    test_markers: []const config.TestMarker,
) !AddedResult {
    const total_lines = countLines(source);
    const masks = try buildMasks(arena, tree, source, m_cfg, test_markers, total_lines);
    defer {
        var m = masks;
        m.comment.deinit();
        m.norm_cont.deinit();
        m.test_.deinit();
    }
    const blank = try buildBlankMask(arena, source, total_lines);
    defer {
        var b = blank;
        b.deinit();
    }

    var nloc: u32 = 0;
    var comment_lines: u32 = 0;
    // Bitset of lines that survived filtering (code lines actually added).
    // Used for changed_functions so comment/blank-only changes don't list a function.
    var surviving = try std.DynamicBitSet.initEmpty(arena, total_lines);
    defer {
        var s = surviving;
        s.deinit();
    }
    for (added) |r| {
        var l = r.start;
        const end = r.start + r.count;
        while (l < end) : (l += 1) {
            const idx: usize = if (l == 0) 0 else @as(usize, l - 1);
            if (idx >= total_lines) continue;
            if (blank.isSet(idx)) continue;
            if (masks.test_.isSet(idx)) continue;
            if (masks.comment.isSet(idx)) {
                comment_lines += 1;
                continue;
            }
            if (masks.norm_cont.isSet(idx)) continue;
            nloc += 1;
            surviving.set(idx);
        }
    }

    const complexity = computeRestrictedComplexity(tree, source, m_cfg.branching_types, added, test_markers);
    const changed_fns = try collectChangedFunctions(arena, tree, source, lang_config, &surviving, test_markers);

    return .{
        .nloc = nloc,
        .comment_lines = comment_lines,
        .complexity = complexity,
        .changed_functions = changed_fns,
    };
}

/// Simpler variant for the base-side: count `nloc_removed` only.
pub fn computeRemovedNloc(
    arena: std.mem.Allocator,
    tree: *const ts.Tree,
    source: []const u8,
    m_cfg: config.MetricsConfig,
    removed: []const LineRange,
    test_markers: []const config.TestMarker,
) !u32 {
    const total_lines = countLines(source);
    const masks = try buildMasks(arena, tree, source, m_cfg, test_markers, total_lines);
    defer {
        var m = masks;
        m.comment.deinit();
        m.norm_cont.deinit();
        m.test_.deinit();
    }
    const blank = try buildBlankMask(arena, source, total_lines);
    defer {
        var b = blank;
        b.deinit();
    }

    var nloc: u32 = 0;
    for (removed) |r| {
        var l = r.start;
        const end = r.start + r.count;
        while (l < end) : (l += 1) {
            const idx: usize = if (l == 0) 0 else @as(usize, l - 1);
            if (idx >= total_lines) continue;
            if (blank.isSet(idx)) continue;
            if (masks.test_.isSet(idx)) continue;
            if (masks.comment.isSet(idx)) continue;
            if (masks.norm_cont.isSet(idx)) continue;
            nloc += 1;
        }
    }
    return nloc;
}

const Masks = struct {
    comment: std.DynamicBitSet,
    norm_cont: std.DynamicBitSet,
    test_: std.DynamicBitSet,
};

fn buildMasks(
    arena: std.mem.Allocator,
    tree: *const ts.Tree,
    source: []const u8,
    m_cfg: config.MetricsConfig,
    test_markers: []const config.TestMarker,
    total_lines: u32,
) !Masks {
    var comment = try std.DynamicBitSet.initEmpty(arena, total_lines);
    var norm_cont = try std.DynamicBitSet.initEmpty(arena, total_lines);
    var test_mask = try std.DynamicBitSet.initEmpty(arena, total_lines);

    var cursor = tree.walk();
    defer cursor.destroy();

    var descend = true;
    while (true) {
        if (descend) {
            const node = cursor.node();
            if (test_filter.isTestNode(node, source, test_markers)) {
                setRange(&test_mask, node.startPoint().row, node.endPoint().row, node.endPoint().column, total_lines);
                descend = false;
            } else if (matchesAnyType(node.kind(), m_cfg.comment_types)) {
                setRange(&comment, node.startPoint().row, node.endPoint().row, node.endPoint().column, total_lines);
                descend = false;
            } else if (matchesAnyType(node.kind(), m_cfg.normalization_types)) {
                // For normalization: mark continuation rows only (startRow+1 .. endRow).
                // If node has a `body` field, stop before body (keep the header span only).
                const start_row = node.startPoint().row;
                var end_row = node.endPoint().row;
                var end_col = node.endPoint().column;
                if (node.childByFieldName("body")) |body| {
                    end_row = body.startPoint().row;
                    end_col = body.startPoint().column;
                }
                if (end_row > start_row) {
                    setRange(&norm_cont, start_row + 1, end_row, end_col, total_lines);
                }
                descend = false;
            }
        }

        if (descend and cursor.gotoFirstChild()) continue;
        descend = true;
        if (cursor.gotoNextSibling()) continue;

        while (true) {
            if (!cursor.gotoParent()) return .{
                .comment = comment,
                .norm_cont = norm_cont,
                .test_ = test_mask,
            };
            if (cursor.gotoNextSibling()) break;
        }
    }
}

/// Mark all lines in [start_row, end_row] inclusive, unless end_col==0
/// (then end_row is not part of the span).
fn setRange(bs: *std.DynamicBitSet, start_row: u32, end_row: u32, end_col: u32, total_lines: u32) void {
    var r = start_row;
    const last = if (end_col == 0 and end_row > start_row) end_row - 1 else end_row;
    while (r <= last) : (r += 1) {
        if (r >= total_lines) break;
        bs.set(r);
    }
}

fn buildBlankMask(arena: std.mem.Allocator, source: []const u8, total_lines: u32) !std.DynamicBitSet {
    var bs = try std.DynamicBitSet.initEmpty(arena, total_lines);
    var idx: u32 = 0;
    var it = std.mem.splitScalar(u8, source, '\n');
    while (it.next()) |line| : (idx += 1) {
        if (idx >= total_lines) break;
        const trimmed = std.mem.trim(u8, line, &std.ascii.whitespace);
        if (trimmed.len == 0) bs.set(idx);
    }
    return bs;
}

fn countLines(source: []const u8) u32 {
    var count: u32 = 1;
    for (source) |c| {
        if (c == '\n') count += 1;
    }
    return count;
}

fn matchesAnyType(kind: []const u8, types: []const []const u8) bool {
    for (types) |t| if (std.mem.eql(u8, kind, t)) return true;
    return false;
}

// ── Complexity, restricted to added-line branch nodes ────────────────

fn computeRestrictedComplexity(
    tree: *const ts.Tree,
    source: []const u8,
    branching_types: []const []const u8,
    added: []const LineRange,
    test_markers: []const config.TestMarker,
) u32 {
    var complexity: u32 = 0;
    var cursor = tree.walk();
    defer cursor.destroy();

    var descend = true;
    while (true) {
        if (descend) {
            const node = cursor.node();
            if (test_filter.isTestNode(node, source, test_markers)) {
                descend = false;
            } else if (matchesAnyType(node.kind(), branching_types)) {
                const line = node.startPoint().row + 1;
                if (lineInRanges(added, line)) {
                    complexity += 1 + countBranchingAncestors(node, branching_types);
                }
            }
        }

        if (descend and cursor.gotoFirstChild()) continue;
        descend = true;
        if (cursor.gotoNextSibling()) continue;

        while (true) {
            if (!cursor.gotoParent()) return complexity;
            if (cursor.gotoNextSibling()) break;
        }
    }
}

fn countBranchingAncestors(node: ts.Node, branching_types: []const []const u8) u32 {
    var count: u32 = 0;
    var current = node;
    while (current.parent()) |p| {
        if (matchesAnyType(p.kind(), branching_types)) count += 1;
        current = p;
    }
    return count;
}

fn lineInRanges(ranges: []const LineRange, line: u32) bool {
    for (ranges) |r| if (r.contains(line)) return true;
    return false;
}

// ── Changed functions ────────────────────────────────────────────────

fn collectChangedFunctions(
    arena: std.mem.Allocator,
    tree: *const ts.Tree,
    source: []const u8,
    lang_config: *const config.LanguageConfig,
    surviving: *const std.DynamicBitSet,
    test_markers: []const config.TestMarker,
) ![]const []const u8 {
    var seen: std.StringHashMapUnmanaged(void) = .empty;
    defer seen.deinit(arena);
    var out: std.ArrayList([]const u8) = .empty;

    var cursor = tree.walk();
    defer cursor.destroy();

    var descend = true;
    while (true) {
        if (descend) {
            const node = cursor.node();
            if (test_filter.isTestNode(node, source, test_markers)) {
                descend = false;
            } else if (matchingCallable(node, lang_config.callables)) |callable| {
                const start_row = node.startPoint().row;
                const end_row = node.endPoint().row;
                if (anyBitSetInRange(surviving, start_row, end_row)) {
                    if (extractCallableName(node, source, callable)) |name| {
                        const gop = try seen.getOrPut(arena, name);
                        if (!gop.found_existing) {
                            try out.append(arena, name);
                        }
                    }
                }
            }
        }

        if (descend and cursor.gotoFirstChild()) continue;
        descend = true;
        if (cursor.gotoNextSibling()) continue;

        while (true) {
            if (!cursor.gotoParent()) return out.toOwnedSlice(arena);
            if (cursor.gotoNextSibling()) break;
        }
    }
}

/// True if any bit in [start_row, end_row] (0-indexed, inclusive) is set.
fn anyBitSetInRange(bs: *const std.DynamicBitSet, start_row: u32, end_row: u32) bool {
    const cap = bs.capacity();
    var r: usize = start_row;
    const last: usize = @min(end_row, if (cap == 0) 0 else cap - 1);
    while (r <= last) : (r += 1) {
        if (bs.isSet(r)) return true;
    }
    return false;
}

fn matchingCallable(node: ts.Node, callables: []const config.CallableMapping) ?config.CallableMapping {
    const kind = node.kind();
    for (callables) |c| {
        if (std.mem.eql(u8, c.ts_type, kind)) return c;
    }
    return null;
}

fn extractCallableName(node: ts.Node, source: []const u8, callable: config.CallableMapping) ?[]const u8 {
    if (callable.name_field) |field| {
        if (node.childByFieldName(field)) |name_node| {
            return source[name_node.startByte()..name_node.endByte()];
        }
    }
    // Fallback: first named identifier child
    var i: u32 = 0;
    while (i < node.namedChildCount()) : (i += 1) {
        const c = node.namedChild(i) orelse continue;
        if (std.mem.eql(u8, c.kind(), "identifier")) {
            return source[c.startByte()..c.endByte()];
        }
    }
    return null;
}

fn rangesOverlap(ranges: []const LineRange, start: u32, end: u32) bool {
    for (ranges) |r| {
        const r_end = r.start + r.count - 1;
        if (r.start > end) continue;
        if (r_end < start) continue;
        return true;
    }
    return false;
}

// ── Tests ────────────────────────────────────────────────────────────

test "parseHunkHeader simple" {
    const h = parseHunkHeader("@@ -10,3 +15,5 @@") orelse return error.TestFailed;
    try std.testing.expectEqual(@as(u32, 10), h.old_start);
    try std.testing.expectEqual(@as(u32, 3), h.old_count);
    try std.testing.expectEqual(@as(u32, 15), h.new_start);
    try std.testing.expectEqual(@as(u32, 5), h.new_count);
}

test "parseHunkHeader default counts" {
    const h = parseHunkHeader("@@ -10 +15 @@") orelse return error.TestFailed;
    try std.testing.expectEqual(@as(u32, 1), h.old_count);
    try std.testing.expectEqual(@as(u32, 1), h.new_count);
}

test "parseHunkHeader zero counts" {
    const h = parseHunkHeader("@@ -10,0 +15,3 @@") orelse return error.TestFailed;
    try std.testing.expectEqual(@as(u32, 0), h.old_count);
    try std.testing.expectEqual(@as(u32, 3), h.new_count);
}

test "parseHunkHeader with trailing context" {
    const h = parseHunkHeader("@@ -1,5 +1,7 @@ fn foo()") orelse return error.TestFailed;
    try std.testing.expectEqual(@as(u32, 1), h.old_start);
    try std.testing.expectEqual(@as(u32, 5), h.old_count);
    try std.testing.expectEqual(@as(u32, 1), h.new_start);
    try std.testing.expectEqual(@as(u32, 7), h.new_count);
}

test "parseHunkHeader invalid" {
    try std.testing.expect(parseHunkHeader("hello") == null);
    try std.testing.expect(parseHunkHeader("@@ broken @@") == null);
}

test "LineRange.contains" {
    const r = LineRange{ .start = 5, .count = 3 };
    try std.testing.expect(r.contains(5));
    try std.testing.expect(r.contains(6));
    try std.testing.expect(r.contains(7));
    try std.testing.expect(!r.contains(4));
    try std.testing.expect(!r.contains(8));
}

test "rangesOverlap" {
    const ranges = [_]LineRange{
        .{ .start = 5, .count = 3 }, // 5-7
        .{ .start = 20, .count = 2 }, // 20-21
    };
    try std.testing.expect(rangesOverlap(&ranges, 6, 6));
    try std.testing.expect(rangesOverlap(&ranges, 1, 10));
    try std.testing.expect(rangesOverlap(&ranges, 7, 20));
    try std.testing.expect(!rangesOverlap(&ranges, 1, 4));
    try std.testing.expect(!rangesOverlap(&ranges, 8, 19));
}
