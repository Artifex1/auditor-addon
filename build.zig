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

    // --- Shared aa module (used by exe, unit tests, and integration tests) ---

    const aa_module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    aa_module.addImport("tree-sitter", tree_sitter.module("tree_sitter"));
    aa_module.addImport("zlua", zlua.module("zlua"));
    aa_module.addImport("clap", clap.module("clap"));
    addGrammarSources(b, aa_module, grammars);

    // --- Executable ---

    const exe = b.addExecutable(.{ .name = "aa", .root_module = aa_module });
    b.installArtifact(exe);

    // --- Run step ---

    const run_step = b.step("run", "Run the aa CLI");
    const run_cmd = b.addRunArtifact(exe);
    run_step.dependOn(&run_cmd.step);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    // --- Test step ---

    const test_step = b.step("test", "Run all tests");

    // Unit tests (inline tests in src/)
    const unit_tests = b.addTest(.{ .root_module = aa_module });
    test_step.dependOn(&b.addRunArtifact(unit_tests).step);

    // Integration tests
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
        integration_module.addImport("aa", aa_module);
        integration_module.addImport("tree-sitter", tree_sitter.module("tree_sitter"));

        const integration_tests = b.addTest(.{ .root_module = integration_module });
        test_step.dependOn(&b.addRunArtifact(integration_tests).step);
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
