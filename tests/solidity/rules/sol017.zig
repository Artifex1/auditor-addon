const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-017-unused-event.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-017: unused events flagged" {
    const files = [_][]const u8{fix ++ "sol017-unused-event.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // Stale and Deprecated are never emitted
    try std.testing.expectEqual(@as(usize, 2), count);
}

test "SOL-017: clean contract not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
