const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-001-unchecked-call.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-001: unchecked .call/.send/.delegatecall flagged" {
    const files = [_][]const u8{fix ++ "sol001-unchecked-call.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // uncheckedCall, uncheckedSend, uncheckedDelegatecall
    try std.testing.expectEqual(@as(usize, 3), count);
}

test "SOL-001: checked calls not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
