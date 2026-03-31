const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .cairo,

    .containers = &.{
        .{ .ts_type = "impl_item", .name_field = "name", .body_field = "body", .properties = &.{
            .{ .key = "trait", .child_type = "trait_type" },
        } },
        .{ .ts_type = "trait_item", .name_field = "name", .body_field = "body" },
    },

    .callables = &.{
        .{ .ts_type = "function_item", .name_field = "name", .body_field = "body", .properties = &.{
            .{ .key = "visibility", .child_type = "visibility_modifier" },
        } },
        .{ .ts_type = "external_function_item", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "function_signature_item", .name_field = "name", .body_field = null },
    },

    .variables = &.{
        .{ .ts_type = "const_item", .name_field = "name", .type_field = "type" },
    },

    .modifiers = &.{},
    .events = &.{},

    .call_expression = .{ .ts_type = "call_expression", .function_field = "function" },
    .inheritance = null,
    .modifier_invocation = null,
    .emit_expression = null, // Cairo emit is self.emit(...) — method call pattern, not a dedicated node

    .write_expressions = &.{
        .{ .ts_type = "assignment_expression", .target_field = "left" },
        .{ .ts_type = "compound_assignment_expr", .target_field = "left" },
    },
    .write_call_methods = &.{},

    .imports = .{ .ts_type = "use_declaration", .path_field = "argument" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "assert",
        "panic",
        "panic_with_felt252",
        "array",
        "into",
        "try_into",
        "unwrap",
        "expect",
        "is_some",
        "is_none",
        "is_ok",
        "is_err",
        "append",
        "pop_front",
        "get",
        "at",
        "len",
        "is_empty",
        "span",
        "clone",
        "drop",
        "copy",
        "print",
        "new",
        "emit",
        "read",
        "write",
        "get_caller_address",
        "get_block_timestamp",
        "get_block_number",
        "get_contract_address",
    },
    .builtin_receivers = &.{},

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "field_expression", .child_field = "value" },
        .{ .context = .receiver, .ts_type = "index_expression", .child_field = "value" },
        .{ .context = .receiver, .ts_type = "parenthesized_expression" },
        .{ .context = .receiver, .ts_type = "reference_expression", .child_field = "value" },
        .{ .context = .receiver, .ts_type = "try_expression" },
        .{ .context = .callee, .ts_type = "field_expression", .child_field = "field" },
        .{ .context = .callee, .ts_type = "scoped_identifier", .child_field = "name" },
        .{ .context = .callee, .ts_type = "generic_function", .child_field = "function" },
    },
    .identifier_type = "identifier",

    .custom_handler = null,
    .resolve_hook = null,

    .metrics = .{
        .branching_types = &.{
            "if_expression",
            "for_expression",
            "while_expression",
            "loop_expression",
            "match_expression",
        },
        .comment_types = &.{ "line_comment", "block_comment" },
        .normalization_types = &.{ "function_item", "external_function_item", "call_expression" },
        .base_rate_per_day = 200,
    },
};
