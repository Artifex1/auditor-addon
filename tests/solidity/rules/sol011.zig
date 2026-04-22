const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-011-div-before-mul.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-011: inline and variable div-before-mul flagged" {
    const files = [_][]const u8{fix ++ "sol011-div-before-mul.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // 4 cases: inline left, inline right, via variable, via reassignment
    try std.testing.expectEqual(@as(usize, 4), count);
}

test "SOL-011: correct order and cleared variable not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
