const std = @import("std");
const zlua = @import("zlua");
const ts = @import("tree-sitter");
const cfg = @import("languages/config.zig");
const graph = @import("graph.zig");
const ast_bridge = @import("ast_bridge.zig");
const walker = @import("walker.zig");
const output = @import("output.zig");
const diagnostics = @import("diagnostics.zig");

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
var g_diag: ?*diagnostics.Diagnostics = null;
var g_lang_config: ?*const cfg.LanguageConfig = null;

/// Rule metadata read from the Lua `rule` table.
pub const RuleMetadata = struct {
    id: []const u8,
    name: []const u8,
    severity: []const u8,
    confidence: []const u8, // "issue", "smell", or "pointer"
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
pub fn initLua(
    string_allocator: std.mem.Allocator,
    lua_allocator: std.mem.Allocator,
    g: *const graph.SymbolGraph,
    bridge: *ast_bridge.AstBridge,
    diag: ?*diagnostics.Diagnostics,
    lang_config: ?*const cfg.LanguageConfig,
) !*Lua {
    g_graph = g;
    g_bridge = bridge;
    g_allocator = string_allocator;
    g_hits = .empty;
    g_diag = diag;
    g_lang_config = lang_config;

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
    const confidence = g_allocator.dupe(u8, getStringField(lua, "confidence") orelse "smell") catch return error.OutOfMemory;
    const rule_type = g_allocator.dupe(u8, getStringField(lua, "type") orelse "scope") catch return error.OutOfMemory;
    const description = g_allocator.dupe(u8, getStringField(lua, "description") orelse "") catch return error.OutOfMemory;

    // max_depth
    _ = lua.getField(-1, "max_depth");
    const max_depth: u32 = if (lua.isInteger(-1))
        @intCast(lua.toInteger(-1) catch 5)
    else
        5;
    lua.pop(1);

    // Read languages array (optional)
    _ = lua.getField(-1, "languages");
    const languages: ?[]const []const u8 = if (lua.isTable(-1)) blk: {
        var lang_list: std.ArrayList([]const u8) = .empty;
        var idx: i32 = 1;
        while (true) {
            _ = lua.rawGetIndex(-1, idx);
            if (lua.isNil(-1)) {
                lua.pop(1);
                break;
            }
            const lang_str = lua.toString(-1) catch {
                lua.pop(1);
                idx += 1;
                continue;
            };
            const duped = g_allocator.dupe(u8, lang_str) catch {
                lua.pop(1);
                idx += 1;
                continue;
            };
            lang_list.append(g_allocator, duped) catch {
                g_allocator.free(duped);
                lua.pop(1);
                idx += 1;
                continue;
            };
            lua.pop(1);
            idx += 1;
        }
        break :blk if (lang_list.items.len > 0)
            lang_list.toOwnedSlice(g_allocator) catch null
        else
            null;
    } else null;
    lua.pop(1); // pop languages field

    lua.pop(1); // pop rule table

    return .{
        .id = id,
        .name = name,
        .severity = severity,
        .confidence = confidence,
        .rule_type = rule_type,
        .max_depth = max_depth,
        .description = description,
        .languages = languages,
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
    diag: ?*diagnostics.Diagnostics,
) ![]output.Hit {
    g_graph = g;
    g_bridge = bridge;
    g_allocator = allocator;
    g_hits = .empty;
    g_diag = diag;
    g_lang_config = lang_config;
    g_hook_warned = false;

    const cb = walker.WalkCallback{
        .enter_fn = &luaEnterCallback,
        .exit_fn = &luaExitCallback,
        .finalize_fn = &luaFinalizeCallback,
    };

    // Store lua pointer for callbacks
    g_lua = lua;

    if (std.mem.eql(u8, metadata.rule_type, "deep")) {
        try walker.walkDeep(g, cb, metadata.max_depth, lang_config, allocator);
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
    diag: ?*diagnostics.Diagnostics,
    lang_config: ?*const cfg.LanguageConfig,
) ![]output.Hit {
    g_graph = g;
    g_bridge = bridge;
    g_allocator = allocator;
    g_hits = .empty;
    g_diag = diag;
    g_lang_config = lang_config;
    g_lua = lua;

    _ = lua.getGlobal("check") catch return &.{};
    if (!lua.isFunction(-1)) {
        lua.pop(1);
        return &.{};
    }
    lua.protectedCall(.{ .args = 0, .results = 1 }) catch {
        if (g_diag) |d| d.warn("lua", "check() threw an error", .{});
    };

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
var g_hook_warned: bool = false;

fn luaFinalizeCallback() void {
    _ = g_lua.getGlobal("finalize") catch return;
    if (!g_lua.isFunction(-1)) {
        g_lua.pop(1);
        return;
    }
    g_lua.protectedCall(.{ .args = 0, .results = 0 }) catch {
        if (g_diag) |d| d.warn("lua", "finalize() threw an error", .{});
    };
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

    g_lua.protectedCall(.{ .args = 2, .results = 0 }) catch {
        if (!g_hook_warned) {
            if (g_diag) |d| d.warn("lua", "{s}() hook threw an error (further errors suppressed)", .{hook_name});
            g_hook_warned = true;
        }
    };
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
    if (g_graph.nodeText(node)) |text| {
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

// ── Lua API Registry (single source of truth) ────────────────────────
//
// Each binding carries a signature + one-line doc. `registerNamespace`
// installs the functions into a Lua table; `aud api` iterates the same
// arrays to print a reference. Adding a new Lua function here forces
// you to add its doc — no drift between code and skill docs.

pub const ApiBinding = struct {
    name: [:0]const u8,
    signature: []const u8,
    doc: []const u8,
    c_fn: zlua.CFn,
};

fn bind(comptime name: [:0]const u8, comptime signature: []const u8, comptime doc: []const u8, comptime f: anytype) ApiBinding {
    return .{ .name = name, .signature = signature, .doc = doc, .c_fn = zlua.wrap(f) };
}

pub const graph_api = [_]ApiBinding{
    bind("get_nodes_by_kind", "(kind) -> [node]",
        "All graph nodes of the given kind (see language_info().node_kinds).",
        luaGraphGetNodesByKind),
    bind("get_node", "(id) -> node | nil",
        "Look up a graph node by id.",
        luaGraphGetNode),
    bind("get_property", "(id, key) -> string | nil",
        "Read a node property (e.g., visibility, mutability). See language_info().properties.",
        luaGraphGetProperty),
    bind("get_outgoing_edges", "(id, ?ref_kind) -> [{to, kind, target_name, call_site_line, target_kind}]",
        "Outgoing refs from a node, optionally filtered by ref_kind.",
        luaGraphGetOutgoingEdges),
    bind("get_incoming_edges", "(id, ?ref_kind) -> [{from, kind, target_name, call_site_line, target_kind}]",
        "Incoming refs to a node, optionally filtered by ref_kind.",
        luaGraphGetIncomingEdges),
    bind("get_children", "(id) -> [node]",
        "Direct containment children (e.g., functions inside a contract).",
        luaGraphGetChildren),
    bind("get_parent", "(id) -> node | nil",
        "Parent container, or nil if none.",
        luaGraphGetParent),
    bind("get_callers", "(id) -> [node]",
        "Distinct callers of a callable.",
        luaGraphGetCallers),
    bind("get_callees", "(id) -> [node]",
        "Distinct callees of a callable.",
        luaGraphGetCallees),
    bind("get_refs", "(id, ?ref_kind) -> [{ref_id, from, kind, target_name, targets, gap, site_line}]",
        "All refs originating from a node (full ref shape, not edge summary).",
        luaGraphGetRefs),
    bind("ref_at", "(ast_handle) -> ref | nil",
        "Resolved reference at this call-expression AST node, or nil if no ref is recorded there.",
        luaGraphRefAt),
    bind("get_inheritance_parents", "(id) -> [node]",
        "Direct inheritance parents (one level; walk recursively for full chain).",
        luaGraphGetInheritanceParents),
    bind("language_info", "() -> {language, node_kinds, ref_kinds, properties}",
        "Vocabulary for the current language: valid node kinds, ref kinds, property keys.",
        luaGraphLanguageInfo),
    bind("find_in_scope", "(container_id, name, ts_type) -> ast_handle | nil",
        "Walk the container's MRO looking for a direct AST child of ts_type whose name matches.",
        luaGraphFindInScope),
    bind("exists_in_scope", "(container_id, name, ts_type) -> boolean",
        "Existence variant of find_in_scope.",
        luaGraphExistsInScope),
};

fn registerNamespace(lua: *Lua, name: [:0]const u8, bindings: []const ApiBinding) void {
    lua.createTable(0, @intCast(bindings.len));
    for (bindings) |b| {
        lua.pushFunction(b.c_fn);
        lua.setField(-2, b.name);
    }
    lua.setGlobal(name);
}

// ── graph.* API Registration (§6.3) ──────────────────────────────────

fn registerGraphApi(lua: *Lua) void {
    registerNamespace(lua, "graph", &graph_api);
}

fn luaGraphGetNodesByKind(lua: *Lua) i32 {
    const kind_str = lua.toString(1) catch return 0;
    const kind = std.meta.stringToEnum(graph.NodeKind, kind_str) orelse {
        if (g_diag) |d| d.warn("graph_api", "graph.get_nodes_by_kind: unknown kind '{s}'; valid: file, container, callable", .{kind_str});
        lua.createTable(0, 0);
        return 1;
    };

    const nodes = g_graph.getNodesByKind(kind, g_allocator) catch {
        if (g_diag) |d| d.err("graph_api", "graph.get_nodes_by_kind: allocation failed", .{});
        lua.createTable(0, 0);
        return 1;
    };
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

/// graph.ref_at(handle) — find the Reference whose ast_node matches the given AST handle.
/// Returns {kind, target_name, call_site_line, target_kind?} or nil.
fn luaGraphRefAt(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const node = g_bridge.getNode(handle) orelse {
        lua.pushNil();
        return 1;
    };
    for (g_graph.refs.items) |ref| {
        const an = ref.ast_node orelse continue;
        if (!an.eql(node)) continue;
        lua.createTable(0, 4);
        _ = lua.pushString(@tagName(ref.kind));
        lua.setField(-2, "kind");
        pushRefAttrs(lua, ref);
        return 1;
    }
    lua.pushNil();
    return 1;
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

/// graph.find_in_scope(container_id, name, ts_type) -> ?handle
/// Walks the container's full MRO and scans each scope's body for a direct AST
/// child of `ts_type` whose `name` field text matches. Returns an AST handle or nil.
fn luaGraphFindInScope(lua: *Lua) i32 {
    const cid: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const name = lua.toString(2) catch return 0;
    const ts_type = lua.toString(3) catch return 0;
    if (g_graph.findInScope(cid, name, ts_type)) |node| {
        const handle = g_bridge.pushNode(node) catch {
            lua.pushNil();
            return 1;
        };
        lua.pushInteger(@intCast(handle));
    } else {
        lua.pushNil();
    }
    return 1;
}

/// graph.exists_in_scope(container_id, name, ts_type) -> bool
fn luaGraphExistsInScope(lua: *Lua) i32 {
    const cid: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const name = lua.toString(2) catch return 0;
    const ts_type = lua.toString(3) catch return 0;
    lua.pushBoolean(g_graph.existsInScope(cid, name, ts_type));
    return 1;
}

fn luaGraphGetInheritanceParents(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const parents = g_graph.getResolvedInheritanceTargets(id, g_allocator) catch return 0;
    defer g_allocator.free(parents);

    lua.createTable(@intCast(parents.len), 0);
    for (parents, 0..) |parent_id, i| {
        if (g_graph.lookupNode(parent_id)) |parent| {
            pushGraphNodeTable(lua, parent);
            lua.rawSetIndex(-2, @intCast(i + 1));
        }
    }
    return 1;
}

/// graph.language_info() -> {language, node_kinds, ref_kinds, properties}
fn luaGraphLanguageInfo(lua: *Lua) i32 {
    const lc = g_lang_config orelse {
        if (g_diag) |d| d.warn("graph_api", "graph.language_info: language config not available", .{});
        lua.pushNil();
        return 1;
    };

    lua.createTable(0, 4);

    // language name
    _ = lua.pushString(@tagName(lc.language));
    lua.setField(-2, "language");

    // node_kinds — comptime iterate NodeKind enum
    {
        const fields = @typeInfo(graph.NodeKind).@"enum".fields;
        lua.createTable(@intCast(fields.len), 0);
        inline for (fields, 0..) |f, i| {
            _ = lua.pushString(f.name);
            lua.rawSetIndex(-2, @intCast(i + 1));
        }
        lua.setField(-2, "node_kinds");
    }

    // ref_kinds — comptime iterate RefKind enum
    {
        const fields = @typeInfo(graph.RefKind).@"enum".fields;
        lua.createTable(@intCast(fields.len), 0);
        inline for (fields, 0..) |f, i| {
            _ = lua.pushString(f.name);
            lua.rawSetIndex(-2, @intCast(i + 1));
        }
        lua.setField(-2, "ref_kinds");
    }

    // properties — collect unique keys from all config mapping arrays
    {
        lua.createTable(0, 0);
        var idx: i32 = 1;
        var seen: [32][]const u8 = undefined;
        var seen_count: usize = 0;

        pushUniquePropertyKeys(lua, lc.containers, &seen, &seen_count, &idx);
        pushUniquePropertyKeys(lua, lc.callables, &seen, &seen_count, &idx);
        lua.setField(-2, "properties");
    }

    return 1;
}

/// Iterate all mappings in a config array, push unique property keys onto the Lua table at stack top.
fn pushUniquePropertyKeys(lua: *Lua, mappings: anytype, seen: *[32][]const u8, seen_count: *usize, idx: *i32) void {
    for (mappings) |m| {
        for (m.properties) |prop| {
            var found = false;
            for (seen[0..seen_count.*]) |s| {
                if (std.mem.eql(u8, s, prop.key)) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                if (seen_count.* < seen.len) {
                    seen[seen_count.*] = prop.key;
                    seen_count.* += 1;
                }
                _ = lua.pushString(prop.key);
                lua.rawSetIndex(-2, idx.*);
                idx.* += 1;
            }
        }
    }
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

pub const ast_api = [_]ApiBinding{
    bind("node", "(graph_node_id) -> ast_handle",
        "AST handle for the root of a graph node's syntax tree.",
        luaAstNode),
    bind("children", "(handle) -> [ast_handle]",
        "All direct children, including anonymous nodes.",
        luaAstChildren),
    bind("named_children", "(handle) -> [ast_handle]",
        "Direct named children only (anonymous nodes skipped).",
        luaAstNamedChildren),
    bind("child", "(handle, index) -> ast_handle | nil",
        "Child at the given zero-based index, or nil if out of bounds.",
        luaAstChild),
    bind("child_by_field", "(handle, field_name) -> ast_handle | nil",
        "Child matching the tree-sitter field name (e.g., \"left\", \"condition\").",
        luaAstChildByField),
    bind("parent", "(handle) -> ast_handle | nil",
        "Parent node, or nil if at the root.",
        luaAstParent),
    bind("next_sibling", "(handle) -> ast_handle | nil",
        "Next sibling in the parent's child list.",
        luaAstNextSibling),
    bind("prev_sibling", "(handle) -> ast_handle | nil",
        "Previous sibling in the parent's child list.",
        luaAstPrevSibling),
    bind("type", "(handle) -> string",
        "Tree-sitter node type (interned; cheap to compare).",
        luaAstType),
    bind("text", "(handle) -> string",
        "Source text for the node. Slow for large subtrees — prefer type checks when possible.",
        luaAstText),
    bind("find", "(handle, type_name) -> [ast_handle]",
        "Recursive descendant search for nodes of the given type, in document order.",
        luaAstFind),
    bind("find_in_container", "(container_id, type_name) -> [ast_handle]",
        "Recursive search within a container's body for nodes of the given type.",
        luaAstFindInContainer),
    bind("find_all", "(type_name) -> [ast_handle]",
        "File-wide search across the current file for nodes of the given type.",
        luaAstFindAll),
    bind("unwrap", "(handle, context) -> ast_handle",
        "Strip grammar wrappers for a given context (receiver|callee|name|property).",
        luaAstUnwrap),
    bind("start_line", "(handle) -> number",
        "1-indexed start line of the node.",
        luaAstStartLine),
    bind("end_line", "(handle) -> number",
        "1-indexed end line of the node.",
        luaAstEndLine),
    bind("is_named", "(handle) -> boolean",
        "True if the node is named (not an anonymous punctuation/keyword token).",
        luaAstIsNamed),
    bind("file", "(handle) -> string | nil",
        "Source file path for the node's AST, or nil if unknown.",
        luaAstFile),
};

fn registerAstApi(lua: *Lua) void {
    registerNamespace(lua, "ast", &ast_api);
}

// ── ast.* wrapper helpers ────────────────────────────────────────────
// Collapse the ~18 ast.* wrappers into thin calls. Each bridge method
// returns one of four shapes; helpers push the result onto the Lua stack.

fn pushOptHandle(lua: *Lua, result: anyerror!?u32) i32 {
    const v = result catch return 0;
    if (v) |h| lua.pushInteger(@intCast(h)) else lua.pushNil();
    return 1;
}

fn pushHandleList(lua: *Lua, result: anyerror![]u32) i32 {
    const handles = result catch return 0;
    defer g_bridge.allocator.free(handles);
    lua.createTable(@intCast(handles.len), 0);
    for (handles, 0..) |h, i| {
        lua.pushInteger(@intCast(h));
        lua.rawSetIndex(-2, @intCast(i + 1));
    }
    return 1;
}

fn pushOptU32(lua: *Lua, v: ?u32) i32 {
    if (v) |x| lua.pushInteger(@intCast(x)) else lua.pushNil();
    return 1;
}

fn pushOptBool(lua: *Lua, v: ?bool) i32 {
    if (v) |b| lua.pushBoolean(b) else lua.pushNil();
    return 1;
}

fn pushOptStr(lua: *Lua, v: ?[]const u8) i32 {
    if (v) |s| _ = lua.pushString(s) else lua.pushNil();
    return 1;
}

fn luaAstNode(lua: *Lua) i32 {
    const id: u64 = @bitCast(lua.toInteger(1) catch return 0);
    return pushOptHandle(lua, g_bridge.nodeFromGraph(id));
}

fn luaAstChildren(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushHandleList(lua, g_bridge.children(handle));
}

fn luaAstNamedChildren(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushHandleList(lua, g_bridge.namedChildren(handle));
}

fn luaAstChild(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const index: u32 = @intCast(lua.toInteger(2) catch return 0);
    return pushOptHandle(lua, g_bridge.childAt(handle, index));
}

fn luaAstChildByField(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const field = lua.toString(2) catch return 0;
    return pushOptHandle(lua, g_bridge.childByField(handle, field));
}

fn luaAstParent(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushOptHandle(lua, g_bridge.parentOf(handle));
}

fn luaAstNextSibling(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushOptHandle(lua, g_bridge.nextSibling(handle));
}

fn luaAstPrevSibling(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushOptHandle(lua, g_bridge.prevSibling(handle));
}

fn luaAstType(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushOptStr(lua, g_bridge.nodeType(handle));
}

fn luaAstText(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushOptStr(lua, g_bridge.textOf(handle));
}

fn luaAstFind(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const type_name = lua.toString(2) catch return 0;
    return pushHandleList(lua, g_bridge.findDescendants(handle, type_name));
}

fn luaAstFindInContainer(lua: *Lua) i32 {
    const cid: u64 = @bitCast(lua.toInteger(1) catch return 0);
    const type_name = lua.toString(2) catch return 0;
    return pushHandleList(lua, g_bridge.findInContainer(cid, type_name));
}

fn luaAstFindAll(lua: *Lua) i32 {
    const type_name = lua.toString(1) catch return 0;
    return pushHandleList(lua, g_bridge.findAll(type_name));
}

/// ast.unwrap(handle, context) -> ?string
/// Follows the language's unwrap_table for the given context ("receiver",
/// "callee", "name", "property") to the terminal identifier and returns its text.
fn luaAstUnwrap(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    const ctx_str = lua.toString(2) catch return 0;
    const context = std.meta.stringToEnum(cfg.UnwrapContext, ctx_str) orelse {
        if (g_diag) |d| d.warn("ast_api", "ast.unwrap: unknown context '{s}'; valid: receiver, callee, name, property", .{ctx_str});
        lua.pushNil();
        return 1;
    };
    const lc = g_lang_config orelse return pushOptStr(lua, null);
    const node = g_bridge.getNode(handle) orelse return pushOptStr(lua, null);
    const source = g_graph.sourceForNode(node) orelse return pushOptStr(lua, null);
    return pushOptStr(lua, cfg.unwrap(node, source, lc, context));
}

fn luaAstStartLine(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushOptU32(lua, g_bridge.startLine(handle));
}

fn luaAstEndLine(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushOptU32(lua, g_bridge.endLine(handle));
}

fn luaAstIsNamed(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushOptBool(lua, g_bridge.isNamed(handle));
}

fn luaAstFile(lua: *Lua) i32 {
    const handle: u32 = @intCast(lua.toInteger(1) catch return 0);
    return pushOptStr(lua, g_bridge.fileOf(handle));
}

// ── report.* API Registration (§6.5) ─────────────────────────────────

pub const report_api = [_]ApiBinding{
    bind("hit", "({file, line, node_text})",
        "Record a rule finding. Rule metadata (id, name, severity) is attached automatically.",
        luaReportHit),
    bind("warn", "(message)",
        "Emit a diagnostic warning. Appears in the diagnostics section, separate from findings.",
        luaReportWarn),
};

fn registerReportApi(lua: *Lua) void {
    registerNamespace(lua, "report", &report_api);
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

/// report.warn(message) — emit a diagnostic warning from a rule
fn luaReportWarn(lua: *Lua) i32 {
    const msg = lua.toString(1) catch return 0;
    if (g_diag) |d| d.warn("rule", "{s}", .{msg});
    return 0;
}
