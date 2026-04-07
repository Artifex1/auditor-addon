const std = @import("std");
const h = @import("./helpers.zig");

const fix = "tests/solidity/fixtures/";

test "MAP-002: super call does not cause false positive on override" {
    const rule = "src/rules/MAP-002-unused-function.lua";
    const files = [_][]const u8{fix ++ "SuperCall.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // SuperChild._hook is override of called virtual → NOT flagged
    // SuperBase._hook is called by run() → NOT flagged
    // SuperBase._doAction is called by performAction via super → NOT flagged
    try std.testing.expectEqual(@as(usize, 0), count);
}

test "SOL-013: super call with event emission not flagged" {
    const rule = "src/rules/SOL-013-state-update-no-event.lua";
    const files = [_][]const u8{fix ++ "SuperCall.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // performAction writes state but super._doAction emits event → NOT flagged
    // run() doesn't write state → NOT flagged
    try std.testing.expectEqual(@as(usize, 0), count);
}
