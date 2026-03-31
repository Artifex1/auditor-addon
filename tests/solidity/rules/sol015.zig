const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-015-no-spdx.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-015: missing SPDX-License-Identifier flagged" {
    const files = [_][]const u8{fix ++ "sol015-no-spdx.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 1), count);
}

test "SOL-015: present SPDX-License-Identifier not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
