const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-018-tx-origin.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-018: tx.origin in auth context flagged" {
    const files = [_][]const u8{fix ++ "sol018-tx-origin.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // Three uses of tx.origin in auth context: require, if, assert
    try std.testing.expectEqual(@as(usize, 3), count);
}

test "SOL-018: clean contract not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
