const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-027-sibling-override.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-027: flags virtual functions overridden by 2+ children" {
    const files = [_][]const u8{fix ++ "sol027-sibling-override.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // _compute and _hook are each overridden by both ChildA and ChildB
    try std.testing.expectEqual(@as(usize, 2), count);
}

test "SOL-027: single child does not fire" {
    // SingleChild alone inherits Base — only 1 override per function, no finding
    // Plain has no virtual functions — no finding
    // (fixture includes both, but the positive cases from ChildA/ChildB are excluded
    //  by running on a clean fixture without the multi-child scenario)
    const files = [_][]const u8{fix ++ "Inheritance.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
