const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/GEN-003-unused-import.lua";
const fix = "tests/solidity/fixtures/";

test "GEN-003: unused named imports flagged" {
    const files = [_][]const u8{fix ++ "gen003-unused-import.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // Bar and Qux are never used
    try std.testing.expectEqual(@as(usize, 2), count);
}

test "GEN-003: RulesClean has one unused import (IERC20)" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 1), count);
}
