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

    // Scope stack for nesting context (§4.1)
    scope_stack: std.ArrayList(ScopeFrame),

    const ScopeFrame = struct {
        id: u64,
        name: []const u8,
        kind: graph.NodeKind,
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
            .scope_stack = .empty,
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
        self.scope_stack.deinit(self.allocator);
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

        // Walk phase: parse and walk files, collecting References
        var queue_idx: usize = 0;
        while (queue_idx < queue.items.len) {
            const path = queue.items[queue_idx];
            queue_idx += 1;

            if (self.walked_files.contains(path)) continue;
            try self.walked_files.put(self.allocator, path, {});

            try self.parseAndWalkFile(path);

            // Import expansion (§3.4): process import refs, queue new files
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
        errdefer tree.destroy();
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
            .ast_node = tree.rootNode(),
            .locator = .{
                .file = file_path,
                .start_byte = 0,
                .end_byte = @intCast(source.len),
                .line = 1,
                .column = 0,
            },
        });

        // Push file onto scope stack
        try self.scope_stack.append(self.allocator, .{ .id = file_node_id, .name = file_path, .kind = .file });

        // Walk the AST
        try self.walkTree(tree, source, file_path);

        // Pop file from container stack
        _ = self.scope_stack.pop();
    }

    fn readFile(self: *Pipeline, file_path: []const u8) ![]const u8 {
        const file = try std.fs.cwd().openFile(file_path, .{});
        defer file.close();

        const stat = try file.stat();
        const source = try self.allocator.alloc(u8, stat.size);
        errdefer self.allocator.free(source);
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
                self.maybePopScope(node);
            }

            descend = true;
            if (cursor.gotoNextSibling()) continue;

            while (true) {
                if (!cursor.gotoParent()) return;
                {
                    const parent_node = cursor.node();
                    self.maybePopScope(parent_node);
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
            try self.graph.addContains(cid, id);
        }

        // Push container onto scope stack (§4.1)
        if (node.childByFieldName(mapping.body_field)) |_| {
            try self.scope_stack.append(self.allocator, .{ .id = id, .name = name, .kind = .container });
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
            try self.graph.addContains(cid, id);
        }

        // Push callable onto scope stack (§4.1)
        if (mapping.body_field) |bf| {
            if (node.childByFieldName(bf)) |_| {
                try self.scope_stack.append(self.allocator, .{ .id = id, .name = name, .kind = .callable });
            }
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
            try self.graph.addContains(cid, id);
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
            try self.graph.addContains(cid, id);
        }

        // Push modifier onto scope stack (§4.1)
        if (mapping.body_field) |bf| {
            if (node.childByFieldName(bf)) |_| {
                try self.scope_stack.append(self.allocator, .{ .id = id, .name = name, .kind = .modifier });
            }
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
            try self.graph.addContains(cid, id);
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
        if (self.isWriteCallMethod(target_name)) {
            // Record as state_write
            const receiver_name = self.extractReceiverName(callee_node, source) orelse return;
            try self.addReference(receiver_name, .state_write, node, file_path);
            return;
        }

        try self.addReference(target_name, .call, node, file_path);
    }

    fn processInheritance(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.InheritanceMapping) !void {
        const name_node = node.childByFieldName(mapping.name_field) orelse return;
        const target = self.extractIdentifierText(name_node, source) orelse return;
        try self.addReference(target, .inheritance, node, file_path);
    }

    fn processModifierInvocation(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.ModifierInvocationMapping) !void {
        const name = self.nodeText(node, source, mapping.name_field) orelse return;
        try self.addReference(name, .modifier_use, node, file_path);
    }

    fn processEmit(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.EmitMapping) !void {
        const name = self.nodeText(node, source, mapping.name_field) orelse return;
        try self.addReference(name, .event_emit, node, file_path);
    }

    fn processWrite(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, wp: cfg.WritePattern) !void {
        const target_node = node.childByFieldName(wp.target_field) orelse return;

        // Unwrap to root identifier (§4.2)
        const root_name = unwrapToRoot(target_node, source, self.lang_config) orelse return;
        try self.addReference(root_name, .state_write, node, file_path);

        // Also record the read side for augmented assignments
        // (e.g., `totalSupply += amount` reads both `totalSupply` and `amount`)
    }

    fn processImport(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.ImportMapping) !void {
        const path_node = node.childByFieldName(mapping.path_field) orelse return;
        const raw_path = source[path_node.startByte()..path_node.endByte()];

        // Strip quotes from import path
        const import_path = std.mem.trim(u8, raw_path, "\"'");

        const from = self.currentContainer() orelse return;
        try self.graph.addRef(.{
            .id = graph.refId(file_path, node.startByte()),
            .from = from,
            .target_name = import_path,
            .site = self.makeLocator(node, file_path),
            .kind = .import,
            .targets = .empty,
            .resolved = false,
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

    // ── Import Expansion (§3.4) ──────────────────────────────────────

    fn expandImports(self: *Pipeline, queue: *std.ArrayList([]const u8)) !void {
        // Process import refs: resolve paths, queue new files
        for (self.graph.refs.items) |*ref| {
            if (ref.kind != .import or ref.resolved) continue;

            // Try to resolve import path to file on disk
            if (self.resolveImportPath(ref.target_name)) |resolved_path| {
                // Add target to the ref
                const target_id = graph.nodeId(resolved_path, resolved_path, 1);
                try ref.addTarget(self.allocator, target_id);
                ref.resolved = true;

                // Queue file for walking
                if (!self.walked_files.contains(resolved_path)) {
                    try queue.append(self.allocator, resolved_path);
                }
            }
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
        // Step 1: Resolve imports and inheritance refs
        for (self.graph.refs.items) |*ref| {
            if (ref.resolved) continue;
            switch (ref.kind) {
                .import => {
                    // Unresolved import → gap
                    ref.gap = .high;
                    ref.resolved = true;
                },
                .inheritance => {
                    // Try to resolve inheritance
                    if (self.graph.lookupContainerByName(ref.target_name)) |parent_node| {
                        try ref.addTarget(self.allocator, parent_node.id);
                    } else {
                        ref.gap = .high;
                    }
                    ref.resolved = true;
                },
                else => {},
            }
        }

        // Step 2: Resolve all other references
        for (self.graph.refs.items) |*ref| {
            if (ref.resolved) continue;

            // Language-specific resolve hook runs first
            if (self.lang_config.resolve_hook) |hook| {
                hook(ref, &self.graph);
                if (ref.resolved) continue;
            }

            // Derive container from the scope node
            const container_id = self.graph.containerOf(ref.from) orelse {
                ref.resolved = true;
                continue;
            };

            switch (ref.kind) {
                .call => {
                    if (self.resolveInScope(container_id, ref.target_name, .callable)) |target| {
                        try ref.addTarget(self.allocator, target.id);
                        ref.target_kind = .internal;
                    } else {
                        ref.gap = .medium;
                    }
                    ref.resolved = true;
                },
                .state_read => {
                    // §4.1: state_read → target or drop (no gap)
                    if (self.resolveInScope(container_id, ref.target_name, .variable)) |target| {
                        try ref.addTarget(self.allocator, target.id);
                    }
                    // else: drop — likely a local or parameter
                    ref.resolved = true;
                },
                .state_write => {
                    // §4.1: state_write → target or drop (no gap)
                    if (self.resolveInScope(container_id, ref.target_name, .variable)) |target| {
                        try ref.addTarget(self.allocator, target.id);
                    }
                    ref.resolved = true;
                },
                .modifier_use => {
                    if (self.resolveInScope(container_id, ref.target_name, .modifier)) |target| {
                        try ref.addTarget(self.allocator, target.id);
                    } else {
                        ref.gap = .high;
                    }
                    ref.resolved = true;
                },
                .event_emit => {
                    // §4.1: event_emit → target or drop (no gap)
                    if (self.resolveInScope(container_id, ref.target_name, .event)) |target| {
                        try ref.addTarget(self.allocator, target.id);
                    }
                    ref.resolved = true;
                },
                else => {}, // import/inheritance handled in step 1
            }
        }

        // Build site index for O(1) ref lookups
        try self.graph.buildSiteIndex();
    }

    /// Scoped resolution: check own container, then walk inheritance chain (§4.1, §4.3).
    fn resolveInScope(self: *Pipeline, container_id: u64, name: []const u8, expected_kind: graph.NodeKind) ?*graph.GraphNode {
        // Check own container first
        if (self.graph.lookupChildByName(container_id, name, expected_kind)) |found| {
            return found;
        }

        // Walk parents per inheritance strategy (§4.3)
        switch (self.lang_config.inheritance_strategy) {
            .c3_linearization => return self.resolveC3(container_id, name, expected_kind),
            .single_chain => return self.resolveSingleChain(container_id, name, expected_kind),
            .flat => return null, // no inheritance chain
            .embedded_promotion => return self.resolveEmbedded(container_id, name, expected_kind),
        }
    }

    /// C3 linearization (Solidity, Python): right-to-left depth-first, deduplicated.
    /// `contract C is A, B` → check B first, then A (right-to-left).
    /// Recurses into each parent's chain depth-first.
    fn resolveC3(self: *Pipeline, container_id: u64, name: []const u8, expected_kind: graph.NodeKind) ?*graph.GraphNode {
        // Collect resolved inheritance targets — order matches source declaration (left-to-right)
        // C3: search right-to-left, so iterate in reverse
        const parents = self.graph.getResolvedInheritanceTargets(container_id, self.allocator) catch return null;
        defer self.allocator.free(parents);

        var i = parents.len;
        while (i > 0) {
            i -= 1;
            const parent_id = parents[i];
            // Check parent's own children
            if (self.graph.lookupChildByName(parent_id, name, expected_kind)) |found| {
                return found;
            }
            // Recurse into parent's inheritance chain
            if (self.resolveC3(parent_id, name, expected_kind)) |found| {
                return found;
            }
        }
        return null;
    }

    /// Single chain (Java): one parent class + interfaces.
    /// Walk the single parent chain upward; interface methods are not inherited.
    fn resolveSingleChain(self: *Pipeline, container_id: u64, name: []const u8, expected_kind: graph.NodeKind) ?*graph.GraphNode {
        const parents = self.graph.getResolvedInheritanceTargets(container_id, self.allocator) catch return null;
        defer self.allocator.free(parents);

        // First inheritance target is the parent class
        if (parents.len > 0) {
            const parent_id = parents[0];
            if (self.graph.lookupChildByName(parent_id, name, expected_kind)) |found| {
                return found;
            }
            return self.resolveSingleChain(parent_id, name, expected_kind);
        }
        return null;
    }

    /// Embedded promotion (Go): shallowest embedding wins.
    /// Check all immediate parents; if exactly one matches, return it.
    /// If multiple match at same depth, it's ambiguous — skip.
    fn resolveEmbedded(self: *Pipeline, container_id: u64, name: []const u8, expected_kind: graph.NodeKind) ?*graph.GraphNode {
        const parents = self.graph.getResolvedInheritanceTargets(container_id, self.allocator) catch return null;
        defer self.allocator.free(parents);

        var found: ?*graph.GraphNode = null;
        for (parents) |parent_id| {
            if (self.graph.lookupChildByName(parent_id, name, expected_kind)) |match| {
                if (found != null) return null; // ambiguous
                found = match;
            }
        }
        if (found != null) return found;

        // Recurse deeper
        for (parents) |parent_id| {
            if (self.resolveEmbedded(parent_id, name, expected_kind)) |match| {
                if (found != null) return null; // ambiguous
                found = match;
            }
        }
        return found;
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /// Top of scope stack — the innermost enclosing scope (callable, container, or file).
    fn currentScope(self: *const Pipeline) ?u64 {
        if (self.scope_stack.items.len == 0) return null;
        return self.scope_stack.items[self.scope_stack.items.len - 1].id;
    }

    /// Nearest container on the scope stack.
    fn currentContainer(self: *const Pipeline) ?u64 {
        var i = self.scope_stack.items.len;
        while (i > 0) {
            i -= 1;
            const frame = self.scope_stack.items[i];
            if (frame.kind == .container or frame.kind == .file) return frame.id;
        }
        return null;
    }

    fn buildQualifiedName(self: *Pipeline, name: []const u8) ![]const u8 {
        if (self.scope_stack.items.len <= 1) {
            // Only file on the stack — top-level declaration
            return try self.graph.dupeString(name);
        }

        // Build: "Container1.Container2.name"
        var parts: std.ArrayList([]const u8) = .empty;
        defer parts.deinit(self.allocator);

        // Skip the file frame (index 0), include all container frames
        for (self.scope_stack.items[1..]) |frame| {
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
        var current = callee_node;
        while (true) {
            const node_type = current.kind();
            if (std.mem.eql(u8, node_type, self.lang_config.identifier_type)) {
                return source[current.startByte()..current.endByte()];
            }
            var matched = false;
            for (self.lang_config.callee_unwrap_rules) |rule| {
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

    fn extractReceiverName(self: *const Pipeline, callee_node: ts.Node, source: []const u8) ?[]const u8 {
        return unwrapToRoot(callee_node, source, self.lang_config);
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

    fn isBuiltin(self: *const Pipeline, callee_name: []const u8, callee_node: ts.Node, source: []const u8) bool {
        for (self.lang_config.builtin_functions) |builtin| {
            if (std.mem.eql(u8, callee_name, builtin)) return true;
        }
        // Check builtin receivers (e.g., msg.sender → "msg" is builtin)
        if (unwrapToRoot(callee_node, source, self.lang_config)) |receiver| {
            for (self.lang_config.builtin_receivers) |builtin| {
                if (std.mem.eql(u8, receiver, builtin)) return true;
            }
        }
        return false;
    }

    fn isWriteCallMethod(self: *const Pipeline, callee_name: []const u8) bool {
        for (self.lang_config.write_call_methods) |wcm| {
            if (std.mem.eql(u8, callee_name, wcm)) return true;
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

    fn addReference(self: *Pipeline, target_name: []const u8, kind: graph.RefKind, node: ts.Node, file_path: []const u8) !void {
        const from = self.currentScope() orelse return;
        try self.graph.addRef(.{
            .id = graph.refId(file_path, node.startByte()),
            .from = from,
            .target_name = target_name,
            .site = self.makeLocator(node, file_path),
            .kind = kind,
            .targets = .empty,
            .resolved = false,
        });
    }

    fn maybePopScope(self: *Pipeline, node: ts.Node) void {
        if (self.scope_stack.items.len <= 1) return; // keep file frame

        const top = self.scope_stack.items[self.scope_stack.items.len - 1];
        const top_node = self.graph.lookupNode(top.id) orelse return;
        const ast = top_node.ast_node orelse return;
        const kind = top_node.language_kind;

        // Check containers
        for (self.lang_config.containers) |mapping| {
            if (std.mem.eql(u8, kind, mapping.ts_type)) {
                if (ast.childByFieldName(mapping.body_field)) |body| {
                    if (node.endByte() >= body.endByte()) {
                        _ = self.scope_stack.pop();
                    }
                }
                return;
            }
        }

        // Check callables
        for (self.lang_config.callables) |mapping| {
            if (std.mem.eql(u8, kind, mapping.ts_type)) {
                if (mapping.body_field) |bf| {
                    if (ast.childByFieldName(bf)) |body| {
                        if (node.endByte() >= body.endByte()) {
                            _ = self.scope_stack.pop();
                        }
                    }
                }
                return;
            }
        }

        // Check modifiers
        for (self.lang_config.modifiers) |mapping| {
            if (std.mem.eql(u8, kind, mapping.ts_type)) {
                if (mapping.body_field) |bf| {
                    if (ast.childByFieldName(bf)) |body| {
                        if (node.endByte() >= body.endByte()) {
                            _ = self.scope_stack.pop();
                        }
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
