const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-021-double-state-read.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-021: double state reads flagged" {
    const files = [_][]const u8{fix ++ "sol021-double-state-read.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // balance read twice in doubleBalance, limit read twice in doubleLimit
    try std.testing.expectEqual(@as(usize, 2), count);
}

test "SOL-021: RulesClean has double reads of balances in withdraw" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // balances read twice in withdraw()
    try std.testing.expectEqual(@as(usize, 2), count);
}
