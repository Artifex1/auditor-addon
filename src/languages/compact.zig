const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .compact,

    .containers = &.{
        .{ .ts_type = "mdefn", .name_field = "name", .body_field = "module_element" },
        .{ .ts_type = "ecdecl", .name_field = "name", .body_field = "contract_circuit" },
    },

    .callables = &.{
        .{ .ts_type = "cdefn", .name_field = "id", .body_field = "body", .properties = &.{
            .{ .key = "visibility", .child_type = "export" },
        } },
        .{ .ts_type = "edecl", .name_field = "id", .body_field = null },
    },

    .variables = &.{
        .{ .ts_type = "ldecl", .name_field = "name", .type_field = "type" },
    },

    .modifiers = &.{},
    .events = &.{},

    .call_expression = .{ .ts_type = "function_call_term", .function_field = "fun" },
    .inheritance = null,
    .modifier_invocation = null,
    .emit_expression = null,

    .write_expressions = &.{
        .{ .ts_type = "assignment", .target_field = "left" },
    },
    .write_call_methods = &.{},

    .imports = .{ .ts_type = "idecl", .path_field = "id" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "assert",  "require",
        "hash",    "merkle_root", "pad",    "sign",    "verify",
        "witness", "reveal",      "disclose", "const_check",
        "length",  "append",      "slice",  "map",     "fold", "zip",
        "default", "init",        "set",    "get",
    },
    .builtin_receivers = &.{},

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "parenthesized_expression" },
        .{ .context = .callee, .ts_type = "fun", .child_field = "id" },
    },
    .identifier_type = "id",

    .custom_handler = null,
    .resolve_hook = null,

    .metrics = .{
        .branching_types = &.{
            "if_stmt",
            "for_stmt",
            "conditional_expr",
        },
        .comment_types = &.{ "comment", "block_comment" },
        .normalization_types = &.{ "cdefn", "function_call_term" },
        .base_rate_per_day = 175,
    },
};
