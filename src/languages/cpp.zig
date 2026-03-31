const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .cpp,

    .containers = &.{
        .{ .ts_type = "class_specifier", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "struct_specifier", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "namespace_definition", .name_field = "name", .body_field = "body" },
    },

    .callables = &.{
        .{ .ts_type = "function_definition", .name_field = "declarator", .body_field = "body", .properties = &.{
            .{ .key = "visibility", .child_type = "access_specifier" },
        } },
    },

    .variables = &.{
        .{ .ts_type = "field_declaration", .name_field = "declarator", .type_field = "type" },
        .{ .ts_type = "declaration", .name_field = "declarator", .type_field = "type" },
    },

    .modifiers = &.{},
    .events = &.{},

    .call_expression = .{ .ts_type = "call_expression", .function_field = "function" },
    .inheritance = null,
    .modifier_invocation = null,
    .emit_expression = null,

    .write_expressions = &.{
        .{ .ts_type = "assignment_expression", .target_field = "left" },
        .{ .ts_type = "compound_assignment_expr", .target_field = "left" },
        .{ .ts_type = "update_expression", .target_field = "argument" },
    },
    .write_call_methods = &.{ "push_back", "pop_back", "push_front", "pop_front", "insert", "erase", "clear", "emplace", "emplace_back" },

    .imports = .{ .ts_type = "preproc_include", .path_field = "path" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "printf", "fprintf", "sprintf", "snprintf", "scanf", "sscanf",
        "malloc", "calloc", "realloc", "free",
        "memcpy", "memmove", "memset", "memcmp",
        "strlen", "strcpy", "strncpy", "strcmp", "strncmp", "strcat", "strncat",
        "assert", "exit", "abort", "system",
        "new", "delete",
    },
    .builtin_receivers = &.{ "std", "boost" },

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "field_expression", .child_field = "argument" },
        .{ .context = .receiver, .ts_type = "subscript_expression", .child_field = "argument" },
        .{ .context = .receiver, .ts_type = "parenthesized_expression" },
        .{ .context = .receiver, .ts_type = "pointer_expression", .child_field = "argument" },
        .{ .context = .callee, .ts_type = "field_expression", .child_field = "field" },
        .{ .context = .callee, .ts_type = "qualified_identifier", .child_field = "name" },
        .{ .context = .callee, .ts_type = "template_function", .child_field = "name" },
        .{ .context = .name, .ts_type = "function_declarator", .child_field = "declarator" },
        .{ .context = .name, .ts_type = "reference_declarator" },
        .{ .context = .name, .ts_type = "pointer_declarator", .child_field = "declarator" },
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
            "switch_statement",
            "catch_clause",
        },
        .comment_types = &.{"comment"},
        .normalization_types = &.{ "function_definition", "call_expression", "initializer_list" },
        .base_rate_per_day = 200,
    },
};
