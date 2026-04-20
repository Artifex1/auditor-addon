const cfg = @import("config.zig");

pub const config = cfg.LanguageConfig{
    .language = .noir,

    .containers = &.{
        .{ .ts_type = "impl_item", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "trait_item", .name_field = "name", .body_field = "body" },
    },

    .callables = &.{
        .{ .ts_type = "function_item", .name_field = "name", .body_field = "body", .properties = &.{
            .{ .key = "visibility", .child_type = "visibility_modifier" },
        } },
        .{ .ts_type = "function_signature_item", .name_field = "name", .body_field = null },
    },

    .variables = &.{
        .{ .ts_type = "const_item", .name_field = "name", .type_field = "type" },
    },

    .modifiers = &.{},
    .events = &.{},

    .call_expression = .{ .ts_type = "call_expression", .function_field = "function" },
    .inheritance = null,
    .modifier_invocation = null,
    .emit_expression = null,

    .write_expressions = &.{
        .{ .ts_type = "assignment_expression", .target_field = "left" },
    },
    .write_call_methods = &.{},

    .imports = .{ .ts_type = "use_declaration", .path_field = "argument" },
    .inheritance_strategy = .flat,

    .builtin_functions = &.{
        "assert",
        "assert_eq",
        "assert_constant",
        "panic",
        "println",
        "print",
        "from_field",
        "to_field",
        "from_bits",
        "to_bits",
        "from_bytes",
        "to_bytes",
        "pedersen_hash",
        "pedersen_commitment",
        "sha256",
        "blake2s",
        "blake3",
        "keccak256",
        "poseidon",
        "poseidon2",
        "ecdsa_secp256k1",
        "ecdsa_secp256r1",
        "schnorr",
        "ed25519",
        "aes128_encrypt",
        "sha256_compression",
    },
    .builtin_receivers = &.{},

    .unwrap_table = &.{
        .{ .context = .receiver, .ts_type = "field_expression", .child_field = "value" },
        .{ .context = .receiver, .ts_type = "index_expression", .child_field = "value" },
        .{ .context = .receiver, .ts_type = "parenthesized_expression" },
        .{ .context = .receiver, .ts_type = "reference_expression", .child_field = "value" },
        .{ .context = .callee, .ts_type = "field_expression", .child_field = "field" },
        .{ .context = .callee, .ts_type = "scoped_identifier", .child_field = "name" },
        .{ .context = .callee, .ts_type = "generic_function", .child_field = "function" },
    },
    .identifier_type = "identifier",

    .resolve_hook = null,

    .metrics = .{
        .branching_types = &.{
            "if_expression",
            "for_statement",
            "comptime",
        },
        .comment_types = &.{ "line_comment", "block_comment" },
        .normalization_types = &.{ "function_item", "call_expression" },
        .base_rate_per_day = 200,
    },

    .test_markers = &.{
        .{ .node_type = "function_item", .detection = .{ .prev_sibling = .{
            .sibling_type = "attribute_item",
            .match_text = "test",
        } } },
    },
};
