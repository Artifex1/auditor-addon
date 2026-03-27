const std = @import("std");
const ts = @import("tree-sitter");
const clap = @import("clap");

const cfg = @import("languages/config.zig");
const graph = @import("graph.zig");
const pipeline = @import("pipeline.zig");
const output = @import("output.zig");
const resolution = @import("resolution.zig");
const metrics_mod = @import("metrics.zig");
const peek_mod = @import("peek.zig");
const call_chains = @import("call_chains.zig");
const glob = @import("glob.zig");
const lua_adapter = @import("lua_adapter.zig");
const ast_bridge = @import("ast_bridge.zig");

// ── Subcommands (SPEC.md §10) ─────────────────────────────────────────

const SubCommand = enum {
    peek,
    metrics,
    gaps,
    run,
    @"call-chains",
    graph,
    info,
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
        .help => try printMainHelp(),
    }
}

fn printMainHelp() !void {
    var buf: [4096]u8 = undefined;
    var w = std.fs.File.stderr().writer(&buf);
    try w.interface.writeAll(
        \\Usage: aa <command> [options] <glob...>
        \\
        \\Commands:
        \\  peek          Extract function signatures
        \\  metrics       Calculate code metrics (nLOC, complexity, effort)
        \\  gaps          Build symbol graph, output unresolved edge gaps
        \\  run           Build symbol graph, run rules, output findings
        \\  call-chains   Map caller->callee chains from entry points
        \\  graph         Build symbol graph, dump nodes and edges
        \\  info          List language config (node types, properties)
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
    \\<str>...
    \\
);

const metrics_params = clap.parseParamsComptime(
    \\-h, --help                Display this help and exit.
    \\    --language <str>      Force language (auto-detected from extension otherwise).
    \\    --json                JSON output instead of TOON.
    \\<str>...
    \\
);

const gaps_params = clap.parseParamsComptime(
    \\-h, --help                Display this help and exit.
    \\    --language <str>      Force language (auto-detected from extension otherwise).
    \\    --json                JSON output instead of TOON.
    \\    --resolutions <str>   Apply resolution CSV file.
    \\    --no-expand           Skip import-driven file expansion.
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
    \\    --rule <str>...       Run specific shipped rule(s) only.
    \\    --rule-path <str>     Run adhoc rule from .lua file.
    \\    --rule-inline <str>   Run adhoc rule from inline Lua string.
    \\<str>...
    \\
);

const call_chains_params = clap.parseParamsComptime(
    \\-h, --help                Display this help and exit.
    \\    --language <str>      Force language (auto-detected from extension otherwise).
    \\    --json                JSON output instead of TOON.
    \\    --resolutions <str>   Apply resolution CSV file.
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
    \\    --format <str>        Output format: toon, json, dot (default: toon).
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
    const forced_lang = if (res.args.language) |l| std.meta.stringToEnum(cfg.Language, l) else null;

    const files = try expandPositionals(res.positionals[0], allocator);
    defer allocator.free(files);

    if (files.len == 0) {
        try stderrPrint("aa peek: no files specified\n");
        return;
    }

    var all_sigs: std.ArrayList(output.FileSignatures) = .empty;
    defer all_sigs.deinit(allocator);

    for (files) |file_path| {
        const lang = forced_lang orelse detectLanguage(file_path) orelse continue;
        const lang_config = cfg.getConfig(lang);
        const source = try readFileContents(file_path, allocator);
        defer allocator.free(source);

        const parser = ts.Parser.create();
        defer parser.destroy();
        try parser.setLanguage(lang.grammarFn()());

        const tree = parser.parseString(source, null) orelse continue;
        defer tree.destroy();

        const sigs = try peek_mod.extractSignatures(tree, source, lang_config, file_path, allocator);
        var sig_texts: std.ArrayList([]const u8) = .empty;
        for (sigs) |s| {
            try sig_texts.append(allocator, s.text);
        }

        try all_sigs.append(allocator, .{
            .file = file_path,
            .signatures = try sig_texts.toOwnedSlice(allocator),
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
    const forced_lang = if (res.args.language) |l| std.meta.stringToEnum(cfg.Language, l) else null;

    const files = try expandPositionals(res.positionals[0], allocator);
    defer allocator.free(files);

    if (files.len == 0) {
        try stderrPrint("aa metrics: no files specified\n");
        return;
    }

    var all_metrics: std.ArrayList(output.FileMetricsOutput) = .empty;
    defer all_metrics.deinit(allocator);

    for (files) |file_path| {
        const lang = forced_lang orelse detectLanguage(file_path) orelse continue;
        const lang_config = cfg.getConfig(lang);
        const source = try readFileContents(file_path, allocator);
        defer allocator.free(source);

        const parser = ts.Parser.create();
        defer parser.destroy();
        try parser.setLanguage(lang.grammarFn()());

        const tree = parser.parseString(source, null) orelse continue;
        defer tree.destroy();

        const m = metrics_mod.computeMetrics(tree, source, lang_config.metrics);

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

    const files = try expandPositionals(res.positionals[0], allocator);
    defer allocator.free(files);

    if (files.len == 0) {
        try stderrPrint("aa gaps: no files specified\n");
        return;
    }

    const lang = forced_lang orelse detectLanguage(files[0]) orelse {
        try stderrPrint("aa gaps: cannot detect language\n");
        return;
    };

    const lang_config = cfg.getConfig(lang);
    var pipe = try pipeline.Pipeline.init(allocator, lang_config);
    defer pipe.deinit();

    try pipe.run(files, no_expand);

    if (res.args.resolutions) |res_path| {
        try applyResolutionFile(&pipe.graph, res_path, allocator);
    }

    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);
    if (use_json) {
        try output.writeJsonGaps(&pipe.graph, &w.interface);
    } else {
        try output.writeToonGaps(&pipe.graph, &w.interface);
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

    const files = try expandPositionals(res.positionals[0], allocator);
    defer allocator.free(files);

    if (files.len == 0) {
        try stderrPrint("aa run: no files specified\n");
        return;
    }

    const lang = forced_lang orelse detectLanguage(files[0]) orelse {
        try stderrPrint("aa run: cannot detect language\n");
        return;
    };

    // Build graph
    const lang_config = cfg.getConfig(lang);
    var pipe = try pipeline.Pipeline.init(allocator, lang_config);
    defer pipe.deinit();
    try pipe.run(files, false);

    // Apply resolutions if provided
    if (res.args.resolutions) |res_path| {
        try applyResolutionFile(&pipe.graph, res_path, allocator);
    }

    // Set up AST bridge
    var bridge = ast_bridge.AstBridge.init(allocator, &pipe.sources);
    defer bridge.deinit(allocator);

    // Collect all findings across rules
    var all_findings: std.ArrayList(output.Finding) = .empty;
    defer all_findings.deinit(allocator);

    // Load and execute rules
    // --rule-path: adhoc rule from file
    if (res.args.@"rule-path") |rule_path| {
        try executeRule(allocator, &pipe.graph, &bridge, rule_path, null, &all_findings);
    }

    // --rule-inline: adhoc rule from string
    if (res.args.@"rule-inline") |rule_code| {
        try executeRule(allocator, &pipe.graph, &bridge, null, rule_code, &all_findings);
    }

    // TODO: shipped rules from rules/ directory
    // TODO: --rule=<ID> filter

    // If no rules specified, note that shipped rules aren't implemented yet
    if (res.args.@"rule-path" == null and res.args.@"rule-inline" == null) {
        try stderrPrint("aa run: no rules specified. Use --rule-path=<file> or --rule-inline=<lua>\n");
        return;
    }

    // Output findings
    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);
    if (use_json) {
        // TODO: JSON findings output
        try w.interface.writeAll("{\"findings\":[]}\n");
    } else {
        try output.writeToonFindings(all_findings.items, &w.interface);
    }
    try w.interface.flush();
}

fn executeRule(
    allocator: std.mem.Allocator,
    g: *graph.SymbolGraph,
    bridge: *ast_bridge.AstBridge,
    rule_path: ?[]const u8,
    rule_code: ?[]const u8,
    all_findings: *std.ArrayList(output.Finding),
) !void {
    const lua = try lua_adapter.initLua(allocator, g, bridge);
    defer lua.deinit();

    // Load rule
    const metadata = if (rule_path) |path|
        try lua_adapter.loadRuleFile(lua, path)
    else if (rule_code) |code|
        try lua_adapter.loadRuleInline(lua, code)
    else
        return;

    // Execute based on rule type
    const hits = if (std.mem.eql(u8, metadata.rule_type, "map"))
        try lua_adapter.executeMapRule(lua, g, bridge, allocator)
    else
        try lua_adapter.executeVisitorRule(lua, g, metadata, bridge, allocator);

    if (hits.len > 0) {
        try all_findings.append(allocator, .{
            .rule_id = metadata.id,
            .severity = metadata.severity,
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
    const max_depth: u32 = if (res.args.@"max-depth") |d| @intCast(d) else 10;

    const root_filter: ?[]const []const u8 = if (res.args.root.len > 0)
        res.args.root
    else
        null;

    const files = try expandPositionals(res.positionals[0], allocator);
    defer allocator.free(files);

    if (files.len == 0) {
        try stderrPrint("aa call-chains: no files specified\n");
        return;
    }

    const lang = forced_lang orelse detectLanguage(files[0]) orelse {
        try stderrPrint("aa call-chains: cannot detect language\n");
        return;
    };

    const lang_config = cfg.getConfig(lang);
    var pipe = try pipeline.Pipeline.init(allocator, lang_config);
    defer pipe.deinit();

    try pipe.run(files, false);

    if (res.args.resolutions) |res_path| {
        try applyResolutionFile(&pipe.graph, res_path, allocator);
    }

    const chain_results = try call_chains.computeCallChains(&pipe.graph, root_filter, max_depth, allocator);
    defer allocator.free(chain_results);

    var output_roots: std.ArrayList(output.RootChains) = .empty;
    defer output_roots.deinit(allocator);

    for (chain_results) |cs| {
        var chain_strs: std.ArrayList([]const u8) = .empty;
        for (cs.chains.items) |chain| {
            const formatted = try call_chains.formatChain(chain, allocator);
            try chain_strs.append(allocator, formatted);
        }
        try output_roots.append(allocator, .{
            .root_name = cs.root_name,
            .chains = try chain_strs.toOwnedSlice(allocator),
        });
    }

    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);
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

    const files = try expandPositionals(res.positionals[0], allocator);
    defer allocator.free(files);

    if (files.len == 0) {
        try stderrPrint("aa graph: no files specified\n");
        return;
    }

    const lang = forced_lang orelse detectLanguage(files[0]) orelse {
        try stderrPrint("aa graph: cannot detect language\n");
        return;
    };

    const lang_config = cfg.getConfig(lang);
    var pipe = try pipeline.Pipeline.init(allocator, lang_config);
    defer pipe.deinit();

    try pipe.run(files, false);

    if (res.args.resolutions) |res_path| {
        try applyResolutionFile(&pipe.graph, res_path, allocator);
    }

    var buf: [8192]u8 = undefined;
    var w = std.fs.File.stdout().writer(&buf);
    if (use_json) {
        try output.writeJsonGraph(&pipe.graph, &w.interface);
    } else {
        try output.writeToonGraph(&pipe.graph, &w.interface);
    }
    try w.interface.flush();
}

fn cmdInfo(iter: anytype) !void {
    const lang_name = iter.next() orelse {
        try stderrPrint("aa info: specify a language\nLanguages: solidity, rust, go, python, javascript, typescript, tsx, java, cpp, cairo, move, masm, compact, noir, tolk\n");
        return;
    };

    const lang = std.meta.stringToEnum(cfg.Language, lang_name) orelse {
        try stderrPrint("aa info: unknown language\n");
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
        try wr.print("  {s} (name: {s}, body: {s})\n", .{ c.ts_type, c.name_field, c.body_field });
    }

    try wr.print("callables[{d}]:\n", .{lc.callables.len});
    for (lc.callables) |c| {
        try wr.print("  {s} (name: {s})\n", .{ c.ts_type, c.name_field orelse "(anonymous)" });
    }

    try wr.print("variables[{d}]:\n", .{lc.variables.len});
    for (lc.variables) |v| {
        try wr.print("  {s} (name: {s})\n", .{ v.ts_type, v.name_field });
    }

    try wr.print("events[{d}]:\n", .{lc.events.len});
    for (lc.events) |e| {
        try wr.print("  {s} (name: {s})\n", .{ e.ts_type, e.name_field });
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

// ── Shared Helpers ────────────────────────────────────────────────────

fn stderrPrint(msg: []const u8) !void {
    var buf: [1024]u8 = undefined;
    var w = std.fs.File.stderr().writer(&buf);
    try w.interface.writeAll(msg);
    try w.interface.flush();
}

fn applyResolutionFile(
    g: *graph.SymbolGraph,
    res_path: []const u8,
    allocator: std.mem.Allocator,
) !void {
    const res_contents = try readFileContents(res_path, allocator);
    defer allocator.free(res_contents);

    const resolutions = try resolution.parseResolutionFile(res_contents, allocator);
    defer allocator.free(resolutions);

    var result = resolution.ResolutionResult.init(allocator);
    defer result.deinit();

    try resolution.applyResolutions(g, resolutions, &result);

    var buf: [1024]u8 = undefined;
    var w = std.fs.File.stderr().writer(&buf);
    if (result.stale > 0) {
        try w.interface.print("warning: {d} stale resolution(s)\n", .{result.stale});
    }
    if (result.broken > 0) {
        try w.interface.print("error: {d} broken resolution(s)\n", .{result.broken});
    }
    if (result.resolved > 0) {
        try w.interface.print("applied: {d} resolution(s)\n", .{result.resolved});
    }
    try w.interface.flush();
}

fn detectLanguage(file_path: []const u8) ?cfg.Language {
    const ext = std.fs.path.extension(file_path);
    return cfg.Language.fromExtension(ext);
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
    _ = @import("languages/config.zig");
    _ = @import("languages/solidity.zig");
    _ = @import("integration_test.zig");
}
