/// Shipped rules embedded at compile time.
/// Each entry contains the rule ID, filename, and Lua source.
/// Add new rules here when they are ready to ship.

pub const ShippedRule = struct {
    id: []const u8,
    filename: []const u8,
    source: []const u8,
};

pub const all = [_]ShippedRule{
    .{
        .id = "SOL-002",
        .filename = "SOL-002-reentrancy.lua",
        .source = @embedFile("SOL-002-reentrancy.lua"),
    },
};
