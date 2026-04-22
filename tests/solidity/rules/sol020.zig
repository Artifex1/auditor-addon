const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-020-unchecked-transfer.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-020: unchecked transfer and transferFrom flagged" {
    const files = [_][]const u8{fix ++ "sol020-unchecked-transfer.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 2), count);
}

test "SOL-020: clean contract has no unchecked transfers" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
