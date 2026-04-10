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

    .custom_handler = &solidityCustomHandler,
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

/// Solidity-specific edge cases the declarative config can't express:
/// - using-for directives (library attachment)
/// - yul_function_call in assembly blocks
/// - expression node unwrapping (handled via unwrap_rules above, but
///   complex patterns like type(...).creationCode need special handling)
fn solidityCustomHandler(_: *graph.SymbolGraph, node: ts.Node, _: []const u8) void {
    const node_type = node.kind();

    if (std.mem.eql(u8, node_type, "yul_function_call")) {
        // Assembly calls: extract the yul_identifier as call target
        // TODO: create PendingRef for user-defined yul functions
    } else if (std.mem.eql(u8, node_type, "using_directive")) {
        // using SafeMath for uint256 — attaches library methods to a type
        // TODO: record using-for relationship for call resolution
    }
}

const external_call_methods = [_][]const u8{ "call", "send", "transfer", "delegatecall", "staticcall" };

/// Solidity resolve hook:
/// 1. External low-level calls (.call, .send, .transfer, .delegatecall, .staticcall)
///    → mark as external with low-priority gap.
/// 2. Struct/enum constructors → resolve to type_def, no gap.
/// 3. Super-qualified calls (super.foo()) → resolve in parent containers only,
///    skipping the current contract to avoid resolving to the local override.
fn solidityResolveHook(ref: *graph.Reference, g: *const graph.SymbolGraph, lang_config: *const cfg.LanguageConfig, allocator: std.mem.Allocator) void {
    if (ref.kind != .call) return;

    // External low-level calls
    for (&external_call_methods) |ecm| {
        if (std.mem.eql(u8, ref.target_name, ecm)) {
            ref.target_kind = .external;
            ref.gap = .low;
            ref.resolved = true;
            return;
        }
    }

    // Struct/enum constructor — resolves to type_def, no gap
    if (g.containerOf(ref.from)) |cid| {
        if (g.resolveInScope(cid, ref.target_name, .type_def)) |result| {
            ref.addTarget(allocator, result.node.id) catch return;
            ref.target_kind = .internal;
            ref.resolved = true;
            return;
        }
    }

    // Super-qualified calls: super.foo() should resolve in parents only
    const ast_node = ref.ast_node orelse return;
    const source = g.sourceForFile(ref.site.file) orelse return;
    const callee_node = ast_node.childByFieldName(lang_config.call_expression.function_field) orelse return;
    const receiver = cfg.unwrap(callee_node, source, lang_config, .receiver) orelse return;
    if (!std.mem.eql(u8, receiver, "super")) return;

    const container_id = g.containerOf(ref.from) orelse return;
    if (g.resolveInParentsOnly(container_id, ref.target_name, .callable)) |result| {
        ref.addTarget(allocator, result.node.id) catch return;
        ref.target_kind = .internal;
        if (result.ambiguous) ref.gap = .low;
    } else {
        ref.gap = .medium;
    }
    ref.resolved = true;
}

const std = @import("std");
