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
        } },
        .{ .ts_type = "modifier_definition", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "constructor_definition", .name_field = null, .body_field = "body" },
        .{ .ts_type = "fallback_receive_definition", .name_field = null, .body_field = "body" },
    },

    .variables = &.{
        .{ .ts_type = "state_variable_declaration", .name_field = "name", .type_field = "type", .properties = &.{
            .{ .key = "visibility", .child_type = "visibility" },
        } },
    },

    .modifiers = &.{},
    .events = &.{
        .{ .ts_type = "event_definition", .name_field = "name" },
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

    .builtin_functions = &.{ "require", "assert", "revert", "keccak256", "abi.encode", "abi.encodePacked", "abi.encodeWithSelector", "abi.encodeWithSignature", "abi.decode" },
    .builtin_receivers = &.{ "abi", "block", "msg", "tx", "type" },

    .unwrap_rules = &.{
        .{ .ts_type = "member_expression", .child_field = "object" },
        .{ .ts_type = "array_access", .child_field = "base" },
        .{ .ts_type = "slice_access", .child_field = "base" },
        .{ .ts_type = "parenthesized_expression", .child_field = "expression" },
        .{ .ts_type = "type_cast_expression", .child_field = "expression" },
        .{ .ts_type = "expression", .child_field = null }, // transparent wrapper
    },
    .callee_unwrap_rules = &.{
        .{ .ts_type = "member_expression", .child_field = "property" },
        .{ .ts_type = "struct_expression", .child_field = "type" }, // addr.call{value: x} → addr.call
        .{ .ts_type = "expression", .child_field = null }, // transparent wrapper
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

/// Solidity resolve hook: external low-level calls (.call, .send, .transfer,
/// .delegatecall, .staticcall) emit a calls edge with target_kind=external
/// AND a gap so the agent can optionally resolve the target contract.
fn solidityResolveHook(ref: graph.PendingRef, g: *graph.SymbolGraph) cfg.ResolveAction {
    if (ref.kind != .call) return .unhandled;

    for (&external_call_methods) |ecm| {
        if (std.mem.eql(u8, ref.target_name, ecm)) {
            // Emit edge: from callable, self-referencing (no resolved target)
            g.addEdge(.{
                .from = ref.from,
                .to = ref.from,
                .kind = .calls,
                .attrs = .{
                    .call_site_byte = ref.call_site.start_byte,
                    .call_site_line = ref.call_site.line,
                    .target_kind = .external,
                },
            }) catch {};

            // Also emit gap for optional agent resolution
            const gap_id = graph.gapId(ref.from, ref.target_name, .calls);
            _ = g.addGap(.{
                .id = gap_id,
                .from = ref.from,
                .expected_target = ref.target_name,
                .edge_kind = .calls,
                .call_site = ref.call_site,
                .priority = .low,
            }) catch {};

            return .resolved;
        }
    }
    return .unhandled;
}

const std = @import("std");
