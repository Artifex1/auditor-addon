const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .go,

    .containers = &.{},
    // Go has no explicit container syntax — methods are associated via receiver types.
    // The pipeline creates implicit containers from method_declaration receivers.
    // TODO: consider a custom_handler to create struct containers from receiver types.

    .callables = &.{
        .{ .ts_type = "function_declaration", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "method_declaration", .name_field = "name", .body_field = "body" },
    },

    .variables = &.{
        .{ .ts_type = "var_declaration", .name_field = "name" },
        .{ .ts_type = "const_declaration", .name_field = "name" },
    },

    .modifiers = &.{},
    .events = &.{},

    .call_expression = .{ .ts_type = "call_expression", .function_field = "function" },
    .inheritance = null,
    .modifier_invocation = null,
    .emit_expression = null,

    .write_expressions = &.{
        .{ .ts_type = "assignment_statement", .target_field = "left" },
        .{ .ts_type = "short_var_declaration", .target_field = "left" },
    },
    .write_call_methods = &.{ "append", "delete" },

    .imports = .{ .ts_type = "import_declaration", .path_field = "path" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "make", "new", "len", "cap", "append", "copy", "close", "delete",
        "complex", "real", "imag", "panic", "recover", "print", "println",
        "min", "max", "clear",
        "string", "int", "int8", "int16", "int32", "int64",
        "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
        "float32", "float64", "byte", "rune", "bool", "error",
    },
    .builtin_receivers = &.{},

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "selector_expression", .child_field = "operand" },
        .{ .context = .receiver, .ts_type = "index_expression", .child_field = "operand" },
        .{ .context = .receiver, .ts_type = "parenthesized_expression" },
        .{ .context = .receiver, .ts_type = "unary_expression", .child_field = "operand" },
        .{ .context = .callee, .ts_type = "selector_expression", .child_field = "field" },
    },
    .identifier_type = "identifier",

    .custom_handler = null,
    .resolve_hook = null,

    .metrics = .{
        .branching_types = &.{
            "if_statement",
            "for_statement",
            "expression_switch_statement",
            "type_switch_statement",
            "select_statement",
        },
        .comment_types = &.{"comment"},
        .normalization_types = &.{ "function_declaration", "method_declaration", "call_expression", "composite_literal" },
        .base_rate_per_day = 250,
    },
};
