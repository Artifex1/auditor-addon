const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/GEN-001-constant-not-cap.lua";
const fix = "tests/solidity/fixtures/";

test "GEN-001: non-UPPER_CASE constants and immutables flagged" {
    const files = [_][]const u8{fix ++ "gen001-constant-not-cap.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // maxFee, DefaultTimeout (file-level constants)
    try std.testing.expectEqual(@as(usize, 2), count);
}

test "GEN-001: correctly cased constants not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
