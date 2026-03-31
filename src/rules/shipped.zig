/// Shipped rules embedded at compile time.
/// Each entry contains the rule ID, filename, and Lua source.
/// Add new rules here when they are ready to ship.

pub const ShippedRule = struct {
    id: []const u8,
    filename: []const u8,
    source: []const u8,
};

pub const all = [_]ShippedRule{
    .{
        .id = "GEN-001",
        .filename = "GEN-001-constant-not-cap.lua",
        .source = @embedFile("GEN-001-constant-not-cap.lua"),
    },
    .{
        .id = "SOL-001",
        .filename = "SOL-001-unchecked-call.lua",
        .source = @embedFile("SOL-001-unchecked-call.lua"),
    },
    .{
        .id = "SOL-002",
        .filename = "SOL-002-reentrancy.lua",
        .source = @embedFile("SOL-002-reentrancy.lua"),
    },
    .{
        .id = "SOL-003",
        .filename = "SOL-003-floating-pragma.lua",
        .source = @embedFile("SOL-003-floating-pragma.lua"),
    },
    .{
        .id = "SOL-004",
        .filename = "SOL-004-use-custom-errors.lua",
        .source = @embedFile("SOL-004-use-custom-errors.lua"),
    },
    .{
        .id = "SOL-005",
        .filename = "SOL-005-lack-of-security-contact.lua",
        .source = @embedFile("SOL-005-lack-of-security-contact.lua"),
    },
    .{
        .id = "SOL-006",
        .filename = "SOL-006-natspec-missing.lua",
        .source = @embedFile("SOL-006-natspec-missing.lua"),
    },
    .{
        .id = "SOL-007",
        .filename = "SOL-007-missing-mapping-named-parameters.lua",
        .source = @embedFile("SOL-007-missing-mapping-named-parameters.lua"),
    },
    .{
        .id = "SOL-008",
        .filename = "SOL-008-non-explicit-imports.lua",
        .source = @embedFile("SOL-008-non-explicit-imports.lua"),
    },
    .{
        .id = "SOL-009",
        .filename = "SOL-009-calldata-instead-of-memory.lua",
        .source = @embedFile("SOL-009-calldata-instead-of-memory.lua"),
    },
    .{
        .id = "SOL-010",
        .filename = "SOL-010-state-var-visibility-not-explicit.lua",
        .source = @embedFile("SOL-010-state-var-visibility-not-explicit.lua"),
    },
    .{
        .id = "MAP-001",
        .filename = "MAP-001-broad-visibility.lua",
        .source = @embedFile("MAP-001-broad-visibility.lua"),
    },
    .{
        .id = "SOL-011",
        .filename = "SOL-011-div-before-mul.lua",
        .source = @embedFile("SOL-011-div-before-mul.lua"),
    },
    .{
        .id = "GEN-002",
        .filename = "GEN-002-duplicated-import.lua",
        .source = @embedFile("GEN-002-duplicated-import.lua"),
    },
    .{
        .id = "SOL-015",
        .filename = "SOL-015-no-spdx.lua",
        .source = @embedFile("SOL-015-no-spdx.lua"),
    },
    .{
        .id = "SOL-013",
        .filename = "SOL-013-state-update-no-event.lua",
        .source = @embedFile("SOL-013-state-update-no-event.lua"),
    },
    .{
        .id = "SOL-016",
        .filename = "SOL-016-unused-error.lua",
        .source = @embedFile("SOL-016-unused-error.lua"),
    },
    .{
        .id = "SOL-017",
        .filename = "SOL-017-unused-event.lua",
        .source = @embedFile("SOL-017-unused-event.lua"),
    },
    .{
        .id = "SOL-018",
        .filename = "SOL-018-tx-origin.lua",
        .source = @embedFile("SOL-018-tx-origin.lua"),
    },
    .{
        .id = "MAP-002",
        .filename = "MAP-002-unused-function.lua",
        .source = @embedFile("MAP-002-unused-function.lua"),
    },
};
