const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-004-use-custom-errors.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-004: require/revert with strings flagged" {
    const files = [_][]const u8{fix ++ "sol004-use-custom-errors.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // 3 flagged: withdrawString (require+string), revertString (revert+string), withdrawNoMessage (require no msg)
    try std.testing.expect(count >= 3);
}

test "SOL-004: custom errors not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
