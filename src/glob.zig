const std = @import("std");

// ── Glob Pattern Matching & Expansion ─────────────────────────────────
//
// Supports:
//   *      — matches any characters within a single path segment
//   **     — matches zero or more path segments
//   ?      — matches exactly one character (not separator)
//   [abc]  — character class (not implemented — future extension)
//
// Examples:
//   "src/**/*.sol"   — all .sol files under src/
//   "*.sol"          — .sol files in current directory
//   "src/Vault.sol"  — literal file path (no wildcards)

/// Check if a path matches a glob pattern.
pub fn match(pattern: []const u8, path: []const u8) bool {
    return matchImpl(pattern, path);
}

fn matchImpl(pattern: []const u8, path: []const u8) bool {
    var pi: usize = 0; // pattern index
    var si: usize = 0; // string (path) index

    // For backtracking on '*'
    var star_pi: ?usize = null;
    var star_si: usize = 0;

    while (si < path.len or pi < pattern.len) {
        if (pi < pattern.len) {
            // Check for '**/' or '**' at end of pattern
            if (pi + 1 < pattern.len and pattern[pi] == '*' and pattern[pi + 1] == '*') {
                // '**' — matches zero or more path segments
                return matchDoubleStar(pattern, pi, path, si);
            }

            if (pattern[pi] == '*') {
                // '*' — matches anything except '/'
                star_pi = pi;
                star_si = si;
                pi += 1;
                continue;
            }

            if (si < path.len) {
                if (pattern[pi] == '?') {
                    if (path[si] != '/') {
                        pi += 1;
                        si += 1;
                        continue;
                    }
                } else if (pattern[pi] == path[si]) {
                    pi += 1;
                    si += 1;
                    continue;
                }
            }
        }

        // Mismatch — try backtracking to last '*'
        if (star_pi) |spi| {
            pi = spi + 1;
            star_si += 1;
            si = star_si;
            if (si <= path.len and (si == path.len or path[si - 1] != '/')) {
                continue;
            }
            // '*' can't cross '/' — fail
            if (si > 0 and si <= path.len and path[si - 1] == '/') {
                return false;
            }
        }

        return false;
    }

    return true;
}

/// Handle '**' patterns which match across path segments.
fn matchDoubleStar(pattern: []const u8, pi: usize, path: []const u8, si: usize) bool {
    // Skip the '**'
    var new_pi = pi + 2;

    // Skip trailing '/' after '**'
    if (new_pi < pattern.len and pattern[new_pi] == '/') {
        new_pi += 1;
    }

    // If '**' is at end of pattern, it matches everything remaining
    if (new_pi >= pattern.len) return true;

    // Try matching remaining pattern at every position in the path
    var s = si;
    while (s <= path.len) {
        if (matchImpl(pattern[new_pi..], path[s..])) return true;
        if (s < path.len) {
            s += 1;
        } else {
            break;
        }
    }

    return false;
}

/// Check if a pattern contains glob wildcards.
pub fn isGlob(pattern: []const u8) bool {
    for (pattern) |c| {
        if (c == '*' or c == '?' or c == '[') return true;
    }
    return false;
}

/// Expand a glob pattern to a list of matching file paths.
/// If the pattern has no wildcards, returns it as-is (if it exists).
pub fn expand(pattern: []const u8, allocator: std.mem.Allocator) ![]const []const u8 {
    if (!isGlob(pattern)) {
        // Literal path — check existence and return
        std.fs.cwd().access(pattern, .{}) catch return &.{};
        const duped = try allocator.dupe(u8, pattern);
        const result = try allocator.alloc([]const u8, 1);
        result[0] = duped;
        return result;
    }

    // Find the base directory (everything before the first wildcard segment)
    const base_dir = extractBaseDir(pattern);
    const glob_suffix = if (base_dir.len > 0 and base_dir.len < pattern.len)
        pattern[base_dir.len + 1 ..] // skip the '/'
    else if (base_dir.len == 0)
        pattern
    else
        "";

    var results: std.ArrayList([]const u8) = .empty;

    // Open base directory and walk recursively
    const dir = if (base_dir.len > 0)
        std.fs.cwd().openDir(base_dir, .{ .iterate = true }) catch return results.toOwnedSlice(allocator)
    else
        std.fs.cwd().openDir(".", .{ .iterate = true }) catch return results.toOwnedSlice(allocator);

    var walker = try dir.walk(allocator);
    defer walker.deinit();

    while (try walker.next()) |entry| {
        if (entry.kind != .file) continue;

        // Match against the glob suffix
        if (match(glob_suffix, entry.path)) {
            // Build full path: base_dir + "/" + relative
            const full_path = if (base_dir.len > 0)
                try std.fmt.allocPrint(allocator, "{s}/{s}", .{ base_dir, entry.path })
            else
                try allocator.dupe(u8, entry.path);

            try results.append(allocator, full_path);
        }
    }

    return results.toOwnedSlice(allocator);
}

/// Extract the base directory from a glob pattern.
/// "src/**/*.sol" → "src"
/// "**/*.sol" → ""
/// "src/contracts/*.sol" → "src/contracts"
fn extractBaseDir(pattern: []const u8) []const u8 {
    var last_slash: usize = 0;
    var found_slash = false;

    for (pattern, 0..) |c, i| {
        if (c == '*' or c == '?' or c == '[') {
            return if (found_slash) pattern[0..last_slash] else "";
        }
        if (c == '/') {
            last_slash = i;
            found_slash = true;
        }
    }

    // No wildcards found — return entire pattern
    return pattern;
}

/// Expand multiple patterns and deduplicate results.
pub fn expandAll(patterns: []const []const u8, allocator: std.mem.Allocator) ![]const []const u8 {
    var all: std.ArrayList([]const u8) = .empty;
    var seen: std.StringHashMapUnmanaged(void) = .empty;
    defer seen.deinit(allocator);

    for (patterns) |pattern| {
        const expanded = try expand(pattern, allocator);
        defer allocator.free(expanded);

        for (expanded) |path| {
            const gop = try seen.getOrPut(allocator, path);
            if (!gop.found_existing) {
                try all.append(allocator, path);
            }
        }
    }

    return all.toOwnedSlice(allocator);
}

// ── Tests ──────────────────────────────────────────────────────────────

test "match: literal path" {
    try std.testing.expect(match("src/Vault.sol", "src/Vault.sol"));
    try std.testing.expect(!match("src/Vault.sol", "src/Other.sol"));
}

test "match: single star" {
    try std.testing.expect(match("*.sol", "Vault.sol"));
    try std.testing.expect(match("*.sol", "Ownable.sol"));
    try std.testing.expect(!match("*.sol", "src/Vault.sol")); // * doesn't cross /
    try std.testing.expect(!match("*.sol", "Vault.rs"));
}

test "match: question mark" {
    try std.testing.expect(match("?.sol", "A.sol"));
    try std.testing.expect(!match("?.sol", "AB.sol"));
    try std.testing.expect(!match("?.sol", ".sol"));
}

test "match: double star" {
    try std.testing.expect(match("**/*.sol", "Vault.sol"));
    try std.testing.expect(match("**/*.sol", "src/Vault.sol"));
    try std.testing.expect(match("**/*.sol", "src/contracts/Vault.sol"));
    try std.testing.expect(!match("**/*.sol", "Vault.rs"));
}

test "match: double star in middle" {
    try std.testing.expect(match("src/**/*.sol", "src/Vault.sol"));
    try std.testing.expect(match("src/**/*.sol", "src/a/b/Vault.sol"));
    try std.testing.expect(!match("src/**/*.sol", "lib/Vault.sol"));
}

test "match: double star at end" {
    try std.testing.expect(match("src/**", "src/Vault.sol"));
    try std.testing.expect(match("src/**", "src/a/b/c"));
}

test "isGlob" {
    try std.testing.expect(isGlob("*.sol"));
    try std.testing.expect(isGlob("src/**/*.sol"));
    try std.testing.expect(!isGlob("src/Vault.sol"));
    try std.testing.expect(!isGlob("plain_file"));
}

test "extractBaseDir" {
    try std.testing.expectEqualStrings("src", extractBaseDir("src/**/*.sol"));
    try std.testing.expectEqualStrings("", extractBaseDir("**/*.sol"));
    try std.testing.expectEqualStrings("", extractBaseDir("*.sol"));
    try std.testing.expectEqualStrings("src/contracts", extractBaseDir("src/contracts/*.sol"));
}
