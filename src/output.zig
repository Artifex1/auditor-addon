const std = @import("std");
const graph = @import("graph.zig");

const Writer = *std.Io.Writer;

// ── TOON: Gaps ────────────────────────────────────────────────────────
// SPEC.md §8.1

pub fn writeToonGaps(g: *const graph.SymbolGraph, writer: Writer) !void {
    const gap_count = g.gapCount();
    try writer.print("gaps[{d}]{{from,expected_target,edge_kind,file,line,priority}}:\n", .{gap_count});

    var it = g.gaps.iterator();
    while (it.next()) |entry| {
        const gap = entry.value_ptr.*;
        try writer.print("  {x},{s},{s},{s},{d},{s}\n", .{
            gap.from,
            gap.expected_target,
            @tagName(gap.edge_kind),
            if (gap.call_site) |cs| cs.file else "",
            if (gap.call_site) |cs| cs.line else 0,
            @tagName(gap.priority),
        });
    }
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

    // Edges
    try writer.print("edges[{d}]{{from,to,kind,call_site_line}}:\n", .{g.edgeCount()});
    for (g.edges.items) |edge| {
        try writer.print("  {x},{x},{s},", .{
            edge.from,
            edge.to,
            @tagName(edge.kind),
        });
        if (edge.attrs) |a| {
            if (a.call_site_line) |line| {
                try writer.print("{d}", .{line});
            }
        }
        try writer.writeAll("\n");
    }
}

// ── TOON: Findings ────────────────────────────────────────────────────
// SPEC.md §8.1

pub const Finding = struct {
    rule_id: []const u8,
    severity: []const u8,
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
        try writer.print("  {s}{{severity:{s},name:{s},hits[{d}]{{file,line,node_text}}}}:\n", .{
            f.rule_id,
            f.severity,
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

pub fn writeJsonGaps(g: *const graph.SymbolGraph, writer: Writer) !void {
    try writer.writeAll("{\"gaps\":[");
    var first = true;
    var it = g.gaps.iterator();
    while (it.next()) |entry| {
        const gap = entry.value_ptr.*;
        if (!first) try writer.writeAll(",");
        first = false;
        try writer.print("{{\"id\":\"{x}\",\"from\":\"{x}\",\"expected_target\":\"{s}\",\"edge_kind\":\"{s}\",\"file\":\"{s}\",\"line\":{d},\"priority\":\"{s}\"}}", .{
            gap.id,
            gap.from,
            gap.expected_target,
            @tagName(gap.edge_kind),
            if (gap.call_site) |cs| cs.file else "",
            if (gap.call_site) |cs| cs.line else 0,
            @tagName(gap.priority),
        });
    }
    try writer.writeAll("]}\n");
}

pub fn writeJsonGraph(g: *const graph.SymbolGraph, writer: Writer) !void {
    try writer.writeAll("{\"nodes\":[");
    var first = true;
    var node_it = g.nodes.iterator();
    while (node_it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (!first) try writer.writeAll(",");
        first = false;
        try writer.print("{{\"id\":\"{x}\",\"kind\":\"{s}\",\"name\":\"{s}\",\"qualified_name\":\"{s}\",\"visibility\":\"{s}\",\"language\":\"{s}\",\"file\":\"{s}\",\"line\":{d}}}", .{
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

    try writer.writeAll("],\"edges\":[");
    first = true;
    for (g.edges.items) |edge| {
        if (!first) try writer.writeAll(",");
        first = false;
        try writer.print("{{\"from\":\"{x}\",\"to\":\"{x}\",\"kind\":\"{s}\"}}", .{
            edge.from,
            edge.to,
            @tagName(edge.kind),
        });
    }
    try writer.writeAll("]}\n");
}

pub fn writeJsonMetrics(files: []const FileMetricsOutput, writer: Writer) !void {
    try writer.writeAll("{\"files\":[");
    for (files, 0..) |f, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.print("{{\"file\":\"{s}\",\"nLOC\":{d},\"cognitiveComplexity\":{d},\"complexityPer100\":{d},\"commentDensity\":{d},\"estimatedHours\":{d:.2}}}", .{
            f.file,
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
        try writer.print("{{\"file\":\"{s}\",\"signatures\":[", .{f.file});
        for (f.signatures, 0..) |sig, j| {
            if (j > 0) try writer.writeAll(",");
            try writer.print("\"{s}\"", .{sig});
        }
        try writer.writeAll("]}");
    }
    try writer.writeAll("]}\n");
}

pub fn writeJsonCallChains(roots: []const RootChains, writer: Writer) !void {
    try writer.writeAll("{\"roots\":[");
    for (roots, 0..) |root, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.print("{{\"name\":\"{s}\",\"chains\":[", .{root.root_name});
        for (root.chains, 0..) |chain, j| {
            if (j > 0) try writer.writeAll(",");
            try writer.print("\"{s}\"", .{chain});
        }
        try writer.writeAll("]}");
    }
    try writer.writeAll("]}\n");
}

// ── Tests ──────────────────────────────────────────────────────────────

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

test "writeToonGaps formats gap rows" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    _ = try g.addGap(.{
        .id = 0xabc,
        .from = 0x123,
        .expected_target = "onlyOwner",
        .edge_kind = .calls,
        .priority = .high,
    });

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try writeToonGaps(&g, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "gaps[1]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "onlyOwner") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "calls") != null);
}

test "writeJsonGaps produces valid structure" {
    var g = graph.SymbolGraph.init(std.testing.allocator);
    defer g.deinit();

    _ = try g.addGap(.{
        .id = 0xabc,
        .from = 0x123,
        .expected_target = "transfer",
        .edge_kind = .calls,
        .priority = .medium,
    });

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try writeJsonGaps(&g, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.startsWith(u8, out, "{\"gaps\":["));
    try std.testing.expect(std.mem.indexOf(u8, out, "transfer") != null);
}
