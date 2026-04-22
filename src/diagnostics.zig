const std = @import("std");

// ── Unified Diagnostics (SPEC.md §6 — tool-internal warnings) ───────
//
// Accumulates warnings and errors during pipeline/rule execution.
// Flushed at a controlled point on stdout (before findings/gaps).
// Best-effort: OOM silently drops the diagnostic entry.

pub const DiagLevel = enum {
    warning,
    @"error",
};

pub const DiagEntry = struct {
    level: DiagLevel,
    source: []const u8, // comptime literal, not duped (e.g. "graph_api", "lua", "rule")
    message: []const u8, // formatted + duped into allocator
};

pub const Diagnostics = struct {
    entries: std.ArrayList(DiagEntry) = .empty,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) Diagnostics {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *Diagnostics) void {
        for (self.entries.items) |entry| {
            self.allocator.free(entry.message);
        }
        self.entries.deinit(self.allocator);
    }

    pub fn hasDiagnostics(self: *const Diagnostics) bool {
        return self.entries.items.len > 0;
    }

    /// Append a warning. Best-effort — never returns an error.
    pub fn warn(self: *Diagnostics, source: []const u8, comptime fmt: []const u8, args: anytype) void {
        self.add(.warning, source, fmt, args);
    }

    /// Append an error. Best-effort — never returns an error.
    pub fn err(self: *Diagnostics, source: []const u8, comptime fmt: []const u8, args: anytype) void {
        self.add(.@"error", source, fmt, args);
    }

    fn add(self: *Diagnostics, level: DiagLevel, source: []const u8, comptime fmt: []const u8, args: anytype) void {
        var buf: [1024]u8 = undefined;
        const message = std.fmt.bufPrint(&buf, fmt, args) catch "(message too long)";
        const duped = self.allocator.dupe(u8, message) catch return;
        self.entries.append(self.allocator, .{
            .level = level,
            .source = source,
            .message = duped,
        }) catch {
            self.allocator.free(duped);
        };
    }
};

// ── Tests ────────────────────────────────────────────────────────────

test "warn and err append entries" {
    var diag = Diagnostics.init(std.testing.allocator);
    defer diag.deinit();

    diag.warn("graph_api", "unknown kind '{s}'", .{"contract"});
    diag.err("lua", "check() failed", .{});

    try std.testing.expect(diag.hasDiagnostics());
    try std.testing.expectEqual(@as(usize, 2), diag.entries.items.len);

    try std.testing.expectEqual(DiagLevel.warning, diag.entries.items[0].level);
    try std.testing.expectEqualStrings("graph_api", diag.entries.items[0].source);
    try std.testing.expectEqualStrings("unknown kind 'contract'", diag.entries.items[0].message);

    try std.testing.expectEqual(DiagLevel.@"error", diag.entries.items[1].level);
    try std.testing.expectEqualStrings("lua", diag.entries.items[1].source);
    try std.testing.expectEqualStrings("check() failed", diag.entries.items[1].message);
}

test "empty diagnostics reports false" {
    var diag = Diagnostics.init(std.testing.allocator);
    defer diag.deinit();

    try std.testing.expect(!diag.hasDiagnostics());
}
