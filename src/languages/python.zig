const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .python,

    .containers = &.{
        .{ .ts_type = "class_definition", .name_field = "name", .body_field = "body" },
    },

    .callables = &.{
        .{ .ts_type = "function_definition", .name_field = "name", .body_field = "body" },
    },

    // Python uses `call` (not `call_expression`) and `function` field
    .call_expression = .{ .ts_type = "call", .function_field = "function" },
    .inheritance = .{ .ts_type = "argument_list", .name_field = "identifier" },

    .imports = .{ .ts_type = "import_from_statement", .path_field = "module_name" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "print",       "len",        "range",      "int",        "str",
        "float",       "list",       "dict",       "set",        "tuple",
        "type",        "isinstance", "issubclass", "hasattr",    "getattr",
        "setattr",     "delattr",    "super",      "property",   "staticmethod",
        "classmethod", "enumerate",  "zip",        "map",        "filter",
        "sorted",      "reversed",   "min",        "max",        "sum",
        "abs",         "round",      "open",       "input",      "bool",
        "bytes",       "object",     "id",         "hash",       "repr",
        "format",      "vars",       "dir",        "callable",   "iter",
        "next",        "any",        "all",        "breakpoint",
    },
    .builtin_receivers = &.{},

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "attribute", .child_field = "object" },
        .{ .context = .receiver, .ts_type = "subscript", .child_field = "value" },
        .{ .context = .receiver, .ts_type = "parenthesized_expression" },
        .{ .context = .callee, .ts_type = "attribute", .child_field = "attribute" },
    },
    .identifier_type = "identifier",

    .resolve_hook = null,

    .metrics = .{
        .branching_types = &.{
            "if_statement",
            "for_statement",
            "while_statement",
            "conditional_expression",
            "try_statement",
            "except_clause",
        },
        .comment_types = &.{"comment"},
        .normalization_types = &.{ "function_definition", "call", "list", "dictionary" },
        .base_rate_per_day = 275,
    },

    .test_markers = &.{
        .{ .node_type = "function_definition", .detection = .{ .name_prefix = .{
            .name_field = "name",
            .prefix = "test",
        } } },
        .{ .node_type = "class_definition", .detection = .{ .name_prefix = .{
            .name_field = "name",
            .prefix = "Test",
        } } },
    },
};
