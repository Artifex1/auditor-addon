const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-013-state-update-no-event.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-013: state update without event flagged" {
    const files = [_][]const u8{fix ++ "sol013-state-update-no-event.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // increment() and setOwner() write state without emitting events
    try std.testing.expectEqual(@as(usize, 2), count);
}
