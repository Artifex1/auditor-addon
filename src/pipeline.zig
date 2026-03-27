const std = @import("std");
const ts = @import("tree-sitter");
const graph = @import("graph.zig");
const cfg = @import("languages/config.zig");

// ── SPEC.md §3 & §4 — Pipeline ────────────────────────────────────────
//
// Single-pass walk + import expansion + deferred resolution.
// No persistence. Full pipeline runs from scratch on every invocation.

pub const Pipeline = struct {
    graph: graph.SymbolGraph,
    allocator: std.mem.Allocator,
    lang_config: *const cfg.LanguageConfig,

    // Parser instance (reused across files)
    parser: *ts.Parser,

    // Parsed trees keyed by file path — kept alive for ast_node references (§15.5)
    trees: std.StringHashMapUnmanaged(*ts.Tree),

    // Source text keyed by file path — kept alive for text slicing
    sources: std.StringHashMapUnmanaged([]const u8),

    // Files already walked (dedup)
    walked_files: std.StringHashMapUnmanaged(void),

    // Container stack for qualified name construction (§4.1)
    container_stack: std.ArrayList(ContainerFrame),

    const ContainerFrame = struct {
        id: u64,
        name: []const u8,
    };

    pub fn init(allocator: std.mem.Allocator, lang_config: *const cfg.LanguageConfig) !Pipeline {
        const parser = ts.Parser.create();
        try parser.setLanguage(lang_config.language.grammarFn()());

        return .{
            .graph = graph.SymbolGraph.init(allocator),
            .allocator = allocator,
            .lang_config = lang_config,
            .parser = parser,
            .trees = .empty,
            .sources = .empty,
            .walked_files = .empty,
            .container_stack = .empty,
        };
    }

    pub fn deinit(self: *Pipeline) void {
        // Destroy all parsed trees
        var tree_it = self.trees.iterator();
        while (tree_it.next()) |entry| {
            entry.value_ptr.*.destroy();
        }
        self.trees.deinit(self.allocator);

        // Free all source buffers
        var src_it = self.sources.iterator();
        while (src_it.next()) |entry| {
            self.allocator.free(entry.value_ptr.*);
        }
        self.sources.deinit(self.allocator);

        self.walked_files.deinit(self.allocator);
        self.container_stack.deinit(self.allocator);
        self.parser.destroy();
        self.graph.deinit();
    }

    // ── Main Entry Point (§3.2) ───────────────────────────────────────

    /// Run the full pipeline: parse → walk → expand imports → resolve.
    pub fn run(self: *Pipeline, file_paths: []const []const u8, no_expand: bool) !void {
        // Seed the work queue
        var queue: std.ArrayList([]const u8) = .empty;
        defer queue.deinit(self.allocator);
        for (file_paths) |path| {
            try queue.append(self.allocator, path);
        }

        // Walk phase: parse and walk files, collecting PendingRefs
        var queue_idx: usize = 0;
        while (queue_idx < queue.items.len) {
            const path = queue.items[queue_idx];
            queue_idx += 1;

            if (self.walked_files.contains(path)) continue;
            try self.walked_files.put(self.allocator, path, {});

            try self.parseAndWalkFile(path);

            // Import expansion (§3.4): process import PendingRefs, queue new files
            if (!no_expand) {
                try self.expandImports(&queue);
            }
        }

        // Resolution phase (§4.1)
        try self.resolve();
    }

    // ── File Parsing & Walking ────────────────────────────────────────

    fn parseAndWalkFile(self: *Pipeline, file_path: []const u8) !void {
        // Read file
        const source = try self.readFile(file_path);

        // Parse with tree-sitter
        const tree = self.parser.parseString(source, null) orelse return error.ParseFailed;
        try self.trees.put(self.allocator, file_path, tree);

        // Create file node (§2.2: every file parsed becomes a file node)
        const file_line: u32 = 1;
        const file_node_id = graph.nodeId(file_path, file_path, file_line);
        _ = try self.graph.addNode(.{
            .id = file_node_id,
            .kind = .file,
            .language_kind = "source_file",
            .name = file_path,
            .qualified_name = file_path,
            .language = self.lang_config.language,
            .locator = .{
                .file = file_path,
                .start_byte = 0,
                .end_byte = @intCast(source.len),
                .line = 1,
                .column = 0,
            },
        });

        // Push file onto container stack
        try self.container_stack.append(self.allocator, .{ .id = file_node_id, .name = file_path });

        // Walk the AST
        try self.walkTree(tree, source, file_path);

        // Pop file from container stack
        _ = self.container_stack.pop();
    }

    fn readFile(self: *Pipeline, file_path: []const u8) ![]const u8 {
        const file = try std.fs.cwd().openFile(file_path, .{});
        defer file.close();

        const stat = try file.stat();
        const source = try self.allocator.alloc(u8, stat.size);
        const bytes_read = try file.readAll(source);
        const result = source[0..bytes_read];

        try self.sources.put(self.allocator, file_path, result);
        return result;
    }

    // ── AST Walk (§4.1) ──────────────────────────────────────────────

    fn walkTree(self: *Pipeline, tree: *const ts.Tree, source: []const u8, file_path: []const u8) !void {
        var cursor = tree.walk();
        defer cursor.destroy();

        var descend = true;
        while (true) {
            if (descend) {
                const node = cursor.node();
                try self.processNode(node, source, file_path);
            }

            if (descend and cursor.gotoFirstChild()) continue;

            // On exit: check if we're leaving a container body
            {
                const node = cursor.node();
                self.maybePopContainer(node);
            }

            descend = true;
            if (cursor.gotoNextSibling()) continue;

            while (true) {
                if (!cursor.gotoParent()) return;
                {
                    const parent_node = cursor.node();
                    self.maybePopContainer(parent_node);
                }
                if (cursor.gotoNextSibling()) break;
            }
        }
    }

    fn processNode(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8) !void {
        const kind = node.kind();
        const lc = self.lang_config;

        // Check containers
        for (lc.containers) |mapping| {
            if (std.mem.eql(u8, kind, mapping.ts_type)) {
                try self.processContainer(node, source, file_path, mapping);
                return;
            }
        }

        // Check callables
        for (lc.callables) |mapping| {
            if (std.mem.eql(u8, kind, mapping.ts_type)) {
                try self.processCallable(node, source, file_path, mapping);
                return;
            }
        }

        // Check variables
        for (lc.variables) |mapping| {
            if (std.mem.eql(u8, kind, mapping.ts_type)) {
                try self.processVariable(node, source, file_path, mapping);
                return;
            }
        }

        // Check modifiers
        for (lc.modifiers) |mapping| {
            if (std.mem.eql(u8, kind, mapping.ts_type)) {
                try self.processModifier(node, source, file_path, mapping);
                return;
            }
        }

        // Check events
        for (lc.events) |mapping| {
            if (std.mem.eql(u8, kind, mapping.ts_type)) {
                try self.processEvent(node, source, file_path, mapping);
                return;
            }
        }

        // Check call expressions
        if (std.mem.eql(u8, kind, lc.call_expression.ts_type)) {
            try self.processCallExpression(node, source, file_path);
            return;
        }

        // Check inheritance
        if (lc.inheritance) |inh| {
            if (std.mem.eql(u8, kind, inh.ts_type)) {
                try self.processInheritance(node, source, file_path, inh);
                return;
            }
        }

        // Check modifier invocations
        if (lc.modifier_invocation) |mi| {
            if (std.mem.eql(u8, kind, mi.ts_type)) {
                try self.processModifierInvocation(node, source, file_path, mi);
                return;
            }
        }

        // Check emit expressions
        if (lc.emit_expression) |em| {
            if (std.mem.eql(u8, kind, em.ts_type)) {
                try self.processEmit(node, source, file_path, em);
                return;
            }
        }

        // Check write expressions
        for (lc.write_expressions) |wp| {
            if (std.mem.eql(u8, kind, wp.ts_type)) {
                try self.processWrite(node, source, file_path, wp);
                return;
            }
        }

        // Check imports
        if (lc.imports) |imp| {
            if (std.mem.eql(u8, kind, imp.ts_type)) {
                try self.processImport(node, source, file_path, imp);
                return;
            }
        }

        // Custom handler
        if (lc.custom_handler) |handler| {
            handler(&self.graph, node, source);
        }
    }

    // ── Node Processors ──────────────────────────────────────────────

    fn processContainer(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.ContainerMapping) !void {
        const name = self.nodeText(node, source, mapping.name_field) orelse return;
        const line = node.startPoint().row + 1;
        const id = graph.nodeId(name, file_path, line);
        const container_id = self.currentContainer();
        const qualified = try self.buildQualifiedName(name);

        const gn = try self.graph.addNode(.{
            .id = id,
            .kind = .container,
            .language_kind = node.kind(),
            .name = name,
            .qualified_name = qualified,
            .container = container_id,
            .language = self.lang_config.language,
            .ast_node = node,
            .locator = self.makeLocator(node, file_path),
        });

        // Extract properties
        try self.extractProperties(node, source, mapping.properties, gn);

        // Emit contains edge from parent container
        if (container_id) |cid| {
            try self.graph.addEdge(.{ .from = cid, .to = id, .kind = .contains });
        }

        // Push container body onto stack (§4.1)
        if (node.childByFieldName(mapping.body_field)) |_| {
            try self.container_stack.append(self.allocator, .{ .id = id, .name = name });
        }
    }

    fn processCallable(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.CallableMapping) !void {
        const name = if (mapping.name_field) |nf|
            self.nodeText(node, source, nf) orelse node.kind()
        else
            node.kind();

        const line = node.startPoint().row + 1;
        const id = graph.nodeId(name, file_path, line);
        const container_id = self.currentContainer();
        const qualified = try self.buildQualifiedName(name);

        const gn = try self.graph.addNode(.{
            .id = id,
            .kind = .callable,
            .language_kind = node.kind(),
            .name = name,
            .qualified_name = qualified,
            .container = container_id,
            .language = self.lang_config.language,
            .ast_node = node,
            .locator = self.makeLocator(node, file_path),
        });

        try self.extractProperties(node, source, mapping.properties, gn);

        // Set visibility from extracted properties
        if (gn.properties.get("visibility")) |vis| {
            gn.visibility = vis;
        }

        // Emit contains edge
        if (container_id) |cid| {
            try self.graph.addEdge(.{ .from = cid, .to = id, .kind = .contains });
        }
    }

    fn processVariable(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.VariableMapping) !void {
        const name = self.nodeText(node, source, mapping.name_field) orelse return;
        const line = node.startPoint().row + 1;
        const id = graph.nodeId(name, file_path, line);
        const container_id = self.currentContainer();
        const qualified = try self.buildQualifiedName(name);

        const gn = try self.graph.addNode(.{
            .id = id,
            .kind = .variable,
            .language_kind = node.kind(),
            .name = name,
            .qualified_name = qualified,
            .container = container_id,
            .language = self.lang_config.language,
            .ast_node = node,
            .locator = self.makeLocator(node, file_path),
        });

        try self.extractProperties(node, source, mapping.properties, gn);

        if (gn.properties.get("visibility")) |vis| {
            gn.visibility = vis;
        }

        if (container_id) |cid| {
            try self.graph.addEdge(.{ .from = cid, .to = id, .kind = .contains });
        }
    }

    fn processModifier(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.ModifierMapping) !void {
        const name = self.nodeText(node, source, mapping.name_field) orelse return;
        const line = node.startPoint().row + 1;
        const id = graph.nodeId(name, file_path, line);
        const container_id = self.currentContainer();
        const qualified = try self.buildQualifiedName(name);

        const gn = try self.graph.addNode(.{
            .id = id,
            .kind = .modifier,
            .language_kind = node.kind(),
            .name = name,
            .qualified_name = qualified,
            .container = container_id,
            .language = self.lang_config.language,
            .ast_node = node,
            .locator = self.makeLocator(node, file_path),
        });

        try self.extractProperties(node, source, mapping.properties, gn);

        if (container_id) |cid| {
            try self.graph.addEdge(.{ .from = cid, .to = id, .kind = .contains });
        }
    }

    fn processEvent(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.EventMapping) !void {
        const name = self.nodeText(node, source, mapping.name_field) orelse return;
        const line = node.startPoint().row + 1;
        const id = graph.nodeId(name, file_path, line);
        const container_id = self.currentContainer();
        const qualified = try self.buildQualifiedName(name);

        const gn = try self.graph.addNode(.{
            .id = id,
            .kind = .event,
            .language_kind = node.kind(),
            .name = name,
            .qualified_name = qualified,
            .container = container_id,
            .language = self.lang_config.language,
            .ast_node = node,
            .locator = self.makeLocator(node, file_path),
        });

        try self.extractProperties(node, source, mapping.properties, gn);

        if (container_id) |cid| {
            try self.graph.addEdge(.{ .from = cid, .to = id, .kind = .contains });
        }
    }

    // ── Reference Processors ─────────────────────────────────────────

    fn processCallExpression(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8) !void {
        const lc = self.lang_config;
        const callee_node = node.childByFieldName(lc.call_expression.function_field) orelse return;

        // Extract target name — rightmost identifier for member calls, bare for simple
        const target_name = self.extractCalleeName(callee_node, source) orelse return;

        // Filter builtins
        if (self.isBuiltin(target_name, callee_node, source)) return;

        // Check if this is a write-call (e.g., items.push(x))
        if (self.isWriteCallMethod(callee_node, source)) {
            // Record as state_write
            const receiver_name = self.extractReceiverName(callee_node, source) orelse return;
            try self.addPendingRef(receiver_name, .state_write, node, file_path);
            return;
        }

        try self.addPendingRef(target_name, .call, node, file_path);
    }

    fn processInheritance(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.InheritanceMapping) !void {
        const name_node = node.childByFieldName(mapping.name_field) orelse return;
        const target = self.extractIdentifierText(name_node, source) orelse return;
        try self.addPendingRef(target, .inheritance, node, file_path);
    }

    fn processModifierInvocation(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.ModifierInvocationMapping) !void {
        const name = self.nodeText(node, source, mapping.name_field) orelse return;
        try self.addPendingRef(name, .modifier_use, node, file_path);
    }

    fn processEmit(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.EmitMapping) !void {
        const name = self.nodeText(node, source, mapping.name_field) orelse return;
        try self.addPendingRef(name, .event_emit, node, file_path);
    }

    fn processWrite(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, wp: cfg.WritePattern) !void {
        const target_node = node.childByFieldName(wp.target_field) orelse return;

        // Unwrap to root identifier (§4.2)
        const root_name = unwrapToRoot(target_node, source, self.lang_config) orelse return;
        try self.addPendingRef(root_name, .state_write, node, file_path);

        // Also record the read side for augmented assignments
        // (e.g., `totalSupply += amount` reads both `totalSupply` and `amount`)
    }

    fn processImport(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.ImportMapping) !void {
        const path_node = node.childByFieldName(mapping.path_field) orelse return;
        const raw_path = source[path_node.startByte()..path_node.endByte()];

        // Strip quotes from import path
        const import_path = std.mem.trim(u8, raw_path, "\"'");

        const from = self.currentContainer() orelse return;
        try self.graph.addPendingRef(.{
            .from = from,
            .container = from,
            .target_name = import_path,
            .call_site = self.makeLocator(node, file_path),
            .kind = .import,
        });
    }

    // ── Expression Unwrapping (§4.2) ─────────────────────────────────

    pub fn unwrapToRoot(node: ts.Node, source: []const u8, lang_config: *const cfg.LanguageConfig) ?[]const u8 {
        var current = node;
        while (true) {
            const node_type = current.kind();
            if (std.mem.eql(u8, node_type, lang_config.identifier_type)) {
                return source[current.startByte()..current.endByte()];
            }
            // Try each unwrap rule
            var matched = false;
            for (lang_config.unwrap_rules) |rule| {
                if (std.mem.eql(u8, node_type, rule.ts_type)) {
                    current = current.childByFieldName(rule.child_field) orelse return null;
                    matched = true;
                    break;
                }
            }
            if (!matched) return null;
        }
    }

    // ── Import Expansion (§3.4) ──────────────────────────────────────

    fn expandImports(self: *Pipeline, queue: *std.ArrayList([]const u8)) !void {
        // Process import PendingRefs: resolve paths, queue new files
        var i: usize = 0;
        while (i < self.graph.pending_refs.items.len) {
            const ref = self.graph.pending_refs.items[i];
            if (ref.kind == .import) {
                // Try to resolve import path to file on disk
                if (self.resolveImportPath(ref.target_name)) |resolved_path| {
                    // Emit imports edge
                    try self.graph.addEdge(.{
                        .from = ref.from,
                        .to = graph.nodeId(resolved_path, resolved_path, 1),
                        .kind = .imports,
                    });

                    // Queue file for walking
                    if (!self.walked_files.contains(resolved_path)) {
                        try queue.append(self.allocator, resolved_path);
                    }

                    // Remove from pending (it's resolved)
                    _ = self.graph.pending_refs.swapRemove(i);
                    continue;
                }
            }
            i += 1;
        }
    }

    fn resolveImportPath(self: *Pipeline, raw_path: []const u8) ?[]const u8 {
        _ = self;
        // Try the path as-is relative to cwd
        std.fs.cwd().access(raw_path, .{}) catch return null;
        return raw_path;
    }

    // ── Resolution Phase (§4.1) ──────────────────────────────────────

    fn resolve(self: *Pipeline) !void {
        // Step 1: Create import gaps, then resolve inheritance
        var i: usize = 0;
        while (i < self.graph.pending_refs.items.len) {
            const ref = self.graph.pending_refs.items[i];
            switch (ref.kind) {
                .import => {
                    // Unresolved import → EdgeGap
                    const gap_id = graph.gapId(ref.from, ref.target_name, .imports);
                    _ = try self.graph.addGap(.{
                        .id = gap_id,
                        .from = ref.from,
                        .expected_target = ref.target_name,
                        .edge_kind = .imports,
                        .call_site = ref.call_site,
                        .priority = .high,
                    });
                    _ = self.graph.pending_refs.swapRemove(i);
                    continue;
                },
                .inheritance => {
                    // Try to resolve inheritance
                    if (self.graph.lookupContainerByName(ref.target_name)) |parent_node| {
                        try self.graph.addEdge(.{
                            .from = ref.container,
                            .to = parent_node.id,
                            .kind = .inherits,
                        });
                    } else {
                        const gap_id = graph.gapId(ref.from, ref.target_name, .inherits);
                        _ = try self.graph.addGap(.{
                            .id = gap_id,
                            .from = ref.from,
                            .expected_target = ref.target_name,
                            .edge_kind = .inherits,
                            .call_site = ref.call_site,
                            .priority = .high,
                        });
                    }
                    _ = self.graph.pending_refs.swapRemove(i);
                    continue;
                },
                else => {},
            }
            i += 1;
        }

        // Step 2: Resolve all other references
        while (self.graph.pending_refs.items.len > 0) {
            const ref = self.graph.pending_refs.pop().?;
            switch (ref.kind) {
                .call => {
                    if (self.resolveInScope(ref.container, ref.target_name, .callable)) |target| {
                        try self.graph.addEdge(.{
                            .from = ref.from,
                            .to = target.id,
                            .kind = .calls,
                            .attrs = .{
                                .call_site_byte = ref.call_site.start_byte,
                                .call_site_line = ref.call_site.line,
                            },
                        });
                    } else {
                        const gap_id = graph.gapId(ref.from, ref.target_name, .calls);
                        _ = try self.graph.addGap(.{
                            .id = gap_id,
                            .from = ref.from,
                            .expected_target = ref.target_name,
                            .edge_kind = .calls,
                            .call_site = ref.call_site,
                            .priority = .medium,
                        });
                    }
                },
                .state_read => {
                    // §4.1: state_read → edge or drop
                    if (self.resolveInScope(ref.container, ref.target_name, .variable)) |target| {
                        try self.graph.addEdge(.{
                            .from = ref.from,
                            .to = target.id,
                            .kind = .reads,
                        });
                    }
                    // else: drop — likely a local or parameter
                },
                .state_write => {
                    // §4.1: state_write → edge or drop
                    if (self.resolveInScope(ref.container, ref.target_name, .variable)) |target| {
                        try self.graph.addEdge(.{
                            .from = ref.from,
                            .to = target.id,
                            .kind = .writes,
                        });
                    }
                },
                .modifier_use => {
                    if (self.resolveInScope(ref.container, ref.target_name, .modifier)) |target| {
                        try self.graph.addEdge(.{
                            .from = ref.from,
                            .to = target.id,
                            .kind = .has_modifier,
                        });
                    } else {
                        const gap_id = graph.gapId(ref.from, ref.target_name, .has_modifier);
                        _ = try self.graph.addGap(.{
                            .id = gap_id,
                            .from = ref.from,
                            .expected_target = ref.target_name,
                            .edge_kind = .has_modifier,
                            .call_site = ref.call_site,
                            .priority = .high,
                        });
                    }
                },
                .event_emit => {
                    // §4.1: event_emit → edge or drop
                    if (self.resolveInScope(ref.container, ref.target_name, .event)) |target| {
                        try self.graph.addEdge(.{
                            .from = ref.from,
                            .to = target.id,
                            .kind = .emits,
                        });
                    }
                },
                else => {}, // import/inheritance handled in step 1
            }
        }
    }

    /// Scoped resolution: check own container, then walk inheritance chain (§4.1).
    fn resolveInScope(self: *Pipeline, container_id: u64, name: []const u8, expected_kind: graph.NodeKind) ?*graph.GraphNode {
        // Check own container first
        if (self.graph.lookupChildByName(container_id, name, expected_kind)) |found| {
            return found;
        }

        // Walk parents in language-defined order (§4.3)
        const parents = self.getInheritanceChain(container_id);
        for (parents) |parent_id| {
            if (self.graph.lookupChildByName(parent_id, name, expected_kind)) |found| {
                return found;
            }
        }

        return null;
    }

    /// Get the inheritance chain for a container per §4.3.
    fn getInheritanceChain(self: *Pipeline, container_id: u64) []const u64 {
        // For now, walk inherits edges directly.
        // TODO: implement strategy-specific ordering (C3, embedded_promotion, etc.)
        const edges = self.graph.getOutgoingEdges(container_id, .inherits, self.allocator) catch return &.{};
        defer self.allocator.free(edges);

        var chain: std.ArrayList(u64) = .empty;
        for (edges) |edge| {
            chain.append(self.allocator, edge.to) catch {};
        }
        return chain.toOwnedSlice(self.allocator) catch &.{};
    }

    // ── Helpers ──────────────────────────────────────────────────────

    fn currentContainer(self: *const Pipeline) ?u64 {
        if (self.container_stack.items.len == 0) return null;
        return self.container_stack.items[self.container_stack.items.len - 1].id;
    }

    fn buildQualifiedName(self: *Pipeline, name: []const u8) ![]const u8 {
        if (self.container_stack.items.len <= 1) {
            // Only file on the stack — top-level declaration
            return try self.graph.dupeString(name);
        }

        // Build: "Container1.Container2.name"
        var parts: std.ArrayList([]const u8) = .empty;
        defer parts.deinit(self.allocator);

        // Skip the file frame (index 0), include all container frames
        for (self.container_stack.items[1..]) |frame| {
            try parts.append(self.allocator, frame.name);
        }
        try parts.append(self.allocator, name);

        return try std.mem.join(self.graph.arena.allocator(), ".", parts.items);
    }

    fn nodeText(self: *const Pipeline, node: ts.Node, source: []const u8, field_name: []const u8) ?[]const u8 {
        _ = self;
        const child = node.childByFieldName(field_name) orelse return null;
        const start = child.startByte();
        const end = child.endByte();
        if (start >= end or start >= source.len) return null;
        return source[start..@min(end, @as(u32, @intCast(source.len)))];
    }

    fn extractCalleeName(self: *const Pipeline, callee_node: ts.Node, source: []const u8) ?[]const u8 {
        const kind = callee_node.kind();

        // Simple identifier call: `withdraw()`
        if (std.mem.eql(u8, kind, self.lang_config.identifier_type)) {
            return source[callee_node.startByte()..callee_node.endByte()];
        }

        // Member expression: `vault.withdraw()` → extract rightmost identifier
        if (std.mem.eql(u8, kind, "member_expression") or
            std.mem.eql(u8, kind, "field_expression"))
        {
            // Try "property" field (JS/TS), then "field" (Rust/Cairo)
            const field_node = callee_node.childByFieldName("property") orelse
                callee_node.childByFieldName("field") orelse
                return null;
            return source[field_node.startByte()..field_node.endByte()];
        }

        // Solidity expression wrapper
        if (std.mem.eql(u8, kind, "expression")) {
            if (callee_node.child(0)) |inner| {
                return self.extractCalleeName(inner, source);
            }
        }

        return null;
    }

    fn extractReceiverName(self: *const Pipeline, callee_node: ts.Node, source: []const u8) ?[]const u8 {
        if (std.mem.eql(u8, callee_node.kind(), "member_expression") or
            std.mem.eql(u8, callee_node.kind(), "field_expression"))
        {
            const object = callee_node.childByFieldName("object") orelse return null;
            return unwrapToRoot(object, source, self.lang_config);
        }
        return null;
    }

    fn extractIdentifierText(self: *const Pipeline, node: ts.Node, source: []const u8) ?[]const u8 {
        // Walk down to find the identifier
        if (std.mem.eql(u8, node.kind(), self.lang_config.identifier_type)) {
            return source[node.startByte()..node.endByte()];
        }
        // Try first named child
        if (node.namedChild(0)) |child| {
            return self.extractIdentifierText(child, source);
        }
        return null;
    }

    fn isBuiltin(self: *const Pipeline, name: []const u8, callee_node: ts.Node, source: []const u8) bool {
        // Check builtin function names
        for (self.lang_config.builtin_functions) |builtin| {
            if (std.mem.eql(u8, name, builtin)) return true;
        }

        // Check builtin receivers (e.g., msg.sender, block.timestamp)
        if (std.mem.eql(u8, callee_node.kind(), "member_expression")) {
            if (callee_node.childByFieldName("object")) |obj| {
                const obj_name = source[obj.startByte()..obj.endByte()];
                for (self.lang_config.builtin_receivers) |builtin| {
                    if (std.mem.eql(u8, obj_name, builtin)) return true;
                }
            }
        }

        return false;
    }

    fn isWriteCallMethod(self: *const Pipeline, callee_node: ts.Node, source: []const u8) bool {
        if (std.mem.eql(u8, callee_node.kind(), "member_expression")) {
            if (callee_node.childByFieldName("property")) |prop| {
                const method_name = source[prop.startByte()..prop.endByte()];
                for (self.lang_config.write_call_methods) |wcm| {
                    if (std.mem.eql(u8, method_name, wcm)) return true;
                }
            }
        }
        return false;
    }

    fn makeLocator(self: *const Pipeline, node: ts.Node, file_path: []const u8) graph.SourceLocator {
        _ = self;
        return .{
            .file = file_path,
            .start_byte = node.startByte(),
            .end_byte = node.endByte(),
            .line = node.startPoint().row + 1,
            .column = node.startPoint().column,
        };
    }

    fn addPendingRef(self: *Pipeline, target_name: []const u8, kind: graph.RefKind, node: ts.Node, file_path: []const u8) !void {
        const from = self.currentContainer() orelse return;
        try self.graph.addPendingRef(.{
            .from = from,
            .container = from,
            .target_name = target_name,
            .call_site = self.makeLocator(node, file_path),
            .kind = kind,
        });
    }

    fn maybePopContainer(self: *Pipeline, node: ts.Node) void {
        // Pop container when we exit its body node
        if (self.container_stack.items.len <= 1) return; // keep file frame

        const top = self.container_stack.items[self.container_stack.items.len - 1];
        const top_node = self.graph.lookupNode(top.id) orelse return;
        const ast = top_node.ast_node orelse return;

        // Check if node is the container's body
        const kind = top_node.language_kind;
        for (self.lang_config.containers) |mapping| {
            if (std.mem.eql(u8, kind, mapping.ts_type)) {
                if (ast.childByFieldName(mapping.body_field)) |body| {
                    if (node.endByte() >= body.endByte()) {
                        _ = self.container_stack.pop();
                    }
                }
                return;
            }
        }
    }

    fn extractProperties(self: *Pipeline, node: ts.Node, source: []const u8, properties: []const cfg.PropertyExtractor, gn: *graph.GraphNode) !void {
        for (properties) |prop| {
            // Walk children looking for the child_type
            var child_idx: u32 = 0;
            while (child_idx < node.childCount()) : (child_idx += 1) {
                if (node.child(child_idx)) |child| {
                    if (std.mem.eql(u8, child.kind(), prop.child_type)) {
                        const val = source[child.startByte()..child.endByte()];
                        const key = try self.graph.dupeString(prop.key);
                        const value = try self.graph.dupeString(val);
                        try gn.properties.put(self.graph.arena.allocator(), key, value);
                        break;
                    }
                }
            }
        }
    }
};
