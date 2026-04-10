/// Shared helpers for per-rule Solidity integration tests.
const std = @import("std");
const aud = @import("aud");

const pipeline = aud.pipeline;
const cfg = aud.cfg;
const lua_adapter = aud.lua_adapter;
const ast_bridge_mod = aud.ast_bridge;

/// Run a Lua rule file against the given fixture files.
/// `rule_path` is relative to the project root (CWD when tests run).
/// Returns the total number of hits produced by the rule.
pub fn countRuleHits(
    allocator: std.mem.Allocator,
    files: []const []const u8,
    rule_path: []const u8,
) !usize {
    // Build symbol graph
    const pipe = try allocator.create(pipeline.Pipeline);
    pipe.* = try pipeline.Pipeline.init(allocator, cfg.getConfig(.solidity));
    defer {
        pipe.deinit();
        allocator.destroy(pipe);
    }
    try pipe.run(files, false);

    // AST bridge delegates to graph for source text lookups
    var bridge = ast_bridge_mod.AstBridge.init(allocator, &pipe.graph);
    defer bridge.deinit();

    // Arena for Lua VM and transient rule data
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const aa_alloc = arena.allocator();

    const lua = try lua_adapter.initLua(aa_alloc, aa_alloc, &pipe.graph, &bridge, null, pipe.lang_config);
    defer lua.deinit();

    // Load rule from file (path is relative to project root = CWD during tests)
    const metadata = try lua_adapter.loadRuleFile(lua, rule_path);

    const hits = if (std.mem.eql(u8, metadata.rule_type, "map"))
        try lua_adapter.executeMapRule(lua, &pipe.graph, &bridge, aa_alloc, null, pipe.lang_config)
    else
        try lua_adapter.executeVisitorRule(lua, &pipe.graph, metadata, &bridge, pipe.lang_config, aa_alloc, null);

    return hits.len;
}
