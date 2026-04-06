const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // --- Dependencies ---

    const tree_sitter = b.dependency("tree_sitter", .{ .target = target, .optimize = optimize });
    const zlua = b.dependency("zlua", .{ .target = target, .optimize = optimize });
    const clap = b.dependency("clap", .{ .target = target, .optimize = optimize });

    // --- Tree-sitter grammar C sources ---

    const grammars = .{
        .{ .name = "solidity", .root = "vendor/grammars/tree-sitter-solidity/src", .scanner = false },
        .{ .name = "cairo", .root = "vendor/grammars/tree-sitter-cairo/src", .scanner = false },
        .{ .name = "compact", .root = "vendor/grammars/tree-sitter-compact/src", .scanner = false },
        .{ .name = "go", .root = "vendor/grammars/tree-sitter-go/src", .scanner = false },
        .{ .name = "java", .root = "vendor/grammars/tree-sitter-java/src", .scanner = false },
        .{ .name = "masm", .root = "vendor/grammars/tree-sitter-masm/src", .scanner = false },
        .{ .name = "tolk", .root = "vendor/grammars/tree-sitter-tolk/src", .scanner = false },
        .{ .name = "cpp", .root = "vendor/grammars/tree-sitter-cpp/src", .scanner = true },
        .{ .name = "javascript", .root = "vendor/grammars/tree-sitter-javascript/src", .scanner = true },
        .{ .name = "move", .root = "vendor/grammars/tree-sitter-move-sui/src", .scanner = true },
        .{ .name = "noir", .root = "vendor/grammars/tree-sitter-noir/src", .scanner = true },
        .{ .name = "python", .root = "vendor/grammars/tree-sitter-python/src", .scanner = true },
        .{ .name = "rust", .root = "vendor/grammars/tree-sitter-rust/src", .scanner = true },
        .{ .name = "typescript", .root = "vendor/grammars/tree-sitter-typescript/typescript/src", .scanner = true },
        .{ .name = "tsx", .root = "vendor/grammars/tree-sitter-typescript/tsx/src", .scanner = true },
    };

    // --- Shared aud module (used by exe, unit tests, and integration tests) ---

    const aud_module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    aud_module.addImport("tree-sitter", tree_sitter.module("tree_sitter"));
    aud_module.addImport("zlua", zlua.module("zlua"));
    aud_module.addImport("clap", clap.module("clap"));
    addGrammarSources(b, aud_module, grammars);

    // --- Executable ---

    const exe = b.addExecutable(.{ .name = "aud", .root_module = aud_module });
    b.installArtifact(exe);

    // --- Run step ---

    const run_step = b.step("run", "Run the aud CLI");
    const run_cmd = b.addRunArtifact(exe);
    run_step.dependOn(&run_cmd.step);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    // --- Test step ---

    const test_step = b.step("test", "Run all tests");

    // Unit tests (inline tests in src/)
    const unit_tests = b.addTest(.{ .root_module = aud_module });
    test_step.dependOn(&b.addRunArtifact(unit_tests).step);

    // Integration tests — language suites (fixed list)
    const integration_configs = .{
        .{ .name = "solidity", .root = "tests/solidity/integration_test.zig" },
        .{ .name = "rust", .root = "tests/rust/integration_test.zig" },
        .{ .name = "go", .root = "tests/go/integration_test.zig" },
        .{ .name = "python", .root = "tests/python/integration_test.zig" },
        .{ .name = "javascript", .root = "tests/javascript/integration_test.zig" },
        .{ .name = "typescript", .root = "tests/typescript/integration_test.zig" },
        .{ .name = "cpp", .root = "tests/cpp/integration_test.zig" },
        .{ .name = "java", .root = "tests/java/integration_test.zig" },
        .{ .name = "cairo", .root = "tests/cairo/integration_test.zig" },
        .{ .name = "move", .root = "tests/move/integration_test.zig" },
        .{ .name = "noir", .root = "tests/noir/integration_test.zig" },
    };
    inline for (integration_configs) |ic| {
        const integration_module = b.createModule(.{
            .root_source_file = b.path(ic.root),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        integration_module.addImport("aud", aud_module);
        integration_module.addImport("tree-sitter", tree_sitter.module("tree_sitter"));

        const integration_tests = b.addTest(.{ .root_module = integration_module });
        test_step.dependOn(&b.addRunArtifact(integration_tests).step);
    }

    // Per-rule tests — auto-discovered from tests/solidity/rules/*.zig
    // Adding a new rule test file is enough; no build.zig edit required.
    addRuleTests(b, test_step, aud_module, tree_sitter, target, optimize, "tests/solidity/rules");
}

fn addRuleTests(
    b: *std.Build,
    test_step: *std.Build.Step,
    aud_module: *std.Build.Module,
    tree_sitter: *std.Build.Dependency,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    rules_dir_path: []const u8,
) void {
    var rules_dir = b.build_root.handle.openDir(rules_dir_path, .{ .iterate = true }) catch return;
    defer rules_dir.close();

    var it = rules_dir.iterate();
    while (it.next() catch null) |entry| {
        if (entry.kind != .file) continue;
        if (!std.mem.endsWith(u8, entry.name, ".zig")) continue;
        if (std.mem.eql(u8, entry.name, "helpers.zig")) continue;

        const root = b.fmt("{s}/{s}", .{ rules_dir_path, entry.name });
        const name = entry.name[0 .. entry.name.len - 4]; // strip .zig

        const module = b.createModule(.{
            .root_source_file = b.path(root),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        module.addImport("aud", aud_module);
        module.addImport("tree-sitter", tree_sitter.module("tree_sitter"));

        const tests = b.addTest(.{ .name = name, .root_module = module });
        test_step.dependOn(&b.addRunArtifact(tests).step);
    }
}

fn addGrammarSources(b: *std.Build, module: *std.Build.Module, grammars: anytype) void {
    inline for (grammars) |g| {
        module.addIncludePath(b.path(g.root));
        if (g.scanner) {
            module.addCSourceFiles(.{
                .root = b.path(g.root),
                .files = &.{ "parser.c", "scanner.c" },
            });
        } else {
            module.addCSourceFiles(.{
                .root = b.path(g.root),
                .files = &.{"parser.c"},
            });
        }
    }
}
