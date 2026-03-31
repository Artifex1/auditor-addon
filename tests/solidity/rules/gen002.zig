const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/GEN-002-duplicated-import.lua";
const fix = "tests/solidity/fixtures/";

test "GEN-002: duplicate imports flagged" {
    const files = [_][]const u8{fix ++ "gen002-duplicated-import.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // ./IERC20.sol and ./Ownable.sol each appear twice
    try std.testing.expectEqual(@as(usize, 2), count);
}

test "GEN-002: no duplicate imports not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
