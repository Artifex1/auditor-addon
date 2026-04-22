const ts = @import("tree-sitter");
const cfg = @import("config.zig");
const graph = @import("../graph.zig");

pub const config = cfg.LanguageConfig{
    .language = .solidity,

    .containers = &.{
        .{ .ts_type = "contract_declaration", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "interface_declaration", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "library_declaration", .name_field = "name", .body_field = "body" },
    },

    .callables = &.{
        .{ .ts_type = "function_definition", .name_field = "name", .body_field = "body", .properties = &.{
            .{ .key = "visibility", .child_type = "visibility" },
            .{ .key = "mutability", .child_type = "state_mutability" },
            .{ .key = "override", .child_type = "override_specifier" },
            .{ .key = "virtual", .child_type = "virtual" },
        } },
        .{ .ts_type = "modifier_definition", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "constructor_definition", .name_field = null, .body_field = "body" },
        .{ .ts_type = "fallback_receive_definition", .name_field = null, .body_field = "body" },
    },

    .call_expression = .{ .ts_type = "call_expression", .function_field = "function" },
    .inheritance = .{ .ts_type = "inheritance_specifier", .name_field = "ancestor" },

    .imports = .{ .ts_type = "import_directive", .path_field = "source" },

    .inheritance_strategy = .c3_linearization,

    .builtin_functions = &.{ "require", "assert", "revert", "keccak256", "ecrecover", "addmod", "mulmod", "blockhash" },
    .builtin_receivers = &.{ "abi", "block", "msg", "tx", "type" },

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "member_expression", .child_field = "object" },
        .{ .context = .receiver, .ts_type = "array_access", .child_field = "base" },
        .{ .context = .receiver, .ts_type = "slice_access", .child_field = "base" },
        .{ .context = .receiver, .ts_type = "parenthesized_expression", .child_field = "expression" },
        .{ .context = .receiver, .ts_type = "type_cast_expression", .child_field = "expression" },
        .{ .context = .receiver, .ts_type = "expression" }, // transparent wrapper
        .{ .context = .callee, .ts_type = "member_expression", .child_field = "property" },
        .{ .context = .callee, .ts_type = "struct_expression", .child_field = "type" }, // addr.call{value: x} → addr.call
        .{ .context = .callee, .ts_type = "expression" }, // transparent wrapper
    },
    .identifier_type = "identifier",

    .walk_hook = &solidityWalkHook,
    .resolve_hook = &solidityResolveHook,
    .pre_enter_hook = &solidityPreEnterHook,
    .post_enter_hook = &solidityPostEnterHook,

    .metrics = .{
        .branching_types = &.{
            "if_statement",
            "for_statement",
            "while_statement",
            "do_while_statement",
            "catch_clause",
        },
        .comment_types = &.{ "comment", "block_comment" },
        .normalization_types = &.{ "function_definition", "call_expression" },
        .base_rate_per_day = 150,
    },

    .test_markers = &.{
        .{ .node_type = "function_definition", .detection = .{ .name_prefix = .{
            .name_field = "name",
            .prefix = "test",
        } } },
    },
};

/// Solidity-specific walk hook — handles AST nodes the declarative config can't express.
fn solidityWalkHook(ctx: cfg.WalkContext) anyerror!void {
    const kind = ctx.node.kind();
    if (std.mem.eql(u8, kind, "using_directive")) {
        try handleUsingDirective(ctx);
    } else if (std.mem.eql(u8, kind, "yul_function_call")) {
        // TODO: emit .call ref for user-defined yul functions
    }
}

/// Parse a `using_directive` node and emit .using_for refs to library containers.
///
/// Form 1 — `using SafeMath for uint256`:
///   One child of kind "type_alias" holds the library name.
///
/// Form 2 — `using {SafeMath.add, StringLib.concat} for uint256`:
///   Multiple `using_alias` children each hold a qualified name (e.g. "SafeMath.add").
///   Library name = everything before the last dot. De-duplicated.
fn handleUsingDirective(ctx: cfg.WalkContext) !void {
    var added: std.StringHashMapUnmanaged(void) = .empty;
    defer added.deinit(ctx.allocator);

    var i: u32 = 0;
    while (i < ctx.node.childCount()) : (i += 1) {
        const child = ctx.node.child(i) orelse continue;
        const child_kind = child.kind();

        if (std.mem.eql(u8, child_kind, "type_alias")) {
            // Form 1: whole library attached
            const text = ctx.source[child.startByte()..child.endByte()];
            const lib_name = try ctx.graph.dupeString(text);
            if (!added.contains(lib_name)) {
                try added.put(ctx.allocator, lib_name, {});
                try ctx.emitRef(lib_name, .using_for);
            }
        } else if (std.mem.eql(u8, child_kind, "using_alias")) {
            // Form 2: explicit function list — extract library from "SafeMath.add"
            const text = ctx.source[child.startByte()..child.endByte()];
            const lib_name = if (std.mem.lastIndexOfScalar(u8, text, '.')) |dot|
                try ctx.graph.dupeString(text[0..dot])
            else
                try ctx.graph.dupeString(text);

            if (!added.contains(lib_name)) {
                try added.put(ctx.allocator, lib_name, {});
                try ctx.emitRef(lib_name, .using_for);
            }
        }
    }
}

const external_call_methods = [_][]const u8{ "call", "send", "transfer", "delegatecall", "staticcall" };

/// Solidity resolve hook — runs before default resolution for each .call ref.
///
/// 1. External low-level calls (.call, .send, .transfer, .delegatecall, .staticcall)
///    → mark as external with low-priority gap.
/// 2. Struct/enum/error constructors → mark as internal via existsInScope, no gap.
/// 3. Super-qualified calls (super.foo()) → resolve in parent containers only,
///    skipping the current contract to avoid resolving to the local override.
/// 4. Using-for library calls (receiver.method()) → resolve method in any library
///    attached to the contract via using-for. gap = .low (type not verified).
fn solidityResolveHook(ref: *graph.Reference, g: *const graph.SymbolGraph, lang_config: *const cfg.LanguageConfig, allocator: std.mem.Allocator) void {
    if (ref.kind != .call) return;

    // 1. External low-level calls
    for (&external_call_methods) |ecm| {
        if (std.mem.eql(u8, ref.target_name, ecm)) {
            ref.target_kind = .external;
            ref.markGap(allocator, .low);
            return;
        }
    }

    // 2. Struct/enum/error constructor — type lives in scope, not a callgraph edge.
    //    Covers `Foo(...)`, `Status.Open`, and `revert MyError(...)` patterns.
    if (g.containerOf(ref.from)) |cid| {
        if (g.existsInScope(cid, ref.target_name, "struct_declaration") or
            g.existsInScope(cid, ref.target_name, "enum_declaration") or
            g.existsInScope(cid, ref.target_name, "error_declaration"))
        {
            ref.target_kind = .internal;
            ref.markClassified(allocator);
            return;
        }
    }

    // 3 & 4: Both require extracting the receiver from a member expression.
    const ast_node = ref.ast_node orelse return;
    const source = g.sourceForFile(ref.site.file) orelse return;
    const callee_node = ast_node.childByFieldName(lang_config.call_expression.function_field) orelse return;
    const receiver = cfg.unwrap(callee_node, source, lang_config, .receiver) orelse return;
    const container_id = g.containerOf(ref.from) orelse return;

    if (std.mem.eql(u8, receiver, "super")) {
        // 3. Super-qualified call: resolve in parents only (skip own override)
        if (g.resolveInParentsOnly(container_id, ref.target_name, .callable)) |result| {
            ref.addTarget(allocator, result.node.id) catch return;
            ref.target_kind = .internal;
            if (result.ambiguous) ref.markAmbiguous();
        } else {
            ref.markGap(allocator, .medium);
        }
        return;
    }

    // 4. Using-for: check if any library attached to this contract has the method.
    //    Skip builtin receivers (msg, block, etc.) — those aren't library calls.
    for (lang_config.builtin_receivers) |b| {
        if (std.mem.eql(u8, receiver, b)) return;
    }

    const lib_ids = g.getUsingForLibraries(container_id, allocator) catch return;
    defer allocator.free(lib_ids);
    if (lib_ids.len == 0) return;

    var found = false;
    for (lib_ids) |lib_id| {
        if (g.resolveInScope(lib_id, ref.target_name, .callable)) |result| {
            ref.addTarget(allocator, result.node.id) catch return;
            ref.target_kind = .cross_module;
            found = true;
        }
    }
    if (found) {
        // Provisionally resolved; receiver type not verified → low-confidence.
        ref.markAmbiguous();
    }
    // else: fall through — default resolution handles it (medium gap)
}

// ── Deep-walker hooks: auxiliary scopes around a callable body ─────────
//
// Solidity function modifiers wrap the body: `function f() onlyOwner { ... }`.
// Deep rules expect traversal order to match execution order, so the walker
// needs access to the modifier body's "before `_`" statements (as prefix
// scopes) and "after `_`" statements (as suffix scopes, in reverse modifier
// order — innermost modifier's post-code runs first).
//
// tree-sitter-solidity does not model `_` as a dedicated placeholder node; it
// parses `_;` as an `expression_statement` whose expression is an `identifier`
// with text `"_"`. We locate it by walking the first-named-child chain down
// from each statement. A modifier without a `_` placeholder is invalid
// Solidity — both hooks contribute nothing for it.

const ModifierSlice = enum { before, after };

fn solidityPreEnterHook(
    callable_id: u64,
    g: *const graph.SymbolGraph,
    allocator: std.mem.Allocator,
) anyerror![]ts.Node {
    return collectModifierSlices(callable_id, g, allocator, .before);
}

fn solidityPostEnterHook(
    callable_id: u64,
    g: *const graph.SymbolGraph,
    allocator: std.mem.Allocator,
) anyerror![]ts.Node {
    return collectModifierSlices(callable_id, g, allocator, .after);
}

fn collectModifierSlices(
    callable_id: u64,
    g: *const graph.SymbolGraph,
    allocator: std.mem.Allocator,
    which: ModifierSlice,
) ![]ts.Node {
    const gn = g.lookupNode(callable_id) orelse return &.{};
    const ast = gn.ast_node orelse return &.{};
    const container_id = gn.container orelse return &.{};

    var invocations: std.ArrayListUnmanaged(ts.Node) = .empty;
    defer invocations.deinit(allocator);

    var i: u32 = 0;
    while (i < ast.namedChildCount()) : (i += 1) {
        const child = ast.namedChild(i) orelse continue;
        if (std.mem.eql(u8, child.kind(), "modifier_invocation")) {
            try invocations.append(allocator, child);
        }
    }
    if (invocations.items.len == 0) return &.{};

    var result: std.ArrayListUnmanaged(ts.Node) = .empty;
    errdefer result.deinit(allocator);

    const count = invocations.items.len;
    var idx: usize = 0;
    while (idx < count) : (idx += 1) {
        const inv = if (which == .after)
            invocations.items[count - 1 - idx]
        else
            invocations.items[idx];

        // tree-sitter-solidity: modifier_invocation = seq($._identifier_path, optional($._call_arguments))
        // — no "name" field. Take the terminal identifier from the first named child.
        const head = inv.namedChild(0) orelse continue;
        const name_node = terminalIdentifier(head) orelse continue;
        const name = g.nodeText(name_node) orelse continue;
        const mod_ast = g.findInScope(container_id, name, "modifier_definition") orelse continue;
        const body = mod_ast.childByFieldName("body") orelse continue;
        const placeholder_idx = findUnderscorePlaceholder(body, g) orelse continue;

        if (which == .before) {
            var j: u32 = 0;
            while (j < placeholder_idx) : (j += 1) {
                if (body.namedChild(j)) |stmt| {
                    try result.append(allocator, stmt);
                }
            }
        } else {
            var j: u32 = placeholder_idx + 1;
            while (j < body.namedChildCount()) : (j += 1) {
                if (body.namedChild(j)) |stmt| {
                    try result.append(allocator, stmt);
                }
            }
        }
    }

    return result.toOwnedSlice(allocator);
}

/// Descend the first-named-child chain to reach a leaf identifier.
/// Returns the node itself if already an identifier. Handles both bare
/// `onlyOwner` and qualified `Lib.onlyOwner` forms (identifier_path wraps).
fn terminalIdentifier(node: ts.Node) ?ts.Node {
    var cur = node;
    while (!std.mem.eql(u8, cur.kind(), "identifier")) {
        if (cur.namedChildCount() == 0) return null;
        cur = cur.namedChild(cur.namedChildCount() - 1) orelse return null;
    }
    return cur;
}

/// Locate the `_` placeholder statement in a modifier body.
///
/// tree-sitter-solidity parses `_;` with a very specific shape:
///
///   statement
///     └─ expression_statement
///          └─ expression
///               └─ identifier "_"
///
/// Every statement in a `function_body` is wrapped in a `statement` node
/// (grammar unification), and every expression inside an `expression_statement`
/// is wrapped in an `expression` node. The placeholder is this exact shape —
/// an expression statement whose single expression is a single bare identifier
/// with text `"_"`. The child-count guards reject look-alikes like `_()`,
/// `_ + 1`, or `foo._` — anything except the literal placeholder.
fn findUnderscorePlaceholder(body: ts.Node, g: *const graph.SymbolGraph) ?u32 {
    var j: u32 = 0;
    while (j < body.namedChildCount()) : (j += 1) {
        const stmt = body.namedChild(j) orelse continue;
        if (isUnderscorePlaceholder(stmt, g)) return j;
    }
    return null;
}

fn isUnderscorePlaceholder(stmt_node: ts.Node, g: *const graph.SymbolGraph) bool {
    // Unwrap the `statement` grammar wrapper.
    const inner = if (std.mem.eql(u8, stmt_node.kind(), "statement"))
        (if (stmt_node.namedChildCount() == 1) stmt_node.namedChild(0) orelse return false else return false)
    else
        stmt_node;
    if (!std.mem.eql(u8, inner.kind(), "expression_statement")) return false;

    // expression_statement holds exactly one named `expression` wrapper.
    if (inner.namedChildCount() != 1) return false;
    const expr = inner.namedChild(0) orelse return false;
    if (!std.mem.eql(u8, expr.kind(), "expression")) return false;

    // The expression wraps exactly one bare `identifier` — no operators,
    // no arguments, no member access.
    if (expr.namedChildCount() != 1) return false;
    const id = expr.namedChild(0) orelse return false;
    if (!std.mem.eql(u8, id.kind(), "identifier")) return false;

    const text = g.nodeText(id) orelse return false;
    return std.mem.eql(u8, text, "_");
}

const std = @import("std");
