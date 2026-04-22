const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-003-floating-pragma.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-003: floating pragma flagged" {
    const files = [_][]const u8{fix ++ "sol003-floating-pragma.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expect(count > 0);
}

test "SOL-003: pinned pragma not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
