const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .tolk,

    .containers = &.{},

    .callables = &.{
        .{ .ts_type = "function_declaration", .name_field = "name", .body_field = "body" },
    },

    .call_expression = .{ .ts_type = "function_call", .function_field = "callee" },
    .inheritance = null,

    .imports = .{ .ts_type = "import_directive", .path_field = "path" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "send_raw_message", "get_data", "set_data", "get_balance",
        "accept_message", "reserve_extra_currencies",
        "load_bits", "load_uint", "load_int", "load_ref", "load_maybe_ref",
        "load_coins", "load_address", "skip_bits",
        "store_uint", "store_int", "store_ref", "store_maybe_ref", "store_bits",
        "store_coins", "store_address", "store_builder",
        "begin_cell", "end_cell", "begin_parse",
        "cell_hash", "slice_hash", "string_hash",
        "throw", "throw_if", "throw_unless",
        "random", "randomize_lt", "cur_lt", "now",
    },
    .builtin_receivers = &.{},

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "parenthesized_expression" },
        .{ .context = .callee, .ts_type = "dot_access", .child_field = "field" },
        .{ .context = .callee, .ts_type = "generic_instantiation", .child_field = "expr" },
    },
    .identifier_type = "identifier",

    .resolve_hook = null,

    .metrics = .{
        .branching_types = &.{
            "if_statement",
            "while_statement",
            "do_while_statement",
            "repeat_statement",
            "match_expression",
            "try_catch_statement",
        },
        .comment_types = &.{"comment"},
        .normalization_types = &.{ "function_declaration", "function_call" },
        .base_rate_per_day = 200,
    },
};
