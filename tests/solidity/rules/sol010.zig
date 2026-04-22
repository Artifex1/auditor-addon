const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-010-state-var-visibility-not-explicit.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-010: implicit state var visibility flagged" {
    const files = [_][]const u8{fix ++ "sol010-state-visibility.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // implicitInternal and implicitOwner are flagged
    try std.testing.expect(count >= 2);
}

test "SOL-010: explicit state var visibility not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
