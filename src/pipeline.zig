const std = @import("std");
const ts = @import("tree-sitter");
const graph = @import("graph.zig");
const cfg = @import("languages/config.zig");
const diagnostics_mod = @import("diagnostics.zig");
const test_filter = @import("test_filter.zig");

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

    // User-scoped files (the original glob, before import expansion)
    scoped_files: std.StringHashMapUnmanaged(void),

    // Scope stack for nesting context (§4.1)
    scope_stack: std.ArrayList(ScopeFrame),

    // Optional diagnostics accumulator (set by caller)
    diag: ?*diagnostics_mod.Diagnostics = null,

    // Test markers for --no-tests filtering (set by caller before run)
    test_markers: []const cfg.TestMarker = &.{},

    const ScopeFrame = struct {
        id: u64,
        name: []const u8,
        kind: graph.NodeKind,
    };

    pub fn init(allocator: std.mem.Allocator, lang_config: *const cfg.LanguageConfig) !Pipeline {
        const parser = ts.Parser.create();
        try parser.setLanguage(lang_config.language.grammarFn()());

        const g = graph.SymbolGraph.init(allocator);

        return .{
            .graph = g,
            .allocator = allocator,
            .lang_config = lang_config,
            .parser = parser,
            .trees = .empty,
            .sources = .empty,
            .walked_files = .empty,
            .scoped_files = .empty,
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
        self.scoped_files.deinit(self.allocator);
        self.scope_stack.deinit(self.allocator);
        self.parser.destroy();
        self.graph.deinit();
    }

    // ── Main Entry Point (§3.2) ───────────────────────────────────────

    /// Run the full pipeline: parse → walk → expand imports → resolve.
    pub fn run(self: *Pipeline, file_paths: []const []const u8, no_expand: bool) !void {
        // Record user-scoped files (before import expansion)
        for (file_paths) |path| {
            try self.scoped_files.put(self.allocator, path, {});
        }

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

    pub fn parseAndWalkFile(self: *Pipeline, file_path: []const u8) !void {
        if (self.walked_files.contains(file_path)) return;
        try self.walked_files.put(self.allocator, file_path, {});

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
                if (self.test_markers.len > 0 and
                    test_filter.isTestNode(node, source, self.test_markers))
                {
                    descend = false;
                } else {
                    try self.processNode(node, source, file_path);
                }
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

        // Check imports
        if (lc.imports) |imp| {
            if (std.mem.eql(u8, kind, imp.ts_type)) {
                try self.processImport(node, source, file_path, imp);
                return;
            }
        }

        // Language-specific walk hook
        if (lc.walk_hook) |hook| {
            try hook(.{
                .graph = &self.graph,
                .node = node,
                .source = source,
                .file_path = file_path,
                .scope = self.currentScope(),
                .allocator = self.allocator,
            });
        }
    }

    // ── Node Processors ──────────────────────────────────────────────

    fn processContainer(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.ContainerMapping) !void {
        const name = blk: {
            if (nodeForField(node, mapping.name_field)) |raw| {
                const unwrapped = self.unwrapNode(raw, .name);
                if (nodeSlice(unwrapped, source)) |s| break :blk s;
            }
            break :blk self.findFirstIdentifier(node, source) orelse return;
        };
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
        // If body_field is null (e.g. Move module with no named body), push unconditionally.
        const has_body = if (mapping.body_field) |bf| node.childByFieldName(bf) != null else true;
        if (has_body) {
            try self.scope_stack.append(self.allocator, .{ .id = id, .name = name, .kind = .container });
        }
    }

    fn processCallable(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.CallableMapping) !void {
        const name = if (mapping.name_field) |nf| blk: {
            const raw = nodeForField(node, nf) orelse break :blk node.kind();
            const unwrapped = self.unwrapNode(raw, .name);
            break :blk nodeSlice(unwrapped, source) orelse node.kind();
        } else node.kind();

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

    // ── Reference Processors ─────────────────────────────────────────

    fn processCallExpression(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8) !void {
        const lc = self.lang_config;
        const callee_node = node.childByFieldName(lc.call_expression.function_field) orelse return;

        // Extract target name — rightmost identifier for member calls, bare for simple
        const target_name = cfg.unwrap(callee_node, source, self.lang_config, .callee) orelse return;

        // Filter builtins
        if (self.isBuiltin(target_name, callee_node, source)) return;

        try self.addReference(target_name, .call, node, file_path);
    }

    fn processInheritance(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.InheritanceMapping) !void {
        const name_node = node.childByFieldName(mapping.name_field) orelse return;
        const target = self.extractIdentifierText(name_node, source) orelse return;
        try self.addReference(target, .inheritance, node, file_path);
    }

    fn processImport(self: *Pipeline, node: ts.Node, source: []const u8, file_path: []const u8, mapping: cfg.ImportMapping) !void {
        const path_node = node.childByFieldName(mapping.path_field) orelse return;
        const raw_path = source[path_node.startByte()..path_node.endByte()];

        // Strip quotes from import path
        const import_path = std.mem.trim(u8, raw_path, "\"'");

        const from = self.currentFile() orelse return;
        try self.graph.addRef(.{
            .id = graph.refId(file_path, node.startByte(), node.endByte(), .import),
            .from = from,
            .target_name = import_path,
            .site = self.makeLocator(node, file_path),
            .kind = .import,
        });
    }

    // ── Import Expansion (§3.4) ──────────────────────────────────────

    fn expandImports(self: *Pipeline, queue: *std.ArrayList([]const u8)) !void {
        // Process import refs: resolve paths, queue new files
        for (self.graph.refs.items) |*ref| {
            if (ref.kind != .import or ref.isFinalized()) continue;

            // Try to resolve import path to file on disk
            if (self.resolveImportPath(ref.target_name, ref.site.file)) |resolved_path| {
                // Add target to the ref
                const target_id = graph.nodeId(resolved_path, resolved_path, 1);
                try ref.addTarget(self.allocator, target_id);

                // Queue file for walking
                if (!self.walked_files.contains(resolved_path)) {
                    try queue.append(self.allocator, resolved_path);
                }
            }
        }
    }

    fn resolveImportPath(self: *Pipeline, raw_path: []const u8, importing_file: []const u8) ?[]const u8 {
        // For relative imports, resolve against the importing file's directory
        if (std.mem.startsWith(u8, raw_path, "./") or std.mem.startsWith(u8, raw_path, "../")) {
            const dir = std.fs.path.dirname(importing_file) orelse ".";
            const resolved = std.fs.path.resolvePosix(self.allocator, &.{ dir, raw_path }) catch return null;
            defer self.allocator.free(resolved);
            std.fs.cwd().access(resolved, .{}) catch return null;
            // Dupe into graph's string pool so it outlives this scope
            return self.graph.dupeString(resolved) catch return null;
        }
        // Non-relative: try as-is relative to cwd
        std.fs.cwd().access(raw_path, .{}) catch return null;
        return raw_path;
    }

    // ── Resolution Phase (§4.1) ──────────────────────────────────────

    pub fn resolve(self: *Pipeline) !void {
        // Wire source text and trees for resolve hooks and nodeText lookups
        self.graph.sources = &self.sources;
        self.graph.trees = &self.trees;

        // Step 1: Resolve imports and inheritance refs
        for (self.graph.refs.items) |*ref| {
            if (ref.isFinalized()) continue;
            switch (ref.kind) {
                .import => {
                    // Unresolved import → gap
                    ref.markGap(self.allocator, .high);
                },
                .inheritance => {
                    if (self.graph.lookupContainerByName(ref.target_name)) |parent_node| {
                        try ref.addTarget(self.allocator, parent_node.id);
                    } else {
                        ref.markGap(self.allocator, .high);
                    }
                },
                .using_for => {
                    if (self.graph.lookupContainerByName(ref.target_name)) |lib_node| {
                        try ref.addTarget(self.allocator, lib_node.id);
                    } else {
                        ref.markGap(self.allocator, .high);
                    }
                },
                else => {},
            }
        }

        // Step 2: Resolve all other references
        for (self.graph.refs.items) |*ref| {
            if (ref.isFinalized()) continue;

            // Language-specific resolve hook runs first
            if (self.lang_config.resolve_hook) |hook| {
                hook(ref, &self.graph, self.lang_config, self.allocator);
                if (ref.isFinalized()) continue;
            }

            // Derive container from the scope node
            const container_id = self.graph.containerOf(ref.from) orelse {
                ref.markClassified(self.allocator);
                continue;
            };

            switch (ref.kind) {
                .call => {
                    if (self.graph.resolveInScope(container_id, ref.target_name, .callable)) |result| {
                        try ref.addTarget(self.allocator, result.node.id);
                        ref.target_kind = .internal;
                        if (result.ambiguous) ref.markAmbiguous();
                    } else {
                        ref.markGap(self.allocator, .medium);
                    }
                },
                else => {}, // import/inheritance/using_for handled in step 1
            }
        }

        // Build site index for O(1) ref lookups
        try self.graph.buildSiteIndex();
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

    fn currentFile(self: *const Pipeline) ?u64 {
        for (self.scope_stack.items) |frame| {
            if (frame.kind == .file) return frame.id;
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

    /// Returns the child node reached by field_name, with one level of indirect lookup
    /// (e.g. Cairo: function_item → function → name).  Does NOT follow chains — callers
    /// that need further unwrapping should call unwrapNode() on the result.
    fn nodeForField(node: ts.Node, field_name: []const u8) ?ts.Node {
        if (node.childByFieldName(field_name)) |child| return child;
        // Indirect: search named children one level down
        var i: u32 = 0;
        while (i < node.namedChildCount()) : (i += 1) {
            if (node.namedChild(i)) |mid| {
                if (mid.childByFieldName(field_name)) |child| return child;
            }
        }
        return null;
    }

    fn nodeText(self: *const Pipeline, node: ts.Node, source: []const u8, field_name: []const u8) ?[]const u8 {
        _ = self;
        return nodeSlice(nodeForField(node, field_name) orelse return null, source);
    }

    /// Applies unwrap_table rules for the given context, following the chain until
    /// no matching rule is found.  Returns the terminal node (never null).
    fn unwrapNode(self: *const Pipeline, node: ts.Node, context: cfg.UnwrapContext) ts.Node {
        var current = node;
        while (true) {
            const kind = current.kind();
            var matched = false;
            for (self.lang_config.unwrap_table) |rule| {
                if (rule.context != context) continue;
                if (!std.mem.eql(u8, kind, rule.ts_type)) continue;
                if (rule.search_types.len > 0) {
                    // Search all children (including anonymous tokens) for first type match
                    var ci: u32 = 0;
                    var found = false;
                    outer: while (ci < current.childCount()) : (ci += 1) {
                        if (current.child(ci)) |sub| {
                            for (rule.search_types) |st| {
                                if (std.mem.eql(u8, sub.kind(), st)) {
                                    current = sub;
                                    found = true;
                                    break :outer;
                                }
                            }
                        }
                    }
                    if (!found) return current;
                } else {
                    current = if (rule.child_field) |f|
                        current.childByFieldName(f) orelse return current
                    else
                        current.namedChild(0) orelse return current;
                }
                matched = true;
                break;
            }
            if (!matched) return current;
        }
    }

    fn nodeSlice(child: ts.Node, source: []const u8) ?[]const u8 {
        const start = child.startByte();
        const end = child.endByte();
        if (start >= end or start >= source.len) return null;
        return source[start..@min(end, @as(u32, @intCast(source.len)))];
    }

    /// Fallback name extraction: find the first direct child matching identifier_type.
    /// Used when the name_field lookup fails (e.g. Cairo impl_item has an unnamed identifier child).
    fn findFirstIdentifier(self: *const Pipeline, node: ts.Node, source: []const u8) ?[]const u8 {
        var i: u32 = 0;
        while (i < node.namedChildCount()) : (i += 1) {
            if (node.namedChild(i)) |child| {
                if (std.mem.eql(u8, child.kind(), self.lang_config.identifier_type)) {
                    return nodeSlice(child, source);
                }
            }
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

    fn isBuiltin(self: *const Pipeline, callee_name: []const u8, callee_node: ts.Node, source: []const u8) bool {
        for (self.lang_config.builtin_functions) |builtin| {
            if (std.mem.eql(u8, callee_name, builtin)) return true;
        }
        // Check builtin receivers (e.g., msg.sender → "msg" is builtin)
        if (cfg.unwrap(callee_node, source, self.lang_config, .receiver)) |receiver| {
            for (self.lang_config.builtin_receivers) |builtin| {
                if (std.mem.eql(u8, receiver, builtin)) return true;
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

    fn addReference(self: *Pipeline, target_name: []const u8, kind: graph.RefKind, node: ts.Node, file_path: []const u8) !void {
        const from = self.currentScope() orelse return;
        try self.graph.addRef(.{
            .id = graph.refId(file_path, node.startByte(), node.endByte(), kind),
            .from = from,
            .target_name = target_name,
            .site = self.makeLocator(node, file_path),
            .kind = kind,
            .ast_node = node,
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
                if (mapping.body_field) |bf| {
                    if (ast.childByFieldName(bf)) |body| {
                        if (node.endByte() >= body.endByte()) {
                            _ = self.scope_stack.pop();
                        }
                    }
                } else {
                    // No named body field — pop when we've passed the end of the container node
                    if (node.endByte() >= ast.endByte()) {
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
    }

    fn extractProperties(self: *Pipeline, node: ts.Node, source: []const u8, properties: []const cfg.PropertyExtractor, gn: *graph.GraphNode) !void {
        for (properties) |prop| {
            // Walk children looking for child_type
            var child_idx: u32 = 0;
            while (child_idx < node.childCount()) : (child_idx += 1) {
                if (node.child(child_idx)) |child| {
                    if (!std.mem.eql(u8, child.kind(), prop.child_type)) continue;
                    // Apply .property unwrap rules to reach the actual value node
                    const value_node = self.unwrapNode(child, .property);
                    const val = source[value_node.startByte()..value_node.endByte()];
                    const key = try self.graph.dupeString(prop.key);
                    const value = try self.graph.dupeString(val);
                    try gn.properties.put(self.graph.arena.allocator(), key, value);
                    break;
                }
            }
        }
    }
};
