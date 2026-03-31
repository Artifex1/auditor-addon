const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-008-non-explicit-imports.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-008: bare and aliased imports flagged" {
    const files = [_][]const u8{fix ++ "sol008-imports.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // "./Token.sol" and "./Utils.sol" as Alias are flagged; explicit {IERC20} and * as Lib are not
    try std.testing.expect(count >= 2);
}

test "SOL-008: explicit imports not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
