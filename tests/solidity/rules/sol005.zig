const std = @import("std");
const h = @import("./helpers.zig");

const rule = "src/rules/SOL-005-lack-of-security-contact.lua";
const fix = "tests/solidity/fixtures/";

test "SOL-005: contracts without security contact flagged" {
    const files = [_][]const u8{fix ++ "sol005-security-contact.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    // NoSecurityContact is flagged; WithSecurityContact is not
    try std.testing.expect(count > 0);
}

test "SOL-005: contract with security contact not flagged" {
    const files = [_][]const u8{fix ++ "RulesClean.sol"};
    const count = try h.countRuleHits(std.testing.allocator, &files, rule);
    try std.testing.expectEqual(@as(usize, 0), count);
}
