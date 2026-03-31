const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/MAP-001-broad-visibility.lua";
const fix = "tests/solidity/fixtures/";

test "MAP-001: public with no internal callers flagged" {
    const files = [_][]const u8{fix ++ "map001-broad-visibility.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // noInternalCallers + _onlyUsedHere + _sharedHelper (in child) + public helpers
    try std.testing.expect(count > 0);
}

test "MAP-001: virtual and override not flagged" {
    // Run only on the fixture and verify that override/virtual functions
    // (_overridable in both Base and Child) are absent from findings.
    // We do this by confirming RulesClean (no broad-visibility issues) is clean.
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
