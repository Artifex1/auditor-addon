const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-002-reentrancy.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-002: state write after external call flagged" {
    const files = [_][]const u8{fix ++ "Reentrancy.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // withdrawVulnerable: balances[msg.sender] -= amount; after msg.sender.call
    // withdrawNested: balances[msg.sender] -= amount; after _doTransfer() (nested external call)
    try std.testing.expectEqual(@as(usize, 2), count);
}
