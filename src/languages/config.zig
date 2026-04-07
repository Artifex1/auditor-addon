const std = @import("std");
const ts = @import("tree-sitter");

// ── Language Enum ──────────────────────────────────────────────────────

pub const Language = enum {
    solidity,
    rust,
    go,
    python,
    javascript,
    typescript,
    tsx,
    java,
    cpp,
    cairo,
    move,
    masm,
    compact,
    noir,
    tolk,

    pub fn fromExtension(ext: []const u8) ?Language {
        const map = std.StaticStringMap(Language).initComptime(.{
            .{ ".sol", .solidity },
            .{ ".rs", .rust },
            .{ ".go", .go },
            .{ ".py", .python },
            .{ ".js", .javascript },
            .{ ".ts", .typescript },
            .{ ".tsx", .tsx },
            .{ ".java", .java },
            .{ ".cpp", .cpp },
            .{ ".cc", .cpp },
            .{ ".cxx", .cpp },
            .{ ".h", .cpp },
            .{ ".hpp", .cpp },
            .{ ".cairo", .cairo },
            .{ ".move", .move },
            .{ ".masm", .masm },
            .{ ".compact", .compact },
            .{ ".nr", .noir },
            .{ ".tolk", .tolk },
        });
        return map.get(ext);
    }

    pub fn grammarFn(self: Language) *const fn () callconv(.c) *const ts.Language {
        return switch (self) {
            .solidity => &grammars.tree_sitter_solidity,
            .rust => &grammars.tree_sitter_rust,
            .go => &grammars.tree_sitter_go,
            .python => &grammars.tree_sitter_python,
            .javascript => &grammars.tree_sitter_javascript,
            .typescript => &grammars.tree_sitter_typescript,
            .tsx => &grammars.tree_sitter_tsx,
            .java => &grammars.tree_sitter_java,
            .cpp => &grammars.tree_sitter_cpp,
            .cairo => &grammars.tree_sitter_cairo,
            .move => &grammars.tree_sitter_move_on_aptos,
            .masm => &grammars.tree_sitter_masm,
            .compact => &grammars.tree_sitter_compact,
            .noir => &grammars.tree_sitter_noir,
            .tolk => &grammars.tree_sitter_tolk,
        };
    }
};

const grammars = struct {
    extern fn tree_sitter_solidity() callconv(.c) *const ts.Language;
    extern fn tree_sitter_rust() callconv(.c) *const ts.Language;
    extern fn tree_sitter_go() callconv(.c) *const ts.Language;
    extern fn tree_sitter_python() callconv(.c) *const ts.Language;
    extern fn tree_sitter_javascript() callconv(.c) *const ts.Language;
    extern fn tree_sitter_typescript() callconv(.c) *const ts.Language;
    extern fn tree_sitter_tsx() callconv(.c) *const ts.Language;
    extern fn tree_sitter_java() callconv(.c) *const ts.Language;
    extern fn tree_sitter_cpp() callconv(.c) *const ts.Language;
    extern fn tree_sitter_cairo() callconv(.c) *const ts.Language;
    extern fn tree_sitter_move_on_aptos() callconv(.c) *const ts.Language;
    extern fn tree_sitter_masm() callconv(.c) *const ts.Language;
    extern fn tree_sitter_compact() callconv(.c) *const ts.Language;
    extern fn tree_sitter_noir() callconv(.c) *const ts.Language;
    extern fn tree_sitter_tolk() callconv(.c) *const ts.Language;
};

// ── Graph forward import (for custom handler signature) ────────────────

const graph = @import("../graph.zig");

// ── Config Structs ─────────────────────────────────────────────────────

pub const ContainerMapping = struct {
    ts_type: []const u8,
    name_field: []const u8,
    body_field: ?[]const u8, // null = no named body field; push unconditionally, pop when past node end
    properties: []const PropertyExtractor = &.{},
};

pub const CallableMapping = struct {
    ts_type: []const u8,
    name_field: ?[]const u8,
    body_field: ?[]const u8,
    properties: []const PropertyExtractor = &.{},
};

pub const VariableMapping = struct {
    ts_type: []const u8,
    name_field: []const u8,
    type_field: ?[]const u8 = null,
    properties: []const PropertyExtractor = &.{},
};

pub const ModifierMapping = struct {
    ts_type: []const u8,
    name_field: []const u8,
    body_field: ?[]const u8 = null,
    properties: []const PropertyExtractor = &.{},
};

pub const EventMapping = struct {
    ts_type: []const u8,
    name_field: []const u8,
    properties: []const PropertyExtractor = &.{},
};

pub const ErrorMapping = struct {
    ts_type: []const u8,
    name_field: []const u8,
    properties: []const PropertyExtractor = &.{},
};

pub const PropertyExtractor = struct {
    key: []const u8,
    child_type: []const u8,
};

pub const CallExpressionMapping = struct {
    ts_type: []const u8,
    function_field: []const u8,
};

pub const InheritanceMapping = struct {
    ts_type: []const u8,
    name_field: []const u8,
};

pub const ImportMapping = struct {
    ts_type: []const u8,
    path_field: []const u8,
};

pub const ModifierInvocationMapping = struct {
    ts_type: []const u8,
    name_field: []const u8,
};

pub const EmitMapping = struct {
    ts_type: []const u8,
    name_field: []const u8,
};

pub const WritePattern = struct {
    ts_type: []const u8,
    target_field: []const u8,
};

/// Which extraction site this rule applies to.
pub const UnwrapContext = enum {
    receiver, // strip wrapper node to reach the root identifier (write targets, receiver detection)
    callee,   // extract the callee name from a call expression node
    name,     // extract the callable/container name from a definition node
    property, // extract a property value from a property-container node
};

pub const UnwrapRule = struct {
    context: UnwrapContext,
    ts_type: []const u8,
    /// Follow this named field to reach the inner node. null = first named child.
    child_field: ?[]const u8 = null,
    /// Alternative to child_field: search all children (including anonymous tokens)
    /// for the first whose kind() matches any entry. Used for keyword tokens inside
    /// container nodes (e.g. "public"/"private"/"protected" inside Java `modifiers`).
    search_types: []const []const u8 = &.{},
};

pub const InheritanceStrategy = enum {
    c3_linearization,
    embedded_promotion,
    flat,
    single_chain,
};

pub const MetricsConfig = struct {
    branching_types: []const []const u8,
    comment_types: []const []const u8,
    normalization_types: []const []const u8,
    base_rate_per_day: u32,
};

pub const CustomHandlerFn = *const fn (*graph.SymbolGraph, ts.Node, []const u8) void;

pub const ResolveHookFn = *const fn (ref: *graph.Reference, g: *const graph.SymbolGraph, lang_config: *const LanguageConfig, allocator: std.mem.Allocator) void;

pub const LanguageConfig = struct {
    language: Language,

    // Node extraction
    containers: []const ContainerMapping,
    callables: []const CallableMapping,
    variables: []const VariableMapping,
    modifiers: []const ModifierMapping,
    events: []const EventMapping,
    errors: []const ErrorMapping = &.{},
    // Reference detection
    call_expression: CallExpressionMapping,
    inheritance: ?InheritanceMapping = null,
    modifier_invocation: ?ModifierInvocationMapping = null,
    emit_expression: ?EmitMapping = null,
    write_expressions: []const WritePattern,
    write_call_methods: []const []const u8 = &.{},

    // Import extraction
    imports: ?ImportMapping = null,

    // Inheritance resolution strategy
    inheritance_strategy: InheritanceStrategy,

    // Builtins to filter
    builtin_functions: []const []const u8 = &.{},
    builtin_receivers: []const []const u8 = &.{},

    // Unified unwrap table keyed by context (receiver, callee, name, property).
    // Replaces the former unwrap_rules + callee_unwrap_rules pair.
    unwrap_table: []const UnwrapRule = &.{},
    identifier_type: []const u8,

    // Custom handler for edge cases during walk
    custom_handler: ?CustomHandlerFn = null,

    // Language-specific resolve hook (§4.1) — called before default resolution
    resolve_hook: ?ResolveHookFn = null,

    // Metrics
    metrics: MetricsConfig,
};

// ── Config Lookup ──────────────────────────────────────────────────────

const solidity = @import("solidity.zig");
const rust = @import("rust.zig");
const go = @import("go.zig");
const python = @import("python.zig");
const javascript = @import("javascript.zig");
const typescript = @import("typescript.zig");
const tsx_lang = @import("tsx.zig");
const cairo = @import("cairo.zig");
const move_lang = @import("move.zig");
const noir = @import("noir.zig");
const cpp = @import("cpp.zig");
const java = @import("java.zig");
const tolk = @import("tolk.zig");
const masm = @import("masm.zig");
const compact = @import("compact.zig");

// ── Expression Unwrapping (§4.2) ─────────────────────────────────────

/// Walk unwrap_table rules for the given context to reach a terminal identifier.
/// Returns the text of the terminal node, or null if no match.
pub fn unwrap(node: ts.Node, source: []const u8, lang_config: *const LanguageConfig, context: UnwrapContext) ?[]const u8 {
    var current = node;
    while (true) {
        const node_type = current.kind();
        if (std.mem.eql(u8, node_type, lang_config.identifier_type)) {
            return source[current.startByte()..current.endByte()];
        }
        // Leaf named node (e.g. field_identifier) — treat as terminal
        if (current.namedChildCount() == 0 and current.startByte() < current.endByte()) {
            return source[current.startByte()..current.endByte()];
        }
        var matched = false;
        for (lang_config.unwrap_table) |rule| {
            if (rule.context != context) continue;
            if (std.mem.eql(u8, node_type, rule.ts_type)) {
                current = if (rule.child_field) |f|
                    current.childByFieldName(f) orelse return null
                else
                    current.namedChild(0) orelse return null;
                matched = true;
                break;
            }
        }
        if (!matched) return null;
    }
}

pub fn getConfig(lang: Language) *const LanguageConfig {
    return switch (lang) {
        .solidity => &solidity.config,
        .rust => &rust.config,
        .go => &go.config,
        .python => &python.config,
        .javascript => &javascript.config,
        .typescript => &typescript.config,
        .tsx => &tsx_lang.config,
        .cairo => &cairo.config,
        .move => &move_lang.config,
        .noir => &noir.config,
        .cpp => &cpp.config,
        .java => &java.config,
        .tolk => &tolk.config,
        .masm => &masm.config,
        .compact => &compact.config,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────

test "Language.fromExtension maps common extensions" {
    const testing = @import("std").testing;
    try testing.expectEqual(Language.solidity, Language.fromExtension(".sol").?);
    try testing.expectEqual(Language.rust, Language.fromExtension(".rs").?);
    try testing.expectEqual(Language.python, Language.fromExtension(".py").?);
    try testing.expectEqual(Language.typescript, Language.fromExtension(".ts").?);
    try testing.expectEqual(Language.tsx, Language.fromExtension(".tsx").?);
    try testing.expectEqual(Language.cpp, Language.fromExtension(".cpp").?);
    try testing.expectEqual(Language.cpp, Language.fromExtension(".h").?);
    try testing.expectEqual(Language.cairo, Language.fromExtension(".cairo").?);
    try testing.expectEqual(Language.noir, Language.fromExtension(".nr").?);
    try testing.expect(Language.fromExtension(".unknown") == null);
    try testing.expect(Language.fromExtension("") == null);
}

test "getConfig returns valid config for solidity" {
    const lc = getConfig(.solidity);
    const testing = @import("std").testing;
    try testing.expectEqual(Language.solidity, lc.language);
    try testing.expect(lc.containers.len > 0);
    try testing.expect(lc.callables.len > 0);
    try testing.expect(lc.metrics.base_rate_per_day > 0);
}
