const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .move,

    .containers = &.{
        .{ .ts_type = "module", .name_field = "name", .body_field = null },
    },

    .callables = &.{
        .{ .ts_type = "function_decl", .name_field = "name", .body_field = "body", .properties = &.{
            .{ .key = "visibility", .child_type = "visibility" },
        } },
    },

    .call_expression = .{ .ts_type = "call_expr", .function_field = "func_name" },
    .inheritance = null,

    .imports = .{ .ts_type = "use_decl", .path_field = "path" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "assert",
        "abort",
        "move_to",
        "move_from",
        "borrow_global",
        "borrow_global_mut",
        "exists",
        "freeze",
        "destroy_empty",
        "emit",
        "vector",
        "copy",
        "drop",
    },
    .builtin_receivers = &.{},

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "field_expression", .child_field = "value" },
        .{ .context = .receiver, .ts_type = "index_expression", .child_field = "value" },
        .{ .context = .receiver, .ts_type = "parenthesized_expression" },
        .{ .context = .receiver, .ts_type = "borrow_expression" },
        .{ .context = .callee, .ts_type = "name_access_chain" }, // walk to last identifier
        .{ .context = .callee, .ts_type = "field_expression", .child_field = "field" },
    },
    .identifier_type = "identifier",

    .resolve_hook = null,

    .metrics = .{
        .branching_types = &.{
            "if_expr",
            "while_expr",
            "loop_expr",
            "for_loop_expr",
            "match_expr",
        },
        .comment_types = &.{ "line_comment", "block_comment" },
        .normalization_types = &.{ "function_decl", "call_expr" },
        .base_rate_per_day = 200,
    },

    .test_markers = &.{
        .{ .node_type = "function_decl", .detection = .{ .prev_sibling = .{
            .sibling_type = "attributes",
            .match_text = "test",
        } } },
    },
};
