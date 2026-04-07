const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/MAP-002-unused-function.lua";
const fix = "tests/solidity/fixtures/";

test "MAP-002: unused internal/private functions flagged" {
    const files = [_][]const u8{fix ++ "map002-unused-function.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // _deadPrivate, _deadInternal, _noOneCallsMe = 3 (Child._hook is NOT flagged: override of called virtual)
    try std.testing.expectEqual(@as(usize, 3), count);
}

test "MAP-002: clean contract not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
