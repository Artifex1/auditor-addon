const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .tsx,

    .containers = &.{
        .{ .ts_type = "class_declaration", .name_field = "name", .body_field = "body" },
    },

    .callables = &.{
        .{ .ts_type = "function_declaration", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "function_expression", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "generator_function_declaration", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "generator_function", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "method_definition", .name_field = "name", .body_field = "body", .properties = &.{
            .{ .key = "visibility", .child_type = "accessibility_modifier" },
        } },
        .{ .ts_type = "arrow_function", .name_field = null, .body_field = "body" },
    },

    .variables = &.{},
    .modifiers = &.{},
    .events = &.{},

    .call_expression = .{ .ts_type = "call_expression", .function_field = "function" },
    .inheritance = null,
    .modifier_invocation = null,
    .emit_expression = null,

    .write_expressions = &.{
        .{ .ts_type = "assignment_expression", .target_field = "left" },
        .{ .ts_type = "augmented_assignment_expression", .target_field = "left" },
    },

    .imports = .{ .ts_type = "import_statement", .path_field = "source" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "require",      "console",       "setTimeout",    "setInterval",
        "clearTimeout", "clearInterval", "Promise",       "Array",
        "Object",       "String",        "Number",        "Boolean",
        "Math",         "JSON",          "Error",         "Date",
        "RegExp",       "Map",           "Set",           "parseInt",
        "parseFloat",   "fetch",
    },
    .builtin_receivers = &.{},

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "member_expression", .child_field = "object" },
        .{ .context = .receiver, .ts_type = "subscript_expression", .child_field = "object" },
        .{ .context = .receiver, .ts_type = "parenthesized_expression" },
        .{ .context = .callee, .ts_type = "member_expression", .child_field = "property" },
    },
    .identifier_type = "identifier",

    .custom_handler = null,
    .resolve_hook = null,

    .metrics = .{
        .branching_types = &.{
            "if_statement",
            "for_statement",
            "for_in_statement",
            "while_statement",
            "do_statement",
            "switch_statement",
            "conditional_expression",
            "try_statement",
        },
        .comment_types = &.{"comment"},
        .normalization_types = &.{
            "function_declaration",
            "method_definition",
            "arrow_function",
            "call_expression",
            "array",
            "object",
        },
        .base_rate_per_day = 275,
    },
};
