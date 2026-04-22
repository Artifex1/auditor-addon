const std = @import("std");
const graph = @import("graph.zig");
const resolution = @import("resolution.zig");
const diagnostics = @import("diagnostics.zig");

const Writer = *std.Io.Writer;

// ── JSON String Escaping ──────────────────────────────────────────────

fn writeJsonEscaped(writer: Writer, s: []const u8) !void {
    for (s) |c| {
        switch (c) {
            '"' => try writer.writeAll("\\\""),
            '\\' => try writer.writeAll("\\\\"),
            '\n' => try writer.writeAll("\\n"),
            '\r' => try writer.writeAll("\\r"),
            '\t' => try writer.writeAll("\\t"),
            else => {
                if (c < 0x20) {
                    try writer.print("\\u{x:0>4}", .{c});
                } else {
                    try writer.writeByte(c);
                }
            },
        }
    }
}

/// Write a JSON string value (with quotes and escaping).
fn writeJsonString(writer: Writer, s: []const u8) !void {
    try writer.writeByte('"');
    try writeJsonEscaped(writer, s);
    try writer.writeByte('"');
}

// ── TOON: Gaps ────────────────────────────────────────────────────────
// SPEC.md §8.1

pub fn writeToonGaps(
    g: *const graph.SymbolGraph,
    writer: Writer,
    priority_filter: ?graph.Priority,
    kind_filter: ?graph.RefKind,
) !void {
    const gap_count = countFilteredGaps(g, priority_filter, kind_filter);
    try writer.print("gaps[{d}]{{ref_id,from_name,target_name,kind,file,line,priority}}:\n", .{gap_count});

    for (g.refs.items) |ref| {
        if (ref.gapPriority()) |priority| {
            if (!g.isRefInScope(ref)) continue;
            if (priority_filter) |pf| if (pf != priority) continue;
            if (kind_filter) |kf| if (kf != ref.kind) continue;
            const from_name = if (g.lookupNode(ref.from)) |node| node.name else "";
            try writer.print("  {x},{s},{s},{s},{s},{d},{s}\n", .{
                ref.id,
                from_name,
                ref.target_name,
                @tagName(ref.kind),
                ref.site.file,
                ref.site.line,
                @tagName(priority),
            });
        }
    }
}

fn countFilteredGaps(
    g: *const graph.SymbolGraph,
    priority_filter: ?graph.Priority,
    kind_filter: ?graph.RefKind,
) usize {
    if (priority_filter == null and kind_filter == null) return g.gapCount();
    var n: usize = 0;
    for (g.refs.items) |ref| {
        if (ref.gapPriority()) |p| {
            if (!g.isRefInScope(ref)) continue;
            if (priority_filter) |pf| if (pf != p) continue;
            if (kind_filter) |kf| if (kf != ref.kind) continue;
            n += 1;
        }
    }
    return n;
}

// ── TOON: Graph ───────────────────────────────────────────────────────
// SPEC.md §8.1

pub fn writeToonGraph(g: *const graph.SymbolGraph, writer: Writer) !void {
    // Nodes
    try writer.print("nodes[{d}]{{id,kind,name,qualified_name,visibility,language,file,line}}:\n", .{g.nodeCount()});
    var node_it = g.nodes.iterator();
    while (node_it.next()) |entry| {
        const node = entry.value_ptr.*;
        try writer.print("  {x},{s},{s},{s},{s},{s},{s},{d}\n", .{
            node.id,
            @tagName(node.kind),
            node.name,
            node.qualified_name,
            node.visibility orelse "",
            @tagName(node.language),
            if (node.locator) |loc| loc.file else "",
            if (node.locator) |loc| loc.line else 0,
        });
    }

    // Contains
    try writer.print("contains[{d}]{{from,to}}:\n", .{g.containsCount()});
    for (g.contains.items) |edge| {
        try writer.print("  {x},{x}\n", .{ edge.from, edge.to });
    }

    // Refs
    try writer.print("refs[{d}]{{ref_id,from,kind,target_name,targets,site_line,gap}}:\n", .{g.refCount()});
    for (g.refs.items) |ref| {
        try writer.print("  {x},{x},{s},{s},[", .{
            ref.id,
            ref.from,
            @tagName(ref.kind),
            ref.target_name,
        });
        for (ref.targets(), 0..) |target, i| {
            if (i > 0) try writer.writeAll(",");
            try writer.print("{x}", .{target});
        }
        try writer.print("],{d},{s}\n", .{
            ref.site.line,
            if (ref.gapPriority()) |priority| @tagName(priority) else "",
        });
    }
}

// ── TOON: Findings ────────────────────────────────────────────────────
// SPEC.md §8.1

pub const Finding = struct {
    rule_id: []const u8,
    severity: []const u8,
    confidence: []const u8,
    name: []const u8,
    hits: []const Hit,
};

pub const Hit = struct {
    file: []const u8,
    line: u32,
    node_text: []const u8,
};

pub fn writeToonFindings(findings: []const Finding, writer: Writer) !void {
    try writer.print("findings[{d}]:\n", .{findings.len});
    for (findings) |f| {
        try writer.print("  {s}{{severity:{s},confidence:{s},name:{s},hits[{d}]{{file,line,node_text}}}}:\n", .{
            f.rule_id,
            f.severity,
            f.confidence,
            f.name,
            f.hits.len,
        });
        for (f.hits) |hit| {
            try writer.print("    {s},{d},{s}\n", .{ hit.file, hit.line, hit.node_text });
        }
    }
}

// ── TOON: Metrics ─────────────────────────────────────────────────────
// SPEC-CLI.md §2.6

pub const FileMetricsOutput = struct {
    file: []const u8,
    nloc: u32,
    cognitive_complexity: u32,
    complexity_per_100: u32,
    comment_density: u32,
    estimated_hours: f32,
};

pub fn writeToonMetrics(files: []const FileMetricsOutput, writer: Writer) !void {
    try writer.print("files[{d}]{{file,nLOC,cognitiveComplexity(per100),commentDensity(%),estimatedHours}}:\n", .{files.len});

    var total_nloc: u32 = 0;
    var total_hours: f32 = 0;

    for (files) |f| {
        try writer.print("  {s},{d},{d},{d},{d:.2}\n", .{
            f.file,
            f.nloc,
            f.complexity_per_100,
            f.comment_density,
            f.estimated_hours,
        });
        total_nloc += f.nloc;
        total_hours += f.estimated_hours;
    }

    try writer.print("totals:\n", .{});
    try writer.print("  nLOC: {d}\n", .{total_nloc});
    try writer.print("  hours: {d:.1}\n", .{total_hours});
    try writer.print("  days: {d:.2}\n", .{total_hours / 6.0});
}

// ── TOON: Diff Metrics ────────────────────────────────────────────────
// SPEC-CLI.md §3

pub const DiffMetricsRow = struct {
    file: []const u8, // "old -> new" for renames; single path otherwise
    status: []const u8, // added | modified | renamed | deleted
    nloc_added: u32,
    nloc_removed: u32,
    complexity_added: u32,
    complexity_per_100: u32,
    comment_density: u32,
    estimated_hours: f32,
    changed_functions: []const []const u8,
};

pub fn writeToonDiffMetrics(rows: []const DiffMetricsRow, writer: Writer) !void {
    try writer.print(
        "files[{d}]{{file,status,nloc_added,nloc_removed,complexity_added,complexity_per_100,comment_density,estimated_hours,changed_functions}}:\n",
        .{rows.len},
    );

    var total_nloc: u32 = 0;
    var total_hours: f32 = 0;

    for (rows) |r| {
        try writer.print("  {s},{s},{d},{d},{d},{d},{d},{d:.2},", .{
            r.file,
            r.status,
            r.nloc_added,
            r.nloc_removed,
            r.complexity_added,
            r.complexity_per_100,
            r.comment_density,
            r.estimated_hours,
        });
        // changed_functions: "a|b|c" in a single TOON cell
        for (r.changed_functions, 0..) |fn_name, i| {
            if (i > 0) try writer.writeByte('|');
            try writer.writeAll(fn_name);
        }
        try writer.writeByte('\n');
        total_nloc += r.nloc_added;
        total_hours += r.estimated_hours;
    }

    try writer.print("totals:\n", .{});
    try writer.print("  nloc_added: {d}\n", .{total_nloc});
    try writer.print("  hours: {d:.1}\n", .{total_hours});
    try writer.print("  days: {d:.2}\n", .{total_hours / 6.0});
}

pub fn writeJsonDiffMetrics(rows: []const DiffMetricsRow, writer: Writer) !void {
    try writer.writeAll("{\"files\":[");
    for (rows, 0..) |r, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.writeAll("{\"file\":");
        try writeJsonString(writer, r.file);
        try writer.writeAll(",\"status\":");
        try writeJsonString(writer, r.status);
        try writer.print(",\"nloc_added\":{d},\"nloc_removed\":{d},\"complexity_added\":{d},\"complexity_per_100\":{d},\"comment_density\":{d},\"estimated_hours\":{d:.2}", .{
            r.nloc_added,
            r.nloc_removed,
            r.complexity_added,
            r.complexity_per_100,
            r.comment_density,
            r.estimated_hours,
        });
        try writer.writeAll(",\"changed_functions\":[");
        for (r.changed_functions, 0..) |fn_name, j| {
            if (j > 0) try writer.writeAll(",");
            try writeJsonString(writer, fn_name);
        }
        try writer.writeAll("]}");
    }

    var total_nloc: u32 = 0;
    var total_hours: f32 = 0;
    for (rows) |r| {
        total_nloc += r.nloc_added;
        total_hours += r.estimated_hours;
    }
    try writer.print("],\"totals\":{{\"nloc_added\":{d},\"hours\":{d:.2},\"days\":{d:.2}}}}}\n", .{
        total_nloc,
        total_hours,
        total_hours / 6.0,
    });
}

// ── TOON: Peek Signatures ─────────────────────────────────────────────
// SPEC-CLI.md §1

pub const FileSignatures = struct {
    file: []const u8,
    signatures: []const []const u8,
};

pub fn writeToonSignatures(files: []const FileSignatures, writer: Writer) !void {
    for (files) |f| {
        try writer.print("{s}{{signatures[{d}]}}:\n", .{ f.file, f.signatures.len });
        for (f.signatures) |sig| {
            try writer.print("  {s}\n", .{sig});
        }
    }
}

// ── TOON: Call Chains ─────────────────────────────────────────────────
// SPEC.md §11

pub const RootChains = struct {
    root_name: []const u8,
    chains: []const []const u8, // each chain is a list of names joined by " -> "
};

pub fn writeToonCallChains(roots: []const RootChains, writer: Writer) !void {
    try writer.print("roots[{d}]:\n", .{roots.len});
    for (roots) |root| {
        try writer.print("  {s}{{chains[{d}]{{path}}}}:\n", .{ root.root_name, root.chains.len });
        for (root.chains) |chain| {
            try writer.print("    {s}\n", .{chain});
        }
    }
}

// ── JSON Output ───────────────────────────────────────────────────────

pub fn writeJsonGaps(
    g: *const graph.SymbolGraph,
    writer: Writer,
    priority_filter: ?graph.Priority,
    kind_filter: ?graph.RefKind,
) !void {
    try writer.writeAll("{\"gaps\":[");
    var first = true;
    for (g.refs.items) |ref| {
        if (ref.gapPriority()) |priority| {
            if (!g.isRefInScope(ref)) continue;
            if (priority_filter) |pf| if (pf != priority) continue;
            if (kind_filter) |kf| if (kf != ref.kind) continue;
            if (!first) try writer.writeAll(",");
            first = false;
            const from_name = if (g.lookupNode(ref.from)) |node| node.name else "";
            try writer.writeAll("{");
            try writer.print("\"ref_id\":\"{x}\",", .{ref.id});
            try writer.writeAll("\"from\":");
            try writeJsonString(writer, from_name);
            try writer.writeByte(',');
            try writer.writeAll("\"target_name\":");
            try writeJsonString(writer, ref.target_name);
            try writer.writeByte(',');
            try writer.print("\"kind\":\"{s}\",", .{@tagName(ref.kind)});
            try writer.writeAll("\"file\":");
            try writeJsonString(writer, ref.site.file);
            try writer.writeByte(',');
            try writer.print("\"line\":{d},", .{ref.site.line});
            try writer.print("\"priority\":\"{s}\"", .{@tagName(priority)});
            try writer.writeByte('}');
        }
    }
    try writer.writeAll("]}\n");
}

pub fn writeJsonGraph(g: *const graph.SymbolGraph, writer: Writer) !void {
    // Nodes
    try writer.writeAll("{\"nodes\":[");
    var first = true;
    var node_it = g.nodes.iterator();
    while (node_it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (!first) try writer.writeAll(",");
        first = false;
        try writer.writeAll("{");
        try writer.print("\"id\":\"{x}\",", .{node.id});
        try writer.print("\"kind\":\"{s}\",", .{@tagName(node.kind)});
        try writer.writeAll("\"name\":");
        try writeJsonString(writer, node.name);
        try writer.writeByte(',');
        try writer.writeAll("\"qualified_name\":");
        try writeJsonString(writer, node.qualified_name);
        try writer.writeByte(',');
        try writer.writeAll("\"visibility\":");
        try writeJsonString(writer, node.visibility orelse "");
        try writer.writeByte(',');
        try writer.print("\"language\":\"{s}\",", .{@tagName(node.language)});
        try writer.writeAll("\"file\":");
        try writeJsonString(writer, if (node.locator) |loc| loc.file else "");
        try writer.writeByte(',');
        try writer.print("\"line\":{d}", .{if (node.locator) |loc| loc.line else 0});
        try writer.writeByte('}');
    }

    // Contains
    try writer.writeAll("],\"contains\":[");
    first = true;
    for (g.contains.items) |edge| {
        if (!first) try writer.writeAll(",");
        first = false;
        try writer.print("{{\"from\":\"{x}\",\"to\":\"{x}\"}}", .{ edge.from, edge.to });
    }

    // Refs
    try writer.writeAll("],\"refs\":[");
    first = true;
    for (g.refs.items) |ref| {
        if (!first) try writer.writeAll(",");
        first = false;
        try writer.writeAll("{");
        try writer.print("\"ref_id\":\"{x}\",\"from\":\"{x}\",", .{ ref.id, ref.from });
        try writer.print("\"kind\":\"{s}\",", .{@tagName(ref.kind)});
        try writer.writeAll("\"target_name\":");
        try writeJsonString(writer, ref.target_name);
        try writer.writeAll(",\"targets\":[");
        for (ref.targets(), 0..) |target, i| {
            if (i > 0) try writer.writeAll(",");
            try writer.print("\"{x}\"", .{target});
        }
        try writer.print("],\"site_line\":{d}", .{ref.site.line});
        if (ref.gapPriority()) |priority| {
            try writer.print(",\"gap\":\"{s}\"", .{@tagName(priority)});
        }
        try writer.writeByte('}');
    }
    try writer.writeAll("]}\n");
}

pub fn writeJsonFindings(findings: []const Finding, writer: Writer) !void {
    try writer.writeAll("{\"findings\":[");
    for (findings, 0..) |f, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.writeAll("{\"rule_id\":");
        try writeJsonString(writer, f.rule_id);
        try writer.writeAll(",\"severity\":");
        try writeJsonString(writer, f.severity);
        try writer.writeAll(",\"confidence\":");
        try writeJsonString(writer, f.confidence);
        try writer.writeAll(",\"name\":");
        try writeJsonString(writer, f.name);
        try writer.writeAll(",\"hits\":[");
        for (f.hits, 0..) |hit, j| {
            if (j > 0) try writer.writeAll(",");
            try writer.writeAll("{\"file\":");
            try writeJsonString(writer, hit.file);
            try writer.print(",\"line\":{d},\"node_text\":", .{hit.line});
            try writeJsonString(writer, hit.node_text);
            try writer.writeByte('}');
        }
        try writer.writeAll("]}");
    }
    try writer.writeAll("]}\n");
}

pub fn writeJsonMetrics(files: []const FileMetricsOutput, writer: Writer) !void {
    try writer.writeAll("{\"files\":[");
    for (files, 0..) |f, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.writeAll("{\"file\":");
        try writeJsonString(writer, f.file);
        try writer.print(",\"nLOC\":{d},\"cognitiveComplexity\":{d},\"complexityPer100\":{d},\"commentDensity\":{d},\"estimatedHours\":{d:.2}}}", .{
            f.nloc,
            f.cognitive_complexity,
            f.complexity_per_100,
            f.comment_density,
            f.estimated_hours,
        });
    }
    try writer.writeAll("]}\n");
}

pub fn writeJsonSignatures(files: []const FileSignatures, writer: Writer) !void {
    try writer.writeAll("{\"files\":[");
    for (files, 0..) |f, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.writeAll("{\"file\":");
        try writeJsonString(writer, f.file);
        try writer.writeAll(",\"signatures\":[");
        for (f.signatures, 0..) |sig, j| {
            if (j > 0) try writer.writeAll(",");
            try writeJsonString(writer, sig);
        }
        try writer.writeAll("]}");
    }
    try writer.writeAll("]}\n");
}

pub fn writeJsonCallChains(roots: []const RootChains, writer: Writer) !void {
    try writer.writeAll("{\"roots\":[");
    for (roots, 0..) |root, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.writeAll("{\"name\":");
        try writeJsonString(writer, root.root_name);
        try writer.writeAll(",\"chains\":[");
        for (root.chains, 0..) |chain, j| {
            if (j > 0) try writer.writeAll(",");
            try writeJsonString(writer, chain);
        }
        try writer.writeAll("]}");
    }
    try writer.writeAll("]}\n");
}

// ── TOON: Resolution Diagnostics ─────────────────────────────────────

pub fn writeToonResolutionDiag(diag: *const resolution.ResolutionDiag, writer: Writer) !void {
    const n_parse = diag.parse_errors.items.len;
    const n_stale = diag.stale.items.len;
    const n_broken = diag.broken.items.len;

    try writer.print("resolution{{applied:{d},parse_errors:{d},stale:{d},broken:{d}}}:\n", .{
        diag.resolved_count, n_parse, n_stale, n_broken,
    });

    if (n_parse > 0) {
        try writer.print("  parse_errors[{d}]{{row,reason,raw_line}}:\n", .{n_parse});
        for (diag.parse_errors.items) |e| {
            try writer.print("    {d},{s},{s}\n", .{ e.row, @tagName(e.reason), e.raw_line });
        }
    }

    if (n_stale > 0) {
        try writer.print("  stale[{d}]{{row,ref_id,target_name,reason}}:\n", .{n_stale});
        for (diag.stale.items) |s| {
            try writer.print("    {d},{x},{s},{s}\n", .{ s.row, s.ref_id, s.target_name, @tagName(s.reason) });
        }
    }

    if (n_broken > 0) {
        try writer.print("  broken[{d}]{{row,ref_id,target_name,target_file,target_line}}:\n", .{n_broken});
        for (diag.broken.items) |b| {
            try writer.print("    {d},{x},{s},{s},{d}\n", .{ b.row, b.ref_id, b.target_name, b.target_file, b.target_line });
        }
    }
}

// ── JSON: Resolution Diagnostics ─────────────────────────────────────

pub fn writeJsonResolutionDiag(diag: *const resolution.ResolutionDiag, writer: Writer) !void {
    try writer.print("{{\"resolution\":{{\"applied\":{d},\"parse_errors\":[", .{diag.resolved_count});

    for (diag.parse_errors.items, 0..) |e, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.print("{{\"row\":{d},\"reason\":\"{s}\",\"raw_line\":", .{ e.row, @tagName(e.reason) });
        try writeJsonString(writer, e.raw_line);
        try writer.writeByte('}');
    }

    try writer.writeAll("],\"stale\":[");
    for (diag.stale.items, 0..) |s, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.print("{{\"row\":{d},\"ref_id\":\"{x}\",\"target_name\":", .{ s.row, s.ref_id });
        try writeJsonString(writer, s.target_name);
        try writer.print(",\"reason\":\"{s}\"}}", .{@tagName(s.reason)});
    }

    try writer.writeAll("],\"broken\":[");
    for (diag.broken.items, 0..) |b, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.print("{{\"row\":{d},\"ref_id\":\"{x}\",\"target_name\":", .{ b.row, b.ref_id });
        try writeJsonString(writer, b.target_name);
        try writer.writeAll(",\"target_file\":");
        try writeJsonString(writer, b.target_file);
        try writer.print(",\"target_line\":{d}}}", .{b.target_line});
    }

    try writer.writeAll("]}}\n");
}

// ── TOON: Diagnostics ───────────────────────────────────────────────

pub fn writeToonDiagnostics(diag: *const diagnostics.Diagnostics, writer: Writer) !void {
    try writer.print("diagnostics[{d}]{{level,source,message}}:\n", .{diag.entries.items.len});
    for (diag.entries.items) |entry| {
        try writer.print("  {s},{s},{s}\n", .{ @tagName(entry.level), entry.source, entry.message });
    }
}

// ── JSON: Diagnostics ───────────────────────────────────────────────

pub fn writeJsonDiagnostics(diag: *const diagnostics.Diagnostics, writer: Writer) !void {
    try writer.writeAll("{\"diagnostics\":[");
    for (diag.entries.items, 0..) |entry, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.print("{{\"level\":\"{s}\",\"source\":\"{s}\",\"message\":", .{ @tagName(entry.level), entry.source });
        try writeJsonString(writer, entry.message);
        try writer.writeByte('}');
    }
    try writer.writeAll("]}\n");
}

// ── Tests ──────────────────────────────────────────────────────────────

fn makeTestRef(id: u64, from: u64, target_name: []const u8, kind: graph.RefKind, file: []const u8, line: u32, gap: ?graph.Priority) graph.Reference {
    return .{
        .id = id,
        .from = from,
        .kind = kind,
        .target_name = target_name,
        .site = .{ .file = file, .start_byte = 0, .end_byte = 0, .line = line, .column = 0 },
        .resolution = if (gap) |p| .{ .gap = p } else .pending,
    };
}

test "writeToonSignatures formats correctly" {
    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);

    const sigs = [_]FileSignatures{
        .{ .file = "src/Vault.sol", .signatures = &.{ "function withdraw(uint256 amount) external", "function deposit() external payable" } },
    };
    try writeToonSignatures(&sigs, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "src/Vault.sol{signatures[2]}:") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "function withdraw") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "function deposit") != null);
}

test "writeToonMetrics formats with totals" {
    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);

    const files = [_]FileMetricsOutput{
        .{ .file = "src/Vault.sol", .nloc = 120, .cognitive_complexity = 24, .complexity_per_100 = 20, .comment_density = 7, .estimated_hours = 4.8 },
        .{ .file = "src/Ownable.sol", .nloc = 45, .cognitive_complexity = 6, .complexity_per_100 = 13, .comment_density = 12, .estimated_hours = 1.8 },
    };
    try writeToonMetrics(&files, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "files[2]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "totals:") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "nLOC: 165") != null);
}

test "writeToonFindings formats grouped by rule" {
    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);

    const findings = [_]Finding{
        .{
            .rule_id = "SOL-002",
            .severity = "critical",
            .confidence = "smell",
            .name = "reentrancy",
            .hits = &.{
                .{ .file = "src/Vault.sol", .line = 42, .node_text = "balances[msg.sender]" },
            },
        },
    };
    try writeToonFindings(&findings, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "findings[1]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "SOL-002") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "src/Vault.sol,42") != null);
}

test "writeToonGaps formats gap rows from refs" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    // Add a node so from_name can be resolved
    _ = try g.addNode(.{
        .id = 0x123,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "Vault.withdraw",
        .language = .solidity,
    });

    // Add a ref with gap set
    try g.addRef(makeTestRef(0xabc, 0x123, "SomeLib", .inheritance, "src/Vault.sol", 10, .high));

    // Add a ref without gap (should be excluded)
    try g.addRef(makeTestRef(0xdef, 0x123, "deposit", .call, "src/Vault.sol", 20, null));

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try writeToonGaps(&g, &w, null, null);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "gaps[1]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "SomeLib") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "inheritance") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "high") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "withdraw") != null);
    // non-gap ref should not appear
    try std.testing.expect(std.mem.indexOf(u8, out, "deposit") == null);
}

test "writeToonGraph outputs nodes, contains, and refs" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    _ = try g.addNode(.{
        .id = 0x100,
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Vault",
        .qualified_name = "Vault",
        .language = .solidity,
    });
    _ = try g.addNode(.{
        .id = 0x200,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "Vault.withdraw",
        .language = .solidity,
    });

    try g.addContains(0x100, 0x200);
    try g.addRef(makeTestRef(0xaaa, 0x200, "transfer", .call, "src/Vault.sol", 15, null));

    var buf: [8192]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try writeToonGraph(&g, &w);
    try w.flush();

    const out = buf[0..w.end];
    // Nodes section
    try std.testing.expect(std.mem.indexOf(u8, out, "nodes[2]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "Vault") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "withdraw") != null);
    // Contains section
    try std.testing.expect(std.mem.indexOf(u8, out, "contains[1]{from,to}:") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "100,200") != null);
    // Refs section
    try std.testing.expect(std.mem.indexOf(u8, out, "refs[1]{ref_id,from,kind,target_name,targets,site_line,gap}:") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "transfer") != null);
}

test "writeJsonGaps produces valid structure from refs" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    _ = try g.addNode(.{
        .id = 0x123,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "Vault.withdraw",
        .language = .solidity,
    });

    try g.addRef(makeTestRef(0xabc, 0x123, "transfer", .call, "src/Vault.sol", 42, .medium));

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try writeJsonGaps(&g, &w, null, null);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.startsWith(u8, out, "{\"gaps\":["));
    try std.testing.expect(std.mem.indexOf(u8, out, "transfer") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"priority\":\"medium\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"from\":\"withdraw\"") != null);
}

test "writeJsonGraph outputs nodes, contains, and refs" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    _ = try g.addNode(.{
        .id = 0x100,
        .kind = .container,
        .language_kind = "contract_declaration",
        .name = "Vault",
        .qualified_name = "Vault",
        .language = .solidity,
    });
    _ = try g.addNode(.{
        .id = 0x200,
        .kind = .callable,
        .language_kind = "function_definition",
        .name = "withdraw",
        .qualified_name = "Vault.withdraw",
        .language = .solidity,
    });

    try g.addContains(0x100, 0x200);
    try g.addRef(makeTestRef(0xaaa, 0x200, "transfer", .call, "src/Vault.sol", 15, .high));

    var buf: [8192]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try writeJsonGraph(&g, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.startsWith(u8, out, "{\"nodes\":["));
    try std.testing.expect(std.mem.indexOf(u8, out, "\"contains\":[") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"refs\":[") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "transfer") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"gap\":\"high\"") != null);
}

test "writeToonResolutionDiag formats all sections" {
    var diag = resolution.ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();

    diag.resolved_count = 1;
    try diag.parse_errors.append(std.testing.allocator, .{ .row = 5, .raw_line = "bad,line", .reason = .wrong_field_count });
    try diag.stale.append(std.testing.allocator, .{ .row = 3, .ref_id = 0xa4f2e81b, .target_name = "onlyOwner", .reason = .not_found });
    try diag.broken.append(std.testing.allocator, .{ .row = 4, .ref_id = 0xc8d4e567, .target_name = "withdraw", .target_file = "src/Missing.sol", .target_line = 99 });

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try writeToonResolutionDiag(&diag, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "resolution{applied:1,parse_errors:1,stale:1,broken:1}:") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "parse_errors[1]{row,reason,raw_line}:") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "5,wrong_field_count,bad,line") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "stale[1]{row,ref_id,target_name,reason}:") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "a4f2e81b,onlyOwner,not_found") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "broken[1]{row,ref_id,target_name,target_file,target_line}:") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "c8d4e567,withdraw,src/Missing.sol,99") != null);
}

test "writeJsonResolutionDiag produces valid structure" {
    var diag = resolution.ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();

    diag.resolved_count = 2;
    try diag.stale.append(std.testing.allocator, .{ .row = 3, .ref_id = 0xabc, .target_name = "foo", .reason = .already_resolved });
    try diag.broken.append(std.testing.allocator, .{ .row = 4, .ref_id = 0xdef, .target_name = "bar", .target_file = "src/X.sol", .target_line = 10 });

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try writeJsonResolutionDiag(&diag, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.startsWith(u8, out, "{\"resolution\":{\"applied\":2,"));
    try std.testing.expect(std.mem.indexOf(u8, out, "\"stale\":[") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"reason\":\"already_resolved\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"broken\":[") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"target_file\":\"src/X.sol\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"target_line\":10") != null);
}

test "writeToonResolutionDiag omits empty sections" {
    var diag = resolution.ResolutionDiag.init(std.testing.allocator);
    defer diag.deinit();

    diag.resolved_count = 3;

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try writeToonResolutionDiag(&diag, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "resolution{applied:3,parse_errors:0,stale:0,broken:0}:") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "parse_errors[") == null);
    try std.testing.expect(std.mem.indexOf(u8, out, "stale[") == null);
    try std.testing.expect(std.mem.indexOf(u8, out, "broken[") == null);
}
