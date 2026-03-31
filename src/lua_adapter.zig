const std = @import("std");
const zlua = @import("zlua");
const ts = @import("tree-sitter");
const cfg = @import("languages/config.zig");
const graph = @import("graph.zig");
const ast_bridge = @import("ast_bridge.zig");
const walker = @import("walker.zig");
const output = @import("output.zig");

const Lua = zlua.Lua;

// ── SPEC.md §6 — Lua Rule Interface ──────────────────────────────────
//
// Each rule is loaded into its own Lua state. The Zig side registers
// graph.*, ast.*, and report.* tables. Rules define enter/exit/check hooks.

/// Global state accessible from Lua C functions.
/// Set before each rule execution, cleared after.
var g_graph: *const graph.SymbolGraph = undefined;
var g_bridge: *ast_bridge.AstBridge = undefined;
var g_allocator: std.mem.Allocator = undefined;
var g_hits: std.ArrayList(output.Hit) = .empty;

/// Rule metadata read from the Lua `rule` table.
pub const RuleMetadata = struct {
    id: []const u8,
    name: []const u8,
    severity: []const u8,
    rule_type: []const u8, // "scope", "deep", or "map"
    max_depth: u32,
    description: []const u8,
    languages: ?[]const []const u8,
};

/// A loaded rule ready for execution.
pub const LoadedRule = struct {
    lua: *Lua,
    metadata: RuleMetadata,
};

/// Initialize a Lua state with graph.*, ast.*, and report.* APIs registered.
/// Initialize Lua with registered APIs.
/// `string_allocator` owns strings that outlive Lua (hits, metadata).
/// `lua_allocator` owns the Lua VM and bridge internals.
pub fn initLua(string_allocator: std.mem.Allocator, lua_allocator: std.mem.Allocator, g: *const graph.SymbolGraph, bridge: *ast_bridge.AstBridge) !*Lua {
    g_graph = g;
    g_bridge = bridge;
    g_allocator = string_allocator;
    g_hits = .empty;

    const lua = try Lua.init(lua_allocator);
    lua.openLibs();

    // Register graph.* table (§6.3)
    registerGraphApi(lua);

    // Register ast.* table (§6.4)
    registerAstApi(lua);

    // Register report.* table (§6.5)
    registerReportApi(lua);

    return lua;
}

/// Load a rule from a file path. Returns metadata.
pub fn loadRuleFile(lua: *Lua, path: []const u8) !RuleMetadata {
    // doFile expects a null-terminated string
    var buf: [4096]u8 = undefined;
    const z_path = std.fmt.bufPrintZ(&buf, "{s}", .{path}) catch return error.PathTooLong;
    lua.doFile(z_path) catch return error.RuleLoadFailed;
    return readRuleMetadata(lua);
}

/// Load a rule from inline Lua code.
pub fn loadRuleInline(lua: *Lua, code: []const u8) !RuleMetadata {
    var buf: [65536]u8 = undefined;
    const z_code = std.fmt.bufPrintZ(&buf, "{s}", .{code}) catch return error.CodeTooLong;
    lua.doString(z_code) catch return error.RuleLoadFailed;
    return readRuleMetadata(lua);
}

/// Read the `rule` table from Lua to extract metadata (§6.1).
fn readRuleMetadata(lua: *Lua) !RuleMetadata {
    _ = lua.getGlobal("rule") catch return error.NoRuleTable;
    if (!lua.isTable(-1)) {
        lua.pop(1);
        return error.NoRuleTable;
    }

    // Dupe strings from Lua into g_allocator so they outlive the Lua state
    const id = g_allocator.dupe(u8, getStringField(lua, "id") orelse "unknown") catch return error.OutOfMemory;
    const name = g_allocator.dupe(u8, getStringField(lua, "name") orelse "unnamed") catch return error.OutOfMemory;
    const severity = g_allocator.dupe(u8, getStringField(lua, "severity") orelse "info") catch return error.OutOfMemory;
    const rule_type = g_allocator.dupe(u8, getStringField(lua, "type") orelse "scope") catch return error.OutOfMemory;
    const description = g_allocator.dupe(u8, getStringField(lua, "description") orelse "") catch return error.OutOfMemory;

    // max_depth
    _ = lua.getField(-1, "max_depth");
    const max_depth: u32 = if (lua.isInteger(-1))
        @intCast(lua.toInteger(-1) catch 5)
    else
        5;
    lua.pop(1);

    // TODO: read languages array

    lua.pop(1); // pop rule table

    return .{
        .id = id,
        .name = name,
        .severity = severity,
        .rule_type = rule_type,
        .max_depth = max_depth,
        .description = description,
        .languages = null,
    };
}

fn getStringField(lua: *Lua, field: [:0]const u8) ?[]const u8 {
    _ = lua.getField(-1, field);
    const val = lua.toString(-1) catch null;
    lua.pop(1);
    return val;
}

/// Execute a visitor rule (scope or deep) against the graph.
/// Returns collected hits.
pub fn executeVisitorRule(
    lua: *Lua,
    g: *const graph.SymbolGraph,
    metadata: RuleMetadata,
    bridge: *ast_bridge.AstBridge,
    lang_config: *const cfg.LanguageConfig,
    allocator: std.mem.Allocator,
) ![]output.Hit {
    g_graph = g;
    g_bridge = bridge;
    g_allocator = allocator;
    g_hits = .empty;

    const cb = walker.WalkCallback{
        .enter_fn = &luaEnterCallback,
        .exit_fn = &luaExitCallback,
        .finalize_fn = &luaFinalizeCallback,
    };

    // Store lua pointer for callbacks
    g_lua = lua;

    if (std.mem.eql(u8, metadata.rule_type, "deep")) {
        const mod_type = if (lang_config.modifier_invocation) |mi| mi.ts_type else null;
        try walker.walkDeep(g, cb, metadata.max_depth, lang_config.call_expression.ts_type, mod_type, allocator);
    } else {
        walker.walkScope(g, cb);
    }

    // Clear AST handles between rules (§7)
    bridge.clear();

    return try g_hits.toOwnedSlice(allocator);
}

/// Execute a map rule (§6.2). Calls check() and returns hits.
pub fn executeMapRule(
    lua: *Lua,
    g: *const graph.SymbolGraph,
    bridge: *ast_bridge.AstBridge,
    allocator: std.mem.Allocator,
) ![]output.Hit {
    g_graph = g;
    g_bridge = bridge;
    g_allocator = allocator;
    g_hits = .empty;
    g_lua = lua;

    _ = lua.getGlobal("check") catch return &.{};
    if (!lua.isFunction(-1)) {
        lua.pop(1);
        return &.{};
    }
    lua.protectedCall(.{ .args = 0, .results = 1 }) catch {};

    // Collect findings from return table (check() may return a table OR call report.hit())
    if (lua.isTable(-1)) {
        var i: i32 = 1;
        while (true) {
            _ = lua.rawGetIndex(-1, i);
            if (lua.isNil(-1)) {
                lua.pop(1);
                break;
            }
            if (lua.isTable(-1)) {
                _ = lua.getField(-1, "file");
                const file_raw = lua.toString(-1) catch "";
                lua.pop(1);

                _ = lua.getField(-1, "line");
                const line: u32 = if (lua.isInteger(-1))
                    @intCast(lua.toInteger(-1) catch 0)
                else
                    0;
                lua.pop(1);

                _ = lua.getField(-1, "node_text");
                const text_raw = lua.toString(-1) catch "";
                lua.pop(1);

                const file = allocator.dupe(u8, file_raw) catch {
                    lua.pop(1);
                    i += 1;
                    continue;
                };
                const node_text = allocator.dupe(u8, text_raw) catch {
                    allocator.free(file);
                    lua.pop(1);
                    i += 1;
                    continue;
                };
                g_hits.append(allocator, .{
                    .file = file,
                    .line = line,
                    .node_text = node_text,
                }) catch {};
            }
            lua.pop(1); // pop finding entry
            i += 1;
        }
    }
    lua.pop(1); // pop return value (table or nil)

    bridge.clear();

    return try g_hits.toOwnedSlice(allocator);
}

// ── Walker Callbacks ─────────────────────────────────────────────────

var g_lua: *Lua = undefined;

fn luaFinalizeCallback() void {
    _ = g_lua.getGlobal("finalize") catch return;
    if (!g_lua.isFunction(-1)) {
        g_lua.pop(1);
        return;
    }
    g_lua.protectedCall(.{ .args = 0, .results = 0 }) catch {};
}

fn luaEnterCallback(node: ts.Node, ctx: walker.WalkContext) void {
    callLuaHook("enter", node, ctx);
}

fn luaExitCallback(node: ts.Node, ctx: walker.WalkContext) void {
    callLuaHook("exit", node, ctx);
}

fn callLuaHook(hook_name: [:0]const u8, node: ts.Node, ctx: walker.WalkContext) void {
    // Ensure enough stack space for function + 2 tables + fields
    g_lua.checkStack(20) catch return;

    _ = g_lua.getGlobal(hook_name) catch return;
    if (!g_lua.isFunction(-1)) {
        g_lua.pop(1);
        return;
    }

    // Push node table: {kind, line, file, name, handle}
    pushAstNodeTable(node, ctx);

    // Push context table: {depth, current_file, current_node}
    pushContextTable(ctx);

    g_lua.protectedCall(.{ .args = 2, .results = 0 }) catch {};
}

fn pushAstNodeTable(node: ts.Node, ctx: walker.WalkContext) void {
    g_lua.createTable(0, 6);

    // kind (tree-sitter node type)
    _ = g_lua.pushString(node.kind());
    g_lua.setField(-2, "kind");

    // line (1-indexed)
    g_lua.pushInteger(@intCast(node.startPoint().row + 1));
    g_lua.setField(-2, "line");

    // file
    _ = g_lua.pushString(ctx.current_file);
    g_lua.setField(-2, "file");

    // name (node text, for context)
    if (g_bridge.nodeText(node)) |text| {
        // Truncate to first 100 chars to avoid huge strings
        const t = if (text.len > 100) text[0..100] else text;
        _ = g_lua.pushString(t);
    } else {
        _ = g_lua.pushString("");
    }
    g_lua.setField(-2, "name");

    // Register as AST handle so Lua can use ast.* on it
    const handle = g_bridge.pushNode(node) catch 0;
    g_lua.pushInteger(@intCast(handle));
    g_lua.setField(-2, "handle");
}

fn pushContextTable(ctx: walker.WalkContext) void {
    g_lua.createTable(0, 3);

    g_lua.pushInteger(@intCast(ctx.depth));
    g_lua.setField(-2, "depth");

    _ = g_lua.pushString(ctx.current_file);
    g_lua.setField(-2, "current_file");

    // Node IDs are u64 hashes — push as i64 (Lua 5.5 integers are 64-bit)
    g_lua.pushInteger(@bitCast(ctx.current_node));
    g_lua.setField(-2, "current_node");
}

// ── graph.* API Registration (§6.3) ──────────────────────────────────

fn registerGraphApi(lua: *Lua) void {
    lua.createTable(0, 10);

    lua.pushFunction(zlua.wrap(luaGraphGetNodesByKind));
    lua.setField(-2, "get_nodes_by_kind");

    lua.pushFunction(zlua.wrap(luaGraphGetNode));
    lua.setField(-2, "get_node");

    lua.pushFunction(zlua.wrap(luaGraphGetProperty));
    lua.setField(-2, "get_property");

    lua.pushFunction(zlua.wrap(luaGraphGetOutgoingEdges));
    lua.setField(-2, "get_outgoing_edges");

    lua.pushFunction(zlua.wrap(luaGraphGetIncomingEdges));
    lua.setField(-2, "get_incoming_edges");

    lua.pushFunction(zlua.wrap(luaGraphGetChildren));
    lua.setField(-2, "get_children");

    lua.pushFunction(zlua.wrap(luaGraphGetParent));
    lua.setField(-2, "get_parent");

    lua.pushFunction(zlua.wrap(luaGraphGetCallers));
    lua.setField(-2, "get_callers");

    lua.pushFunction(zlua.wrap(luaGraphGetCallees));
    lua.setField(-2, "get_callees");

    lua.pushFunction(zlua.wrap(luaGraphGetRefs));
    lua.setField(-2, "get_refs");

    lua.setGlobal("graph");
}

fn luaGraphGetNodesByKind(lua: *Lua) i32 {
    const kind_str = lua.toString(1) catch return 0;
    const kind = std.meta.stringToEnum(graph.NodeKind, kind_str) orelse return 0;

    const nodes = g_graph.getNodesByKind(kind, g_allocator) catch return 0;
    defer g_allocator.free(nodes);

    lua.createTable(@intCast(nodes.len), 0);
    for (nodes, 0..) |node, i| {
        pushGraphNodeTable(lua, node);
        lua.rawSetIndex(-2, @intCast(i + 1));
    }
    return 1;
}

fn luaGraphGetNode(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const node = g_graph.lookupNode(id) orelse {
        lua.pushNil();
        return 1;
    };
    pushGraphNodeTable(lua, node);
    return 1;
}

fn luaGraphGetProperty(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const key = lua.toString(2) catch return 0;
    const node = g_graph.lookupNode(id) orelse {
        lua.pushNil();
        return 1;
    };
    if (node.properties.get(key)) |val| {
        _ = lua.pushString(val);
    } else {
        lua.pushNil();
    }
    return 1;
}

fn pushRefAttrs(lua: *Lua, ref: graph.Reference) void {
    // target_name always available
    _ = lua.pushString(ref.target_name);
    lua.setField(-2, "target_name");

    // call_site_line from site
    lua.pushInteger(@intCast(ref.site.line));
    lua.setField(-2, "call_site_line");

    if (ref.target_kind) |tk| {
        _ = lua.pushString(@tagName(tk));
        lua.setField(-2, "target_kind");
    }
}

fn luaGraphGetOutgoingEdges(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const kind_filter: ?graph.RefKind = if (lua.isString(2))
        std.meta.stringToEnum(graph.RefKind, lua.toString(2) catch "")
    else
        null;

    const refs = g_graph.getOutgoingRefs(id, kind_filter, g_allocator) catch return 0;
    defer g_allocator.free(refs);

    lua.createTable(@intCast(refs.len), 0);
    for (refs, 0..) |ref, i| {
        lua.createTable(0, 6);
        if (ref.firstTarget()) |target_id| {
            lua.pushInteger(@bitCast(target_id));
        } else {
            lua.pushNil();
        }
        lua.setField(-2, "to");
        _ = lua.pushString(@tagName(ref.kind));
        lua.setField(-2, "kind");
        pushRefAttrs(lua, ref);
        lua.rawSetIndex(-2, @intCast(i + 1));
    }
    return 1;
}

/// graph.get_refs(id, ?kind) — all refs from a node, resolved or not.
/// Returns {target_name, call_site_line, kind, target_kind?} per ref.
fn luaGraphGetRefs(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const kind_filter: ?graph.RefKind = if (lua.isString(2))
        std.meta.stringToEnum(graph.RefKind, lua.toString(2) catch "")
    else
        null;

    const refs = g_graph.getAllRefsFrom(id, kind_filter, g_allocator) catch return 0;
    defer g_allocator.free(refs);

    lua.createTable(@intCast(refs.len), 0);
    for (refs, 0..) |ref, i| {
        lua.createTable(0, 5);
        _ = lua.pushString(@tagName(ref.kind));
        lua.setField(-2, "kind");
        pushRefAttrs(lua, ref);
        lua.rawSetIndex(-2, @intCast(i + 1));
    }
    return 1;
}

fn luaGraphGetIncomingEdges(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const kind_filter: ?graph.RefKind = if (lua.isString(2))
        std.meta.stringToEnum(graph.RefKind, lua.toString(2) catch "")
    else
        null;

    const refs = g_graph.getIncomingRefs(id, kind_filter, g_allocator) catch return 0;
    defer g_allocator.free(refs);

    lua.createTable(@intCast(refs.len), 0);
    for (refs, 0..) |ref, i| {
        lua.createTable(0, 6);
        lua.pushInteger(@bitCast(ref.from));
        lua.setField(-2, "from");
        _ = lua.pushString(@tagName(ref.kind));
        lua.setField(-2, "kind");
        pushRefAttrs(lua, ref);
        lua.rawSetIndex(-2, @intCast(i + 1));
    }
    return 1;
}

fn luaGraphGetChildren(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const children_ids = g_graph.getChildren(id);

    lua.createTable(@intCast(children_ids.len), 0);
    for (children_ids, 0..) |child_id, i| {
        if (g_graph.lookupNode(child_id)) |child| {
            pushGraphNodeTable(lua, child);
            lua.rawSetIndex(-2, @intCast(i + 1));
        }
    }
    return 1;
}

fn luaGraphGetParent(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const node = g_graph.lookupNode(id) orelse {
        lua.pushNil();
        return 1;
    };
    if (node.container) |container_id| {
        if (g_graph.lookupNode(container_id)) |parent| {
            pushGraphNodeTable(lua, parent);
            return 1;
        }
    }
    lua.pushNil();
    return 1;
}

fn luaGraphGetCallers(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const refs = g_graph.getIncomingRefs(id, .call, g_allocator) catch return 0;
    defer g_allocator.free(refs);

    lua.createTable(@intCast(refs.len), 0);
    for (refs, 0..) |ref, i| {
        if (g_graph.lookupNode(ref.from)) |caller| {
            pushGraphNodeTable(lua, caller);
            lua.rawSetIndex(-2, @intCast(i + 1));
        }
    }
    return 1;
}

fn luaGraphGetCallees(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const refs = g_graph.getOutgoingRefs(id, .call, g_allocator) catch return 0;
    defer g_allocator.free(refs);

    lua.createTable(@intCast(refs.len), 0);
    for (refs, 0..) |ref, i| {
        if (ref.firstTarget()) |target_id| {
            if (g_graph.lookupNode(target_id)) |callee| {
                pushGraphNodeTable(lua, callee);
                lua.rawSetIndex(-2, @intCast(i + 1));
            }
        }
    }
    return 1;
}

fn pushGraphNodeTable(lua: *Lua, node: *graph.GraphNode) void {
    lua.createTable(0, 6);

    lua.pushInteger(@bitCast(node.id));
    lua.setField(-2, "id");

    _ = lua.pushString(@tagName(node.kind));
    lua.setField(-2, "kind");

    _ = lua.pushString(node.name);
    lua.setField(-2, "name");

    _ = lua.pushString(node.qualified_name);
    lua.setField(-2, "qualified_name");

    if (node.visibility) |vis| {
        _ = lua.pushString(vis);
    } else {
        lua.pushNil();
    }
    lua.setField(-2, "visibility");

    if (node.locator) |loc| {
        lua.pushInteger(@intCast(loc.line));
        lua.setField(-2, "line");
        _ = lua.pushString(loc.file);
        lua.setField(-2, "file");
    }
}

// ── ast.* API Registration (§6.4) ────────────────────────────────────

fn registerAstApi(lua: *Lua) void {
    lua.createTable(0, 15);

    lua.pushFunction(zlua.wrap(luaAstNode));
    lua.setField(-2, "node");

    lua.pushFunction(zlua.wrap(luaAstChildren));
    lua.setField(-2, "children");

    lua.pushFunction(zlua.wrap(luaAstNamedChildren));
    lua.setField(-2, "named_children");

    lua.pushFunction(zlua.wrap(luaAstChild));
    lua.setField(-2, "child");

    lua.pushFunction(zlua.wrap(luaAstChildByField));
    lua.setField(-2, "child_by_field");

    lua.pushFunction(zlua.wrap(luaAstParent));
    lua.setField(-2, "parent");

    lua.pushFunction(zlua.wrap(luaAstNextSibling));
    lua.setField(-2, "next_sibling");

    lua.pushFunction(zlua.wrap(luaAstPrevSibling));
    lua.setField(-2, "prev_sibling");

    lua.pushFunction(zlua.wrap(luaAstType));
    lua.setField(-2, "type");

    lua.pushFunction(zlua.wrap(luaAstText));
    lua.setField(-2, "text");

    lua.pushFunction(zlua.wrap(luaAstFind));
    lua.setField(-2, "find");

    lua.pushFunction(zlua.wrap(luaAstStartLine));
    lua.setField(-2, "start_line");

    lua.pushFunction(zlua.wrap(luaAstEndLine));
    lua.setField(-2, "end_line");

    lua.pushFunction(zlua.wrap(luaAstIsNamed));
    lua.setField(-2, "is_named");

    lua.setGlobal("ast");
}

fn luaAstNode(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const handle = g_bridge.nodeFromGraph(g_graph, id) catch return 0;
    if (handle) |h| {
        lua.pushInteger(@intCast(h));
        return 1;
    }
    lua.pushNil();
    return 1;
}

fn luaAstChildren(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const handles = g_bridge.children(handle) catch return 0;
    defer g_bridge.allocator.free(handles);

    lua.createTable(@intCast(handles.len), 0);
    for (handles, 0..) |h, i| {
        lua.pushInteger(@intCast(h));
        lua.rawSetIndex(-2, @intCast(i + 1));
    }
    return 1;
}

fn luaAstNamedChildren(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const handles = g_bridge.namedChildren(handle) catch return 0;
    defer g_bridge.allocator.free(handles);

    lua.createTable(@intCast(handles.len), 0);
    for (handles, 0..) |h, i| {
        lua.pushInteger(@intCast(h));
        lua.rawSetIndex(-2, @intCast(i + 1));
    }
    return 1;
}

fn luaAstChild(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const index: u32 = @intCast(lua.toInteger(2) catch return 0);
    const h = g_bridge.childAt(handle, index) catch return 0;
    if (h) |val| {
        lua.pushInteger(@intCast(val));
    } else {
        lua.pushNil();
    }
    return 1;
}

fn luaAstChildByField(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const field = lua.toString(2) catch return 0;
    const h = g_bridge.childByField(handle, field) catch return 0;
    if (h) |val| {
        lua.pushInteger(@intCast(val));
    } else {
        lua.pushNil();
    }
    return 1;
}

fn luaAstParent(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const h = g_bridge.parentOf(handle) catch return 0;
    if (h) |val| {
        lua.pushInteger(@intCast(val));
    } else {
        lua.pushNil();
    }
    return 1;
}

fn luaAstNextSibling(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const h = g_bridge.nextSibling(handle) catch return 0;
    if (h) |val| {
        lua.pushInteger(@intCast(val));
    } else {
        lua.pushNil();
    }
    return 1;
}

fn luaAstPrevSibling(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const h = g_bridge.prevSibling(handle) catch return 0;
    if (h) |val| {
        lua.pushInteger(@intCast(val));
    } else {
        lua.pushNil();
    }
    return 1;
}

fn luaAstType(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    if (g_bridge.nodeType(handle)) |t| {
        _ = lua.pushString(t);
    } else {
        lua.pushNil();
    }
    return 1;
}

fn luaAstText(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    if (g_bridge.textOf(handle)) |t| {
        _ = lua.pushString(t);
    } else {
        lua.pushNil();
    }
    return 1;
}

fn luaAstFind(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const type_name = lua.toString(2) catch return 0;
    const handles = g_bridge.findDescendants(handle, type_name) catch return 0;
    defer g_bridge.allocator.free(handles);

    lua.createTable(@intCast(handles.len), 0);
    for (handles, 0..) |h, i| {
        lua.pushInteger(@intCast(h));
        lua.rawSetIndex(-2, @intCast(i + 1));
    }
    return 1;
}

fn luaAstStartLine(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    if (g_bridge.startLine(handle)) |line| {
        lua.pushInteger(@intCast(line));
    } else {
        lua.pushNil();
    }
    return 1;
}

fn luaAstEndLine(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    if (g_bridge.endLine(handle)) |line| {
        lua.pushInteger(@intCast(line));
    } else {
        lua.pushNil();
    }
    return 1;
}

fn luaAstIsNamed(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    if (g_bridge.isNamed(handle)) |named| {
        lua.pushBoolean(named);
    } else {
        lua.pushNil();
    }
    return 1;
}

// ── report.* API Registration (§6.5) ─────────────────────────────────

fn registerReportApi(lua: *Lua) void {
    lua.createTable(0, 1);

    lua.pushFunction(zlua.wrap(luaReportHit));
    lua.setField(-2, "hit");

    lua.setGlobal("report");
}

/// report.hit({file, line, node_text})
/// Strings are duped into g_allocator since Lua owns its string memory.
fn luaReportHit(lua: *Lua) i32 {
    if (!lua.isTable(1)) return 0;

    _ = lua.getField(1, "file");
    const file_raw = lua.toString(-1) catch "";
    lua.pop(1);

    _ = lua.getField(1, "line");
    const line: u32 = if (lua.isInteger(-1))
        @intCast(lua.toInteger(-1) catch 0)
    else
        0;
    lua.pop(1);

    _ = lua.getField(1, "node_text");
    const text_raw = lua.toString(-1) catch "";
    lua.pop(1);

    // Dupe strings — Lua GC will collect the originals after rule execution
    const file = g_allocator.dupe(u8, file_raw) catch return 0;
    const node_text = g_allocator.dupe(u8, text_raw) catch return 0;

    g_hits.append(g_allocator, .{
        .file = file,
        .line = line,
        .node_text = node_text,
    }) catch {};

    return 0;
}
