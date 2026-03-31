const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .masm,

    .containers = &.{},

    .callables = &.{
        .{ .ts_type = "procedure", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "entrypoint", .name_field = null, .body_field = "body" },
    },

    .variables = &.{},

    .modifiers = &.{},
    .events = &.{},

    .call_expression = .{ .ts_type = "invoke", .function_field = "target" },
    .inheritance = null,
    .modifier_invocation = null,
    .emit_expression = null,

    .write_expressions = &.{},
    .write_call_methods = &.{},

    .imports = null,
    .inheritance_strategy = .flat,

    .builtin_functions = &.{},
    .builtin_receivers = &.{},

    .unwrap_table = &.{
        .{ .context = .callee, .ts_type = "relative_path" },
    },
    .identifier_type = "identifier",

    .custom_handler = null,
    .resolve_hook = null,

    .metrics = .{
        .branching_types = &.{
            "if",
            "while",
            "repeat",
        },
        .comment_types = &.{ "comment", "doc_comment", "moduledoc" },
        .normalization_types = &.{"invoke"},
        .base_rate_per_day = 150,
    },
};
