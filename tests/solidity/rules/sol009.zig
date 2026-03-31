const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-009-calldata-instead-of-memory.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-009: external memory parameters flagged" {
    const files = [_][]const u8{fix ++ "sol009-calldata-memory.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // processBytes(bytes memory) and processString(string memory) are flagged
    try std.testing.expect(count >= 2);
}

test "SOL-009: calldata and non-external not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
