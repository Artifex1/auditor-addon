const std = @import("std");
const ts = @import("tree-sitter");
const config = @import("languages/config.zig");
const test_filter = @import("test_filter.zig");

// ── SPEC-CLI.md §2 — Metrics ──────────────────────────────────────────
//
// All counting is tree-sitter node driven. No line-by-line text scanning
// (except blank lines).

pub const FileMetrics = struct {
    total_lines: u32,
    blank_lines: u32,
    comment_lines: u32,
    normalization: u32,
    nloc: u32,
    cognitive_complexity: u32,
    complexity_per_100: u32, // (complexity * 100) / nLOC
    comment_density: u32, // (comment_lines * 100) / nLOC
    estimated_hours: f32,
};

/// Compute metrics for a single file using its tree-sitter parse tree.
/// Per SPEC-CLI §2.1-§2.4: all counting is tree-sitter node driven.
/// When `test_markers` is non-empty, test-annotated subtrees are excluded.
pub fn computeMetrics(tree: *const ts.Tree, source: []const u8, metrics_config: config.MetricsConfig, test_markers: []const config.TestMarker) FileMetrics {
    // §2.1 — total_lines and blank_lines, minus test overhead
    var total_lines = countLines(source);
    var blank_lines = countBlankLines(source);

    if (test_markers.len > 0) {
        const overhead = test_filter.countTestOverhead(tree, source, test_markers);
        total_lines -|= overhead.lines;
        blank_lines -|= overhead.blank_lines;
    }

    // §2.1 — comment_lines: sum of (count \n in node.text() + 1) for each comment node
    const comment_lines = countNodeLines(tree, source, metrics_config.comment_types, test_markers);

    // §2.1 — normalization: sum of (count \n in node.text()) for each normalizable node
    const normalization = countNormalization(tree, source, metrics_config.normalization_types, test_markers);

    // §2.1 — nLOC
    const nloc_raw = @as(i64, total_lines) - @as(i64, blank_lines) - @as(i64, comment_lines) - @as(i64, normalization);
    const nloc: u32 = if (nloc_raw > 0) @intCast(nloc_raw) else 1; // floor at 1

    // §2.2 — Cognitive Complexity
    const cognitive_complexity = computeCognitiveComplexity(tree, source, metrics_config.branching_types, test_markers);

    // complexity per 100 lines (integer math, multiply first)
    const complexity_per_100 = (cognitive_complexity * 100) / nloc;

    // §2.3 — Comment Density
    const comment_density = (comment_lines * 100) / nloc;

    // §2.4 — Effort Estimation: hours = nloc / base_rate * 6
    const hours: f32 = @as(f32, @floatFromInt(nloc)) / @as(f32, @floatFromInt(metrics_config.base_rate_per_day)) * 6.0;

    return .{
        .total_lines = total_lines,
        .blank_lines = blank_lines,
        .comment_lines = comment_lines,
        .normalization = normalization,
        .nloc = nloc,
        .cognitive_complexity = cognitive_complexity,
        .complexity_per_100 = complexity_per_100,
        .comment_density = comment_density,
        .estimated_hours = hours,
    };
}

/// Count total lines: count of \n in source + 1
fn countLines(source: []const u8) u32 {
    var count: u32 = 1;
    for (source) |c| {
        if (c == '\n') count += 1;
    }
    return count;
}

/// Count blank lines: lines where trim() == ""
pub fn countBlankLines(source: []const u8) u32 {
    var count: u32 = 0;
    var lines = std.mem.splitScalar(u8, source, '\n');
    while (lines.next()) |line| {
        const trimmed = std.mem.trim(u8, line, &std.ascii.whitespace);
        if (trimmed.len == 0) count += 1;
    }
    return count;
}

/// Count lines spanned by nodes of given types.
/// Uses row-point diff so grammars that include a trailing newline in the
/// node span (e.g. tree-sitter-rust `line_comment`) don't double-count.
fn countNodeLines(tree: *const ts.Tree, source: []const u8, node_types: []const []const u8, test_markers: []const config.TestMarker) u32 {
    var total: u32 = 0;
    var cursor = tree.walk();
    defer cursor.destroy();

    // Depth-first walk of entire tree
    var descend = true;
    while (true) {
        if (descend) {
            const node = cursor.node();
            if (test_filter.isTestNode(node, source, test_markers)) {
                descend = false;
            } else if (matchesAnyType(node.kind(), node_types)) {
                total += nodeRowSpan(node);
                // Don't descend into matched nodes (avoid double-counting nested comments)
                descend = false;
            }
        }

        if (descend and cursor.gotoFirstChild()) continue;
        descend = true;
        if (cursor.gotoNextSibling()) continue;

        // Walk back up
        while (true) {
            if (!cursor.gotoParent()) return total;
            if (cursor.gotoNextSibling()) break;
        }
    }
}

/// Count normalization: for each matching node, count(\n in text).
/// A 4-line function sig contributes 3 (4 lines → 1 normalized, subtract 3).
/// For nodes with a "body" field (function definitions), only count the header
/// portion (start of node to start of body) to avoid subtracting the entire
/// function body. For other nodes (call_expression, array, etc.), count the
/// whole node text.
/// Skips children of matched nodes to avoid double-counting nested structures.
fn countNormalization(tree: *const ts.Tree, source: []const u8, node_types: []const []const u8, test_markers: []const config.TestMarker) u32 {
    var total: u32 = 0;
    var cursor = tree.walk();
    defer cursor.destroy();

    var descend = true;
    while (true) {
        if (descend) {
            const node = cursor.node();
            if (test_filter.isTestNode(node, source, test_markers)) {
                descend = false;
            } else if (matchesAnyType(node.kind(), node_types)) {
                const start = node.startByte();
                // If the node has a body field, only count the header (up to body start)
                const end = if (node.childByFieldName("body")) |body|
                    body.startByte()
                else
                    node.endByte();
                if (end > start) {
                    total += countNewlines(source[start..end]);
                }
                descend = false; // skip children of matched node
            }
        }

        if (descend and cursor.gotoFirstChild()) continue;
        descend = true;
        if (cursor.gotoNextSibling()) continue;

        while (true) {
            if (!cursor.gotoParent()) return total;
            if (cursor.gotoNextSibling()) break;
        }
    }
}

/// §2.2 — Cognitive Complexity: each branch node contributes 1 + nesting_depth.
/// Nesting = count of ancestor nodes that are also branch nodes.
fn computeCognitiveComplexity(tree: *const ts.Tree, source: []const u8, branching_types: []const []const u8, test_markers: []const config.TestMarker) u32 {
    var complexity: u32 = 0;
    var cursor = tree.walk();
    defer cursor.destroy();

    // Track nesting depth of branching nodes via cursor depth tracking.
    // We maintain a stack of whether each depth level is a branching node.
    var descend = true;

    while (true) {
        if (descend) {
            const node = cursor.node();
            if (test_filter.isTestNode(node, source, test_markers)) {
                descend = false;
            } else if (matchesAnyType(node.kind(), branching_types)) {
                const nesting = countBranchingAncestors(node, branching_types);
                complexity += 1 + nesting;
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

/// Count how many ancestors of a node are branching nodes.
fn countBranchingAncestors(node: ts.Node, branching_types: []const []const u8) u32 {
    var count: u32 = 0;
    var current = node;
    while (current.parent()) |p| {
        if (matchesAnyType(p.kind(), branching_types)) {
            count += 1;
        }
        current = p;
    }
    return count;
}

fn matchesAnyType(kind: []const u8, types: []const []const u8) bool {
    for (types) |t| {
        if (std.mem.eql(u8, kind, t)) return true;
    }
    return false;
}

fn countNewlines(text: []const u8) u32 {
    var count: u32 = 0;
    for (text) |c| {
        if (c == '\n') count += 1;
    }
    return count;
}

/// Number of source lines spanned by `node`, computed from its row points.
/// If the node ends at column 0 of some row (i.e. its span includes a
/// trailing newline, as tree-sitter-rust line_comment does), the final row
/// is not counted. Otherwise the final row counts.
fn nodeRowSpan(node: ts.Node) u32 {
    const sp = node.startPoint();
    const ep = node.endPoint();
    if (ep.row <= sp.row) return 1;
    const diff: u32 = @intCast(ep.row - sp.row);
    return if (ep.column == 0) diff else diff + 1;
}

// ── Tests ──────────────────────────────────────────────────────────────

test "countLines" {
    try std.testing.expectEqual(@as(u32, 1), countLines("hello"));
    try std.testing.expectEqual(@as(u32, 3), countLines("a\nb\nc"));
    try std.testing.expectEqual(@as(u32, 4), countLines("a\nb\nc\n"));
}

test "countBlankLines" {
    try std.testing.expectEqual(@as(u32, 0), countBlankLines("hello"));
    try std.testing.expectEqual(@as(u32, 1), countBlankLines("a\n\nb"));
    try std.testing.expectEqual(@as(u32, 2), countBlankLines("a\n\n\nb"));
    try std.testing.expectEqual(@as(u32, 1), countBlankLines("a\n  \nb"));
}

test "matchesAnyType" {
    const types = &[_][]const u8{ "if_statement", "for_statement" };
    try std.testing.expect(matchesAnyType("if_statement", types));
    try std.testing.expect(!matchesAnyType("while_statement", types));
}
