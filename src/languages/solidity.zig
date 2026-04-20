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

    .variables = &.{
        .{ .ts_type = "state_variable_declaration", .name_field = "name", .type_field = "type", .properties = &.{
            .{ .key = "visibility", .child_type = "visibility" },
            .{ .key = "mutability", .child_type = "immutable" },
            .{ .key = "constant", .child_type = "constant" },
        } },
    },

    .modifiers = &.{},
    .events = &.{
        .{ .ts_type = "event_definition", .name_field = "name" },
    },

    .errors = &.{
        .{ .ts_type = "error_declaration", .name_field = "name" },
    },

    .type_defs = &.{
        .{ .ts_type = "struct_declaration", .name_field = "name" },
        .{ .ts_type = "enum_declaration", .name_field = "name" },
    },

    .call_expression = .{ .ts_type = "call_expression", .function_field = "function" },
    .inheritance = .{ .ts_type = "inheritance_specifier", .name_field = "ancestor" },
    .modifier_invocation = .{ .ts_type = "modifier_invocation", .name_field = "name" },
    .emit_expression = .{ .ts_type = "emit_statement", .name_field = "name" },

    .write_expressions = &.{
        .{ .ts_type = "assignment_expression", .target_field = "left" },
        .{ .ts_type = "augmented_assignment_expression", .target_field = "left" },
        .{ .ts_type = "delete_statement", .target_field = "expression" },
    },
    .write_call_methods = &.{ "push", "pop" },

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
/// 2. Struct/enum constructors → resolve to type_def, no gap.
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
            ref.gap = .low;
            ref.resolved = true;
            return;
        }
    }

    // 2. Struct/enum constructor — resolves to type_def, no gap
    if (g.containerOf(ref.from)) |cid| {
        if (g.resolveInScope(cid, ref.target_name, .type_def)) |result| {
            ref.addTarget(allocator, result.node.id) catch return;
            ref.target_kind = .internal;
            ref.resolved = true;
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
            if (result.ambiguous) ref.gap = .low;
        } else {
            ref.gap = .medium;
        }
        ref.resolved = true;
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
        ref.gap = .low; // provisionally resolved; receiver type not verified
        ref.resolved = true;
    }
    // else: fall through — default resolution handles it (medium gap)
}

const std = @import("std");
