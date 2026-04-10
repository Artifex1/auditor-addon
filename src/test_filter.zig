const std = @import("std");
const ts = @import("tree-sitter");
const config = @import("languages/config.zig");
const metrics = @import("metrics.zig");

// ── Test Node Detection ──────────────────────────────────────────────
//
// Shared predicate used by metrics, peek, and pipeline walkers to skip
// test-annotated subtrees when --no-tests is active.

/// Check whether a tree-sitter node is a test declaration according to
/// the language's test markers. Each walker calls this inline during its
/// DFS and sets descend=false on match to skip the entire subtree.
pub fn isTestNode(
    node: ts.Node,
    source: []const u8,
    markers: []const config.TestMarker,
) bool {
    if (markers.len == 0) return false;

    const kind = node.kind();
    for (markers) |marker| {
        if (!std.mem.eql(u8, kind, marker.node_type)) continue;

        switch (marker.detection) {
            .prev_sibling => |ps| {
                if (checkPrevSibling(node, source, ps.sibling_type, ps.match_text))
                    return true;
            },
            .child_annotation => |ca| {
                if (checkChildAnnotation(node, source, ca.parent_field, ca.child_type, ca.match_text))
                    return true;
            },
            .name_prefix => |np| {
                if (checkNamePrefix(node, source, np.name_field, np.prefix))
                    return true;
            },
            .call_wrapper => |cw| {
                if (checkCallWrapper(node, source, cw.callee_field, cw.callee_names))
                    return true;
            },
        }
    }
    return false;
}

/// Walk previous named siblings looking for one of `sibling_type` whose
/// text contains `match_text`.
/// Covers: #[test], #[cfg(test)] in Rust/Cairo/Move/Noir.
fn checkPrevSibling(
    node: ts.Node,
    source: []const u8,
    sibling_type: []const u8,
    match_text: []const u8,
) bool {
    var maybe_sib = node.prevNamedSibling();
    while (maybe_sib) |sib| {
        if (std.mem.eql(u8, sib.kind(), sibling_type)) {
            const text = source[sib.startByte()..sib.endByte()];
            if (std.mem.indexOf(u8, text, match_text) != null)
                return true;
        }
        maybe_sib = sib.prevNamedSibling();
    }
    return false;
}

/// Get child field `parent_field`, then iterate its children for one of
/// `child_type` whose text contains `match_text`.
/// Covers: Java @Test (method_declaration > modifiers > marker_annotation).
fn checkChildAnnotation(
    node: ts.Node,
    source: []const u8,
    parent_field: []const u8,
    child_type: []const u8,
    match_text: []const u8,
) bool {
    const parent = node.childByFieldName(parent_field) orelse return false;
    var i: u32 = 0;
    while (i < parent.childCount()) : (i += 1) {
        const child = parent.child(i) orelse continue;
        if (std.mem.eql(u8, child.kind(), child_type)) {
            const text = source[child.startByte()..child.endByte()];
            if (std.mem.indexOf(u8, text, match_text) != null)
                return true;
        }
    }
    return false;
}

/// Get the node's `name_field` child and check if its text starts with `prefix`.
/// Covers: Solidity test*, Go Test*, Python test_/Test.
fn checkNamePrefix(
    node: ts.Node,
    source: []const u8,
    name_field: []const u8,
    prefix: []const u8,
) bool {
    const name_node = node.childByFieldName(name_field) orelse return false;
    const text = source[name_node.startByte()..name_node.endByte()];
    return std.mem.startsWith(u8, text, prefix);
}

/// Get the node's `callee_field` child and check if its text matches
/// any of `callee_names`.
/// Covers: JS/TS/TSX/Flow describe(), it(), test().
fn checkCallWrapper(
    node: ts.Node,
    source: []const u8,
    callee_field: []const u8,
    callee_names: []const []const u8,
) bool {
    const callee = node.childByFieldName(callee_field) orelse return false;
    const text = source[callee.startByte()..callee.endByte()];
    for (callee_names) |name| {
        if (std.mem.eql(u8, text, name)) return true;
    }
    return false;
}

// ── Test Overhead for Metrics ────────────────────────────────────────
//
// countLines/countBlankLines scan raw text, not tree nodes. When
// --no-tests is active, we compute how many total/blank lines fall
// inside test subtrees so metrics.zig can subtract them.

pub const TestOverhead = struct {
    lines: u32,
    blank_lines: u32,
};

/// Walk the tree, find test subtrees, sum their total and blank line counts.
pub fn countTestOverhead(
    tree: *const ts.Tree,
    source: []const u8,
    markers: []const config.TestMarker,
) TestOverhead {
    if (markers.len == 0) return .{ .lines = 0, .blank_lines = 0 };

    var result = TestOverhead{ .lines = 0, .blank_lines = 0 };
    var cursor = tree.walk();
    defer cursor.destroy();

    var descend = true;
    while (true) {
        if (descend) {
            const node = cursor.node();
            if (isTestNode(node, source, markers)) {
                result.lines += node.endPoint().row - node.startPoint().row + 1;
                result.blank_lines += metrics.countBlankLines(
                    source[node.startByte()..node.endByte()],
                );
                descend = false;
            }
        }

        if (descend and cursor.gotoFirstChild()) continue;
        descend = true;
        if (cursor.gotoNextSibling()) continue;

        while (true) {
            if (!cursor.gotoParent()) return result;
            if (cursor.gotoNextSibling()) break;
        }
    }
}
