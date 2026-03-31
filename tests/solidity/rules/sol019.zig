const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-019-variable-could-be-constant-or-immutable.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-019: variables that could be constant or immutable flagged" {
    const files = [_][]const u8{fix ++ "sol019-variable-const-immutable.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // maxSupply (constant), deadAddress (constant), owner (immutable)
    try std.testing.expectEqual(@as(usize, 3), count);
}

test "SOL-019: clean contract not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
