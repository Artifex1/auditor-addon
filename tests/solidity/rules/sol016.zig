const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-016-unused-error.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-016: unused custom errors flagged" {
    const files = [_][]const u8{fix ++ "sol016-unused-error.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 2), count);
}

test "SOL-016: clean contract not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
