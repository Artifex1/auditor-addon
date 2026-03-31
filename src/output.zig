const std = @import("std");
const graph = @import("graph.zig");

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

pub fn writeToonGaps(g: *const graph.SymbolGraph, writer: Writer) !void {
    const gap_count = g.gapCount();
    try writer.print("gaps[{d}]{{ref_id,from_name,target_name,kind,file,line,priority}}:\n", .{gap_count});

    for (g.refs.items) |ref| {
        if (ref.gap) |priority| {
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
        for (ref.targets.items, 0..) |target, i| {
            if (i > 0) try writer.writeAll(",");
            try writer.print("{x}", .{target});
        }
        try writer.print("],{d},{s}\n", .{
            ref.site.line,
            if (ref.gap) |priority| @tagName(priority) else "",
        });
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
    for (g.refs.items) |ref| {
        if (ref.gap) |priority| {
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
        for (ref.targets.items, 0..) |target, i| {
            if (i > 0) try writer.writeAll(",");
            try writer.print("\"{x}\"", .{target});
        }
        try writer.print("],\"site_line\":{d}", .{ref.site.line});
        if (ref.gap) |priority| {
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

// ── Tests ──────────────────────────────────────────────────────────────

fn makeTestRef(id: u64, from: u64, target_name: []const u8, kind: graph.RefKind, file: []const u8, line: u32, gap: ?graph.Priority) graph.Reference {
    return .{
        .id = id,
        .from = from,
        .kind = kind,
        .target_name = target_name,
        .site = .{ .file = file, .start_byte = 0, .end_byte = 0, .line = line, .column = 0 },
        .targets = .empty,
        .gap = gap,
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
    try g.addRef(makeTestRef(0xabc, 0x123, "onlyOwner", .modifier_use, "src/Vault.sol", 10, .high));

    // Add a ref without gap (should be excluded)
    try g.addRef(makeTestRef(0xdef, 0x123, "deposit", .call, "src/Vault.sol", 20, null));

    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try writeToonGaps(&g, &w);
    try w.flush();

    const out = buf[0..w.end];
    try std.testing.expect(std.mem.indexOf(u8, out, "gaps[1]") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "onlyOwner") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "modifier_use") != null);
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
    try writeJsonGaps(&g, &w);
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
