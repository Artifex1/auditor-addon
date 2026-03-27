const std = @import("std");
const ts = @import("tree-sitter");
const cfg = @import("languages/config.zig");

// ── SPEC-CLI.md §1 — Peek ─────────────────────────────────────────────
//
// Extract function signatures from source files. Parse each file with
// tree-sitter, find function/callable declarations, extract the text from
// the declaration start up to (but not including) the opening brace.
// Collapse multi-line signatures into a single line, normalize spacing.

pub const Signature = struct {
    file: []const u8,
    text: []const u8,
};

/// Extract all callable signatures from a parsed file.
/// Uses CallableMapping from the language config to find function nodes.
pub fn extractSignatures(
    tree: *const ts.Tree,
    source: []const u8,
    lang_config: *const cfg.LanguageConfig,
    file_path: []const u8,
    allocator: std.mem.Allocator,
) ![]Signature {
    var signatures: std.ArrayList(Signature) = .empty;

    var cursor = tree.walk();
    defer cursor.destroy();

    // Walk the entire tree looking for callable nodes
    var descend = true;
    while (true) {
        if (descend) {
            const node = cursor.node();
            const kind = node.kind();

            for (lang_config.callables) |callable| {
                if (std.mem.eql(u8, kind, callable.ts_type)) {
                    if (extractSignatureText(node, source, callable.body_field, allocator)) |sig_text| {
                        try signatures.append(allocator, .{
                            .file = file_path,
                            .text = sig_text,
                        });
                    } else |_| {}
                    break;
                }
            }
        }

        if (descend and cursor.gotoFirstChild()) continue;
        descend = true;
        if (cursor.gotoNextSibling()) continue;

        while (true) {
            if (!cursor.gotoParent()) return signatures.toOwnedSlice(allocator);
            if (cursor.gotoNextSibling()) break;
        }
    }
}

/// Extract signature text from a callable node: from declaration start
/// up to (but not including) the opening brace (body).
/// Then collapse whitespace into a single line.
fn extractSignatureText(
    node: ts.Node,
    source: []const u8,
    body_field: ?[]const u8,
    allocator: std.mem.Allocator,
) ![]const u8 {
    const start = node.startByte();
    var end = node.endByte();

    // If there's a body, stop before it
    if (body_field) |field| {
        if (node.childByFieldName(field)) |body| {
            end = body.startByte();
        }
    }

    if (start >= end or start >= source.len) return error.InvalidRange;

    const clamped_end = @min(end, @as(u32, @intCast(source.len)));
    const raw = source[start..clamped_end];

    // Collapse multi-line into single line, normalize whitespace
    return collapseWhitespace(raw, allocator);
}

/// Collapse multi-line text into single line:
/// - Replace all whitespace sequences (including newlines) with a single space
/// - Trim leading/trailing whitespace
fn collapseWhitespace(text: []const u8, allocator: std.mem.Allocator) ![]const u8 {
    var result: std.ArrayList(u8) = .empty;
    var in_whitespace = false;

    for (text) |c| {
        if (std.ascii.isWhitespace(c)) {
            if (!in_whitespace and result.items.len > 0) {
                try result.append(allocator, ' ');
            }
            in_whitespace = true;
        } else {
            in_whitespace = false;
            try result.append(allocator, c);
        }
    }

    // Trim trailing space
    if (result.items.len > 0 and result.items[result.items.len - 1] == ' ') {
        result.items.len -= 1;
    }

    return result.toOwnedSlice(allocator);
}

// ── Tests ──────────────────────────────────────────────────────────────

test "collapseWhitespace" {
    const ally = std.testing.allocator;

    const r1 = try collapseWhitespace("function  withdraw(\n    uint256 amount\n) external", ally);
    defer ally.free(r1);
    try std.testing.expectEqualStrings("function withdraw( uint256 amount ) external", r1);

    const r2 = try collapseWhitespace("  hello   world  ", ally);
    defer ally.free(r2);
    try std.testing.expectEqualStrings("hello world", r2);

    const r3 = try collapseWhitespace("no_change", ally);
    defer ally.free(r3);
    try std.testing.expectEqualStrings("no_change", r3);
}
