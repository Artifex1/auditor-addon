const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-006-natspec-missing.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-006: undocumented flagged, @inheritdoc suppressed" {
    const files = [_][]const u8{fix ++ "sol006-natspec.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // increment (missing NatSpec) + getCounter (missing @return) = 2
    // reset and value have @inheritdoc and are NOT flagged
    try std.testing.expectEqual(@as(usize, 2), count);
}

test "SOL-006: fully documented functions not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
