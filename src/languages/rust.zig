const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .rust,

    .containers = &.{
        .{ .ts_type = "impl_item", .name_field = "type", .body_field = "body" },
        .{ .ts_type = "mod_item", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "trait_item", .name_field = "name", .body_field = "body" },
    },

    .callables = &.{
        .{ .ts_type = "function_item", .name_field = "name", .body_field = "body", .properties = &.{
            .{ .key = "visibility", .child_type = "visibility_modifier" },
        } },
    },

    .call_expression = .{ .ts_type = "call_expression", .function_field = "function" },
    .inheritance = null,

    .imports = .{ .ts_type = "use_declaration", .path_field = "argument" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "println",     "eprintln", "print",     "eprint",    "format",
        "write",       "writeln",  "panic",     "todo",      "unimplemented",
        "unreachable", "assert",   "assert_eq", "assert_ne", "vec",
        "drop",        "swap",     "replace",   "Some",      "None",
        "Ok",          "Err",      "Box",
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
        .normalization_types = &.{ "function_item", "call_expression", "array_expression" },
        .base_rate_per_day = 225,
    },

    .test_markers = &.{
        .{ .node_type = "function_item", .detection = .{ .prev_sibling = .{
            .sibling_type = "attribute_item",
            .match_text = "test",
        } } },
        .{ .node_type = "mod_item", .detection = .{ .prev_sibling = .{
            .sibling_type = "attribute_item",
            .match_text = "cfg(test)",
        } } },
    },
};
