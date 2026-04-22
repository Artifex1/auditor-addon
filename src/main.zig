const std = @import("std");
const ts = @import("tree-sitter");
const clap = @import("clap");

// Public re-exports for integration tests (imported via "aud" module)
pub const cfg = @import("languages/config.zig");
pub const graph = @import("graph.zig");
pub const pipeline = @import("pipeline.zig");
pub const output = @import("output.zig");
pub const resolution = @import("resolution.zig");
pub const metrics = @import("metrics.zig");
pub const peek = @import("peek.zig");
pub const call_chains = @import("call_chains.zig");
pub const lua_adapter = @import("lua_adapter.zig");
pub const ast_bridge = @import("ast_bridge.zig");
pub const diagnostics = @import("diagnostics.zig");

const glob = @import("glob.zig");
const shipped_rules = @import("rules/shipped.zig");

// ── Subcommands (SPEC.md §10) ─────────────────────────────────────────

const SubCommand = enum {
    peek,
    metrics,
    gaps,
    run,
    @"call-chains",
    graph,
    info,
    api,
    help,
};

const main_cmd_parsers = .{
    .command = clap.parsers.enumeration(SubCommand),
};

const main_params = clap.parseParamsComptime(
    \\-h, --help  Display this help and exit.
    \\<command>
    \\
);

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var iter = try std.process.argsWithAllocator(allocator);
    defer iter.deinit();

    // Skip executable name
    _ = iter.next();

    var diag = clap.Diagnostic{};
    var res = clap.parseEx(clap.Help, &main_params, main_cmd_parsers, &iter, .{
        .diagnostic = &diag,
        .allocator = allocator,
        .terminating_positional = 0,
    }) catch |err| {
        try diag.reportToFile(std.fs.File.stderr(), err);
        return;
    };
    defer res.deinit();

    if (res.args.help != 0) {
        try printMainHelp();
        return;
    }

    const command = res.positionals[0] orelse {
        try printMainHelp();
        return;
    };

    switch (command) {
        .peek => try cmdPeek(allocator, &iter),
        .metrics => try cmdMetrics(allocator, &iter),
        .gaps => try cmdGaps(allocator, &iter),
        .run => try cmdRun(allocator, &iter),
        .@"call-chains" => try cmdCallChains(allocator, &iter),
        .graph => try cmdGraph(allocator, &iter),
        .info => try cmdInfo(&iter),
        .api => try cmdApi(),
        .help => try printMainHelp(),
    }
}

fn printMainHelp() !void {
    var buf: [4096]u8 = undefined;
    var w = std.fs.File.stderr().writer(&buf);
    try w.interface.writeAll(
        \\Usage: aud <command> [options] <glob...>
        \\
        \\Commands:
        \\  peek          Extract function signatures
        \\  metrics       Calculate code metrics (nLOC, complexity, effort)
        \\  gaps          Build symbol graph, output unresolved edge gaps
        \\  run           Build symbol graph, run rules, output findings
        \\  call-chains   Map caller->callee chains from entry points
        \\  graph         Build symbol graph, dump nodes and edges
        \\  info          List language config (node types, properties)
        \\  api           Print the Lua rule API reference (graph.*, ast.*, report.*)
        \\  help          Show this help
        \\
        \\File arguments accept glob patterns: "src/**/*.sol"
        \\
    );
    try w.interface.flush();
}

// ── Clap param definitions per subcommand ─────────────────────────────

const peek_params = clap.parseParamsComptime(
    \\-h, --help                Display this help and exit.
    \\    --language <str>      Force language (auto-detected from extension otherwise).
    \\    --json                JSON output instead of TOON.
    \\    --no-tests            Exclude test-annotated code from analysis.
    \\<str>...
    \\
);

const metrics_params = clap.parseParamsComptime(
    \\-h, --help                Display this help and exit.
    \\    --language <str>      Force language (auto-detected from extension otherwise).
    \\    --json                JSON output instead of TOON.
    \\    --no-tests            Exclude test-annotated code from analysis.
    \\<str>...
    \\
);

const gaps_params = clap.parseParamsComptime(
    \\-h, --help                Display this help and exit.
    \\    --language <str>      Force language (auto-detected from extension otherwise).
    \\    --json                JSON output instead of TOON.
    \\    --resolutions <str>   Apply resolution CSV file.
    \\    --no-expand           Skip import-driven file expansion.
    \\    --no-tests            Exclude test-annotated code from analysis.
    \\    --kind <str>          Filter gaps by edge kind (calls, inherits, imports, ...).
    \\    --priority <str>      Filter gaps by priority (high, medium, low).
    \\<str>...
    \\
);

const run_params = clap.parseParamsComptime(
    \\-h, --help                Display this help and exit.
    \\    --language <str>      Force language (auto-detected from extension otherwise).
    \\    --json                JSON output instead of TOON.
    \\    --resolutions <str>   Apply resolution CSV file.
    \\    --no-tests            Exclude test-annotated code from analysis.
    \\    --rule <str>...       Run specific shipped rule(s) only.
    \\    --rule-path <str>...  Run adhoc rule(s) from .lua file or glob.
    \\    --rule-inline <str>   Run adhoc rule from inline Lua string.
    \\    --confidence <str>... Filter by confidence (issue, smell, pointer).
    \\<str>...
    \\
);

const call_chains_params = clap.parseParamsComptime(
    \\-h, --help                Display this help and exit.
    \\    --language <str>      Force language (auto-detected from extension otherwise).
    \\    --json                JSON output instead of TOON.
    \\    --resolutions <str>   Apply resolution CSV file.
    \\    --no-tests            Exclude test-annotated code from analysis.
    \\    --root <str>...       Start from specific function(s).
    \\    --max-depth <usize>   Limit chain depth (default: 10).
    \\<str>...
    \\
);

const graph_params = clap.parseParamsComptime(
    \\-h, --help                Display this help and exit.
    \\    --language <str>      Force language (auto-detected from extension otherwise).
    \\    --json                JSON output instead of TOON.
    \\    --resolutions <str>   Apply resolution CSV file.
    \\    --no-tests            Exclude test-annotated code from analysis.
    \\    --format <str>        Output format: toon, json (default: toon).
    \\<str>...
    \\
);

// ── Glob expansion helper ─────────────────────────────────────────────

fn expandPositionals(positionals: anytype, allocator: std.mem.Allocator) ![]const []const u8 {
    var patterns: std.ArrayList([]const u8) = .empty;
    defer patterns.deinit(allocator);

    for (positionals) |pos| {
        try patterns.append(allocator, pos);
    }

    if (patterns.items.len == 0) return &.{};
    return glob.expandAll(patterns.items, allocator);
}

// ── Command Implementations ───────────────────────────────────────────

fn cmdPeek(allocator: std.mem.Allocator, iter: anytype) !void {
    var diag = clap.Diagnostic{};
    var res = clap.parseEx(clap.Help, &peek_params, clap.parsers.default, iter, .{
        .diagnostic = &diag,
        .allocator = allocator,
    }) catch |err| {
        try diag.reportToFile(std.fs.File.stderr(), err);
        return;
    };
    defer res.deinit();

    if (res.args.help != 0) {
        try clap.helpToFile(std.fs.File.stderr(), clap.Help, &peek_params, .{});
        return;
    }

    const use_json = res.args.json != 0;
    const no_tests = res.args.@"no-tests" != 0;
    const forced_lang = if (res.args.language) |l| std.meta.stringToEnum(cfg.Language, l) else null;

    const files = try expandPositionals(res.positionals[0], allocator);
    defer freeExpandedFiles(files, allocator);

    if (files.len == 0) {
        try stderrPrint("aud peek: no files specified\n");
        return;
    }

    // Use an arena for all peek allocations — single bulk free at the end
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var all_sigs: std.ArrayList(output.FileSignatures) = .empty;

    for (files) |file_path| {
        const lang = forced_lang orelse detectLanguage(file_path) orelse continue;
        const lang_config = cfg.getConfig(lang);
        const test_markers: []const cfg.TestMarker = if (no_tests) lang_config.test_markers else &.{};
        const source = try readFileContents(file_path, allocator);
        defer allocator.free(source);

        const parser = ts.Parser.create();
        defer parser.destroy();
        try parser.setLanguage(lang.grammarFn()());

        const tree = parser.parseString(source, null) orelse continue;
        defer tree.destroy();

        const sigs = try peek.extractSignatures(tree, source, lang_config, file_path, aa, test_markers);
        var sig_texts: std.ArrayList([]const u8) = .empty;
        for (sigs) |s| {
            try sig_texts.append(aa, s.text);
        }

        try all_sigs.append(aa, .{
            .file = file_path,
            .signatures = try sig_texts.toOwnedSlice(aa),
        });
    }

    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);
    if (use_json) {
        try output.writeJsonSignatures(all_sigs.items, &w.interface);
    } else {
        try output.writeToonSignatures(all_sigs.items, &w.interface);
    }
    try w.interface.flush();
}

fn cmdMetrics(allocator: std.mem.Allocator, iter: anytype) !void {
    var diag = clap.Diagnostic{};
    var res = clap.parseEx(clap.Help, &metrics_params, clap.parsers.default, iter, .{
        .diagnostic = &diag,
        .allocator = allocator,
    }) catch |err| {
        try diag.reportToFile(std.fs.File.stderr(), err);
        return;
    };
    defer res.deinit();

    if (res.args.help != 0) {
        try clap.helpToFile(std.fs.File.stderr(), clap.Help, &metrics_params, .{});
        return;
    }

    const use_json = res.args.json != 0;
    const no_tests = res.args.@"no-tests" != 0;
    const forced_lang = if (res.args.language) |l| std.meta.stringToEnum(cfg.Language, l) else null;

    const files = try expandPositionals(res.positionals[0], allocator);
    defer freeExpandedFiles(files, allocator);

    if (files.len == 0) {
        try stderrPrint("aud metrics: no files specified\n");
        return;
    }

    var all_metrics: std.ArrayList(output.FileMetricsOutput) = .empty;
    defer all_metrics.deinit(allocator);

    for (files) |file_path| {
        const lang = forced_lang orelse detectLanguage(file_path) orelse continue;
        const lang_config = cfg.getConfig(lang);
        const test_markers: []const cfg.TestMarker = if (no_tests) lang_config.test_markers else &.{};
        const source = try readFileContents(file_path, allocator);
        defer allocator.free(source);

        const parser = ts.Parser.create();
        defer parser.destroy();
        try parser.setLanguage(lang.grammarFn()());

        const tree = parser.parseString(source, null) orelse continue;
        defer tree.destroy();

        const m = metrics.computeMetrics(tree, source, lang_config.metrics, test_markers);

        try all_metrics.append(allocator, .{
            .file = file_path,
            .nloc = m.nloc,
            .cognitive_complexity = m.cognitive_complexity,
            .complexity_per_100 = m.complexity_per_100,
            .comment_density = m.comment_density,
            .estimated_hours = m.estimated_hours,
        });
    }

    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);
    if (use_json) {
        try output.writeJsonMetrics(all_metrics.items, &w.interface);
    } else {
        try output.writeToonMetrics(all_metrics.items, &w.interface);
    }
    try w.interface.flush();
}

fn cmdGaps(allocator: std.mem.Allocator, iter: anytype) !void {
    var diag = clap.Diagnostic{};
    var res = clap.parseEx(clap.Help, &gaps_params, clap.parsers.default, iter, .{
        .diagnostic = &diag,
        .allocator = allocator,
    }) catch |err| {
        try diag.reportToFile(std.fs.File.stderr(), err);
        return;
    };
    defer res.deinit();

    if (res.args.help != 0) {
        try clap.helpToFile(std.fs.File.stderr(), clap.Help, &gaps_params, .{});
        return;
    }

    const use_json = res.args.json != 0;
    const forced_lang = if (res.args.language) |l| std.meta.stringToEnum(cfg.Language, l) else null;
    const no_expand = res.args.@"no-expand" != 0;
    const no_tests = res.args.@"no-tests" != 0;

    const files = try expandPositionals(res.positionals[0], allocator);
    defer freeExpandedFiles(files, allocator);

    if (files.len == 0) {
        try stderrPrint("aud gaps: no files specified\n");
        return;
    }

    const groups = try groupFilesByLanguage(files, forced_lang, allocator, null);
    defer {
        for (groups) |g| allocator.free(g.files);
        allocator.free(groups);
    }

    if (groups.len == 0) {
        try stderrPrint("aud gaps: no files with recognized language\n");
        return;
    }

    var res_diag = resolution.ResolutionDiag.init(allocator);
    defer res_diag.deinit();

    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);

    for (groups) |group| {
        const lang_config = cfg.getConfig(group.language);
        var pipe = try pipeline.Pipeline.init(allocator, lang_config);
        defer pipe.deinit();
        if (no_tests) pipe.test_markers = lang_config.test_markers;

        try pipe.run(group.files, no_expand);
        pipe.graph.scoped_files = &pipe.scoped_files;

        if (res.args.resolutions) |res_path| {
            try applyResolutionFile(&pipe, res_path, allocator, &res_diag);
        }

        if (use_json) {
            try output.writeJsonGaps(&pipe.graph, &w.interface);
        } else {
            try output.writeToonGaps(&pipe.graph, &w.interface);
        }
    }

    if (res_diag.hasDiagnostics() or res_diag.resolved_count > 0) {
        if (use_json) {
            try output.writeJsonResolutionDiag(&res_diag, &w.interface);
        } else {
            try output.writeToonResolutionDiag(&res_diag, &w.interface);
        }
    }
    try w.interface.flush();
}

fn cmdRun(allocator: std.mem.Allocator, iter: anytype) !void {
    var diag = clap.Diagnostic{};
    var res = clap.parseEx(clap.Help, &run_params, clap.parsers.default, iter, .{
        .diagnostic = &diag,
        .allocator = allocator,
    }) catch |err| {
        try diag.reportToFile(std.fs.File.stderr(), err);
        return;
    };
    defer res.deinit();

    if (res.args.help != 0) {
        try clap.helpToFile(std.fs.File.stderr(), clap.Help, &run_params, .{});
        return;
    }

    const forced_lang = if (res.args.language) |l| std.meta.stringToEnum(cfg.Language, l) else null;
    const use_json = res.args.json != 0;
    const no_tests = res.args.@"no-tests" != 0;

    const files = try expandPositionals(res.positionals[0], allocator);
    defer freeExpandedFiles(files, allocator);

    if (files.len == 0) {
        try stderrPrint("aud run: no files specified\n");
        return;
    }

    // Tool diagnostics accumulator (shared across all languages)
    var tool_diag = diagnostics.Diagnostics.init(allocator);
    defer tool_diag.deinit();

    // Group files by detected language
    const groups = try groupFilesByLanguage(files, forced_lang, allocator, &tool_diag);
    defer {
        for (groups) |g| allocator.free(g.files);
        allocator.free(groups);
    }

    if (groups.len == 0) {
        try stderrPrint("aud run: no files with recognized language\n");
        return;
    }

    // Apply resolutions if provided (shared across languages)
    var res_diag = resolution.ResolutionDiag.init(allocator);
    defer res_diag.deinit();

    // Arena for all rule execution allocations (Lua string dups, hits, metadata)
    var rule_arena = std.heap.ArenaAllocator.init(allocator);
    defer rule_arena.deinit();
    const ra = rule_arena.allocator();

    // Collect all findings across languages and rules
    var all_findings: std.ArrayList(output.Finding) = .empty;

    // Per-language pipeline execution
    const has_adhoc = res.args.@"rule-path".len > 0 or res.args.@"rule-inline" != null;

    for (groups) |group| {
        const lang_config = cfg.getConfig(group.language);
        var pipe = try pipeline.Pipeline.init(allocator, lang_config);
        if (no_tests) pipe.test_markers = lang_config.test_markers;
        defer pipe.deinit();
        try pipe.run(group.files, false);
        pipe.graph.scoped_files = &pipe.scoped_files;

        // Apply resolutions per pipeline
        if (res.args.resolutions) |res_path| {
            try applyResolutionFile(&pipe, res_path, allocator, &res_diag);
        }

        // AST bridge per pipeline
        var bridge = ast_bridge.AstBridge.init(allocator, &pipe.graph);
        defer bridge.deinit();

        // Execute rules (adhoc or shipped, filtered by language)
        if (res.args.@"rule-path".len > 0) {
            const rule_files = try expandPositionals(res.args.@"rule-path", allocator);
            defer freeExpandedFiles(rule_files, allocator);
            for (rule_files) |rule_path| {
                try executeRule(ra, allocator, &pipe.graph, &bridge, lang_config, rule_path, null, &all_findings, &tool_diag, group.language);
            }
        }

        if (res.args.@"rule-inline") |rule_code| {
            try executeRule(ra, allocator, &pipe.graph, &bridge, lang_config, null, rule_code, &all_findings, &tool_diag, group.language);
        }

        if (!has_adhoc) {
            const rule_filter = res.args.rule;
            for (&shipped_rules.all) |shipped| {
                if (rule_filter.len > 0) {
                    var matched = false;
                    for (rule_filter) |filter| {
                        if (std.mem.eql(u8, shipped.id, filter)) {
                            matched = true;
                            break;
                        }
                    }
                    if (!matched) continue;
                }
                try executeRule(ra, allocator, &pipe.graph, &bridge, lang_config, null, shipped.source, &all_findings, &tool_diag, group.language);
            }
        }
    }

    // Apply --confidence filter
    const confidence_filter = res.args.confidence;
    const findings_slice = if (confidence_filter.len > 0) blk: {
        var filtered: std.ArrayList(output.Finding) = .empty;
        for (all_findings.items) |f| {
            for (confidence_filter) |cf| {
                if (std.mem.eql(u8, f.confidence, cf)) {
                    try filtered.append(ra, f);
                    break;
                }
            }
        }
        break :blk filtered.items;
    } else all_findings.items;

    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);
    if (tool_diag.hasDiagnostics()) {
        if (use_json) {
            try output.writeJsonDiagnostics(&tool_diag, &w.interface);
        } else {
            try output.writeToonDiagnostics(&tool_diag, &w.interface);
        }
    }
    if (res_diag.hasDiagnostics() or res_diag.resolved_count > 0) {
        if (use_json) {
            try output.writeJsonResolutionDiag(&res_diag, &w.interface);
        } else {
            try output.writeToonResolutionDiag(&res_diag, &w.interface);
        }
    }
    if (use_json) {
        try output.writeJsonFindings(findings_slice, &w.interface);
    } else {
        try output.writeToonFindings(findings_slice, &w.interface);
    }
    try w.interface.flush();
}

fn executeRule(
    arena_alloc: std.mem.Allocator, // for strings/hits that outlive Lua
    lua_alloc: std.mem.Allocator, // for Lua VM and bridge internals
    g: *graph.SymbolGraph,
    bridge: *ast_bridge.AstBridge,
    lang_config: *const cfg.LanguageConfig,
    rule_path: ?[]const u8,
    rule_code: ?[]const u8,
    all_findings: *std.ArrayList(output.Finding),
    diag: ?*diagnostics.Diagnostics,
    current_language: cfg.Language,
) !void {
    const lua = try lua_adapter.initLua(arena_alloc, lua_alloc, g, bridge, diag, lang_config);
    defer lua.deinit();

    // Load rule
    const metadata = if (rule_path) |path|
        try lua_adapter.loadRuleFile(lua, path)
    else if (rule_code) |code|
        try lua_adapter.loadRuleInline(lua, code)
    else
        return;

    // Language filter: skip rule if its languages list doesn't include current language
    if (metadata.languages) |langs| {
        const lang_name = @tagName(current_language);
        var matched = false;
        for (langs) |l| {
            if (std.mem.eql(u8, l, lang_name)) {
                matched = true;
                break;
            }
        }
        if (!matched) return;
    }

    // Execute based on rule type
    const hits = if (std.mem.eql(u8, metadata.rule_type, "map"))
        try lua_adapter.executeMapRule(lua, g, bridge, arena_alloc, diag, lang_config)
    else
        try lua_adapter.executeVisitorRule(lua, g, metadata, bridge, lang_config, arena_alloc, diag);

    if (hits.len > 0) {
        try all_findings.append(arena_alloc, .{
            .rule_id = metadata.id,
            .severity = metadata.severity,
            .confidence = metadata.confidence,
            .name = metadata.name,
            .hits = hits,
        });
    }
}

fn cmdCallChains(allocator: std.mem.Allocator, iter: anytype) !void {
    var diag = clap.Diagnostic{};
    var res = clap.parseEx(clap.Help, &call_chains_params, clap.parsers.default, iter, .{
        .diagnostic = &diag,
        .allocator = allocator,
    }) catch |err| {
        try diag.reportToFile(std.fs.File.stderr(), err);
        return;
    };
    defer res.deinit();

    if (res.args.help != 0) {
        try clap.helpToFile(std.fs.File.stderr(), clap.Help, &call_chains_params, .{});
        return;
    }

    const use_json = res.args.json != 0;
    const forced_lang = if (res.args.language) |l| std.meta.stringToEnum(cfg.Language, l) else null;
    const no_tests = res.args.@"no-tests" != 0;
    const max_depth: u32 = if (res.args.@"max-depth") |d| @intCast(d) else 10;

    const root_filter: ?[]const []const u8 = if (res.args.root.len > 0)
        res.args.root
    else
        null;

    const files = try expandPositionals(res.positionals[0], allocator);
    defer freeExpandedFiles(files, allocator);

    if (files.len == 0) {
        try stderrPrint("aud call-chains: no files specified\n");
        return;
    }

    const groups = try groupFilesByLanguage(files, forced_lang, allocator, null);
    defer {
        for (groups) |g| allocator.free(g.files);
        allocator.free(groups);
    }

    if (groups.len == 0) {
        try stderrPrint("aud call-chains: no files with recognized language\n");
        return;
    }

    var res_diag = resolution.ResolutionDiag.init(allocator);
    defer res_diag.deinit();

    var output_roots: std.ArrayList(output.RootChains) = .empty;
    defer output_roots.deinit(allocator);

    for (groups) |group| {
        const lang_config = cfg.getConfig(group.language);
        var pipe = try pipeline.Pipeline.init(allocator, lang_config);
        defer pipe.deinit();
        if (no_tests) pipe.test_markers = lang_config.test_markers;

        try pipe.run(group.files, false);
        pipe.graph.scoped_files = &pipe.scoped_files;

        if (res.args.resolutions) |res_path| {
            try applyResolutionFile(&pipe, res_path, allocator, &res_diag);
        }

        const chain_results = try call_chains.computeCallChains(&pipe.graph, root_filter, max_depth, allocator);
        defer call_chains.freeCallChains(chain_results, allocator);

        for (chain_results) |cs| {
            var chain_strs: std.ArrayList([]const u8) = .empty;
            for (cs.chains.items) |chain| {
                const formatted = try call_chains.formatChain(chain, allocator);
                try chain_strs.append(allocator, formatted);
            }
            try output_roots.append(allocator, .{
                .root_name = try allocator.dupe(u8, cs.root_name),
                .chains = try chain_strs.toOwnedSlice(allocator),
            });
        }
    }

    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);
    if (res_diag.hasDiagnostics() or res_diag.resolved_count > 0) {
        if (use_json) {
            try output.writeJsonResolutionDiag(&res_diag, &w.interface);
        } else {
            try output.writeToonResolutionDiag(&res_diag, &w.interface);
        }
    }
    if (use_json) {
        try output.writeJsonCallChains(output_roots.items, &w.interface);
    } else {
        try output.writeToonCallChains(output_roots.items, &w.interface);
    }
    try w.interface.flush();
}

fn cmdGraph(allocator: std.mem.Allocator, iter: anytype) !void {
    var diag = clap.Diagnostic{};
    var res = clap.parseEx(clap.Help, &graph_params, clap.parsers.default, iter, .{
        .diagnostic = &diag,
        .allocator = allocator,
    }) catch |err| {
        try diag.reportToFile(std.fs.File.stderr(), err);
        return;
    };
    defer res.deinit();

    if (res.args.help != 0) {
        try clap.helpToFile(std.fs.File.stderr(), clap.Help, &graph_params, .{});
        return;
    }

    const use_json = if (res.args.format) |fmt|
        std.mem.eql(u8, fmt, "json")
    else
        res.args.json != 0;
    const forced_lang = if (res.args.language) |l| std.meta.stringToEnum(cfg.Language, l) else null;
    const no_tests = res.args.@"no-tests" != 0;

    const files = try expandPositionals(res.positionals[0], allocator);
    defer freeExpandedFiles(files, allocator);

    if (files.len == 0) {
        try stderrPrint("aud graph: no files specified\n");
        return;
    }

    const groups = try groupFilesByLanguage(files, forced_lang, allocator, null);
    defer {
        for (groups) |g| allocator.free(g.files);
        allocator.free(groups);
    }

    if (groups.len == 0) {
        try stderrPrint("aud graph: no files with recognized language\n");
        return;
    }

    var res_diag = resolution.ResolutionDiag.init(allocator);
    defer res_diag.deinit();

    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);

    for (groups) |group| {
        const lang_config = cfg.getConfig(group.language);
        var pipe = try pipeline.Pipeline.init(allocator, lang_config);
        defer pipe.deinit();
        if (no_tests) pipe.test_markers = lang_config.test_markers;

        try pipe.run(group.files, false);

        if (res.args.resolutions) |res_path| {
            try applyResolutionFile(&pipe, res_path, allocator, &res_diag);
        }

        if (use_json) {
            try output.writeJsonGraph(&pipe.graph, &w.interface);
        } else {
            try output.writeToonGraph(&pipe.graph, &w.interface);
        }
    }

    if (res_diag.hasDiagnostics() or res_diag.resolved_count > 0) {
        if (use_json) {
            try output.writeJsonResolutionDiag(&res_diag, &w.interface);
        } else {
            try output.writeToonResolutionDiag(&res_diag, &w.interface);
        }
    }
    try w.interface.flush();
}

fn cmdInfo(iter: anytype) !void {
    const lang_name = iter.next() orelse {
        try stderrPrint("aud info: specify a language\nLanguages: solidity, rust, go, python, javascript, typescript, tsx, java, cpp, cairo, move, masm, compact, noir, tolk\n");
        return;
    };

    const lang = std.meta.stringToEnum(cfg.Language, lang_name) orelse {
        try stderrPrint("aud info: unknown language\n");
        return;
    };

    const lc = cfg.getConfig(lang);

    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);
    const wr = &w.interface;

    try wr.print("language: {s}\n", .{@tagName(lc.language)});
    try wr.print("inheritance_strategy: {s}\n", .{@tagName(lc.inheritance_strategy)});

    try wr.print("containers[{d}]:\n", .{lc.containers.len});
    for (lc.containers) |c| {
        try wr.print("  {s} (name: {s}, body: {s})\n", .{ c.ts_type, c.name_field, c.body_field orelse "(none)" });
    }

    try wr.print("callables[{d}]:\n", .{lc.callables.len});
    for (lc.callables) |c| {
        try wr.print("  {s} (name: {s})\n", .{ c.ts_type, c.name_field orelse "(anonymous)" });
    }

    try wr.print("builtin_functions[{d}]: ", .{lc.builtin_functions.len});
    for (lc.builtin_functions, 0..) |bf, i| {
        if (i > 0) try wr.writeAll(", ");
        try wr.print("{s}", .{bf});
    }
    try wr.writeAll("\n");

    try wr.print("metrics:\n  base_rate: {d}/day\n  branching_types: {d}\n  comment_types: {d}\n", .{
        lc.metrics.base_rate_per_day,
        lc.metrics.branching_types.len,
        lc.metrics.comment_types.len,
    });
    try wr.flush();
}

fn cmdApi() !void {
    var buf: [16384]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);
    const wr = &w.interface;

    try printApiNamespace(wr, "graph", &lua_adapter.graph_api);
    try printApiNamespace(wr, "ast", &lua_adapter.ast_api);
    try printApiNamespace(wr, "report", &lua_adapter.report_api);

    try wr.flush();
}

fn printApiNamespace(wr: anytype, name: []const u8, bindings: []const lua_adapter.ApiBinding) !void {
    try wr.print("{s}.*[{d}]:\n", .{ name, bindings.len });
    for (bindings) |b| {
        try wr.print("  {s}{s}\n    {s}\n", .{ b.name, b.signature, b.doc });
    }
    try wr.writeAll("\n");
}

// ── Shared Helpers ────────────────────────────────────────────────────

fn freeExpandedFiles(files: []const []const u8, allocator: std.mem.Allocator) void {
    for (files) |f| allocator.free(f);
    allocator.free(files);
}

fn stderrPrint(msg: []const u8) !void {
    var buf: [1024]u8 = undefined;
    var w = std.fs.File.stderr().writer(&buf);
    try w.interface.writeAll(msg);
    try w.interface.flush();
}

fn applyResolutionFile(
    pipe: *pipeline.Pipeline,
    res_path: []const u8,
    allocator: std.mem.Allocator,
    diag: *resolution.ResolutionDiag,
) !void {
    const res_contents = try readFileContents(res_path, allocator);
    try diag.ownBuffer(res_contents);

    const resolutions = try resolution.parseResolutionFile(res_contents, allocator, diag);
    defer allocator.free(resolutions);

    // Pre-parse resolution target files not yet in graph
    var parsed_new = false;
    for (resolutions) |pr| {
        if (!pipe.walked_files.contains(pr.res.target_file)) {
            std.fs.cwd().access(pr.res.target_file, .{}) catch continue;
            try pipe.parseAndWalkFile(pr.res.target_file);
            parsed_new = true;
        }
    }

    // Re-resolve refs from newly parsed files (safe: skips already-resolved)
    if (parsed_new) {
        try pipe.resolve();
    }

    try resolution.applyResolutions(&pipe.graph, resolutions, diag);
}

fn detectLanguage(file_path: []const u8) ?cfg.Language {
    const ext = std.fs.path.extension(file_path);
    return cfg.Language.fromExtension(ext);
}

// ── Multi-Language File Grouping ────────────────────────────────────

const LanguageFileGroup = struct {
    language: cfg.Language,
    files: []const []const u8,
};

fn groupFilesByLanguage(
    files: []const []const u8,
    forced_lang: ?cfg.Language,
    allocator: std.mem.Allocator,
    diag: ?*diagnostics.Diagnostics,
) ![]LanguageFileGroup {
    // Bucket files by detected language
    var buckets: std.AutoHashMapUnmanaged(cfg.Language, std.ArrayListUnmanaged([]const u8)) = .empty;
    defer {
        var it = buckets.iterator();
        while (it.next()) |entry| entry.value_ptr.deinit(allocator);
        buckets.deinit(allocator);
    }

    for (files) |file_path| {
        const detected = detectLanguage(file_path);
        if (forced_lang) |fl| {
            // --language filter: only keep files matching the forced language
            if (detected == null or detected.? != fl) continue;
        }
        const lang = detected orelse {
            if (diag) |d| d.warn("multi-lang", "skipping '{s}': unrecognized extension", .{file_path});
            continue;
        };
        const gop = try buckets.getOrPut(allocator, lang);
        if (!gop.found_existing) gop.value_ptr.* = .empty;
        try gop.value_ptr.append(allocator, file_path);
    }

    // Collect into sorted slice for deterministic output order
    var result: std.ArrayListUnmanaged(LanguageFileGroup) = .empty;
    var it = buckets.iterator();
    while (it.next()) |entry| {
        try result.append(allocator, .{
            .language = entry.key_ptr.*,
            .files = try entry.value_ptr.toOwnedSlice(allocator),
        });
    }

    // Sort by language enum value for deterministic ordering
    std.mem.sort(LanguageFileGroup, result.items, {}, struct {
        fn lessThan(_: void, a: LanguageFileGroup, b: LanguageFileGroup) bool {
            return @intFromEnum(a.language) < @intFromEnum(b.language);
        }
    }.lessThan);

    return try result.toOwnedSlice(allocator);
}

fn readFileContents(file_path: []const u8, allocator: std.mem.Allocator) ![]const u8 {
    const file = try std.fs.cwd().openFile(file_path, .{});
    defer file.close();
    const stat = try file.stat();
    const buf = try allocator.alloc(u8, stat.size);
    const n = try file.readAll(buf);
    return buf[0..n];
}

// Force inclusion of all modules so their tests run with `zig build test`
comptime {
    _ = @import("graph.zig");
    _ = @import("glob.zig");
    _ = @import("output.zig");
    _ = @import("resolution.zig");
    _ = @import("metrics.zig");
    _ = @import("peek.zig");
    _ = @import("call_chains.zig");
    _ = @import("pipeline.zig");
    _ = @import("walker.zig");
    _ = @import("lua_adapter.zig");
    _ = @import("ast_bridge.zig");
    _ = @import("diagnostics.zig");
    _ = @import("languages/config.zig");
    _ = @import("languages/solidity.zig");
}
