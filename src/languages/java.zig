const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .java,

    .containers = &.{
        .{ .ts_type = "class_declaration", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "interface_declaration", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "enum_declaration", .name_field = "name", .body_field = "body" },
    },

    .callables = &.{
        .{ .ts_type = "method_declaration", .name_field = "name", .body_field = "body", .properties = &.{
            .{ .key = "visibility", .child_type = "modifiers" },
        } },
        .{ .ts_type = "constructor_declaration", .name_field = "name", .body_field = "body", .properties = &.{
            .{ .key = "visibility", .child_type = "modifiers" },
        } },
    },

    .variables = &.{
        .{ .ts_type = "field_declaration", .name_field = "declarator", .type_field = "type", .properties = &.{
            .{ .key = "visibility", .child_type = "modifiers" },
        } },
    },

    .modifiers = &.{},
    .events = &.{},

    .call_expression = .{ .ts_type = "method_invocation", .function_field = "name" },
    .inheritance = .{ .ts_type = "superclass", .name_field = "type" },
    .modifier_invocation = null,
    .emit_expression = null,

    .write_expressions = &.{
        .{ .ts_type = "assignment_expression", .target_field = "left" },
        .{ .ts_type = "update_expression", .target_field = "operand" },
    },
    .write_call_methods = &.{ "add", "put", "set", "remove", "clear", "push", "offer", "poll" },

    .imports = .{ .ts_type = "import_declaration", .path_field = "name" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "toString", "equals",    "hashCode",    "compareTo", "clone",
        "println",  "print",     "printf",      "format",    "valueOf",
        "parseInt", "parseLong", "parseDouble",
    },
    .builtin_receivers = &.{ "System", "Math", "String", "Integer", "Long", "Double", "Arrays", "Collections", "Objects", "Optional" },

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "field_access", .child_field = "object" },
        .{ .context = .receiver, .ts_type = "array_access", .child_field = "array" },
        .{ .context = .receiver, .ts_type = "parenthesized_expression" },
        .{ .context = .receiver, .ts_type = "cast_expression", .child_field = "value" },
        .{ .context = .callee, .ts_type = "field_access", .child_field = "field" },
        .{ .context = .property, .ts_type = "modifiers", .search_types = &.{ "public", "private", "protected" } },
    },
    .identifier_type = "identifier",

    .custom_handler = null,
    .resolve_hook = null,

    .metrics = .{
        .branching_types = &.{
            "if_statement",
            "for_statement",
            "while_statement",
            "do_statement",
            "switch_expression",
            "try_statement",
            "catch_clause",
            "ternary_expression",
        },
        .comment_types = &.{ "line_comment", "block_comment" },
        .normalization_types = &.{ "method_declaration", "method_invocation", "array_initializer" },
        .base_rate_per_day = 225,
    },

    .test_markers = &.{
        .{ .node_type = "method_declaration", .detection = .{ .child_annotation = .{
            .parent_field = "modifiers",
            .child_type = "marker_annotation",
            .match_text = "Test",
        } } },
    },
};
