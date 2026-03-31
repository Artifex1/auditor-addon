const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-007-missing-mapping-named-parameters.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-007: unnamed mapping parameters flagged" {
    const files = [_][]const u8{fix ++ "sol007-mapping-params.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // balances (no names), partial (missing value name), nested outer level — all flagged
    try std.testing.expect(count >= 2);
}

test "SOL-007: named mapping parameters not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
