const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const exe = b.addExecutable(.{
        .name = "aa",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
    });

    // --- Dependencies ---

    // tree-sitter Zig bindings
    const tree_sitter = b.dependency("tree_sitter", .{
        .target = target,
        .optimize = optimize,
    });
    exe.root_module.addImport("tree-sitter", tree_sitter.module("tree_sitter"));

    // ziglua (for Lua rule engine — Phase 2, but link now to verify)
    const zlua = b.dependency("zlua", .{
        .target = target,
        .optimize = optimize,
    });
    exe.root_module.addImport("zlua", zlua.module("zlua"));

    // zig-clap (CLI argument parsing)
    const clap = b.dependency("clap", .{
        .target = target,
        .optimize = optimize,
    });
    exe.root_module.addImport("clap", clap.module("clap"));

    // --- Tree-sitter grammar C sources ---
    // Each grammar provides a tree_sitter_<name>() extern fn via parser.c.
    // Grammars with external scanners also need scanner.c compiled.

    const grammars = .{
        // No scanner (parser.c only)
        .{ .name = "solidity", .root = "vendor/grammars/tree-sitter-solidity/src", .scanner = false },
        .{ .name = "cairo", .root = "vendor/grammars/tree-sitter-cairo/src", .scanner = false },
        .{ .name = "compact", .root = "vendor/grammars/tree-sitter-compact/src", .scanner = false },
        .{ .name = "go", .root = "vendor/grammars/tree-sitter-go/src", .scanner = false },
        .{ .name = "java", .root = "vendor/grammars/tree-sitter-java/src", .scanner = false },
        .{ .name = "masm", .root = "vendor/grammars/tree-sitter-masm/src", .scanner = false },
        .{ .name = "tolk", .root = "vendor/grammars/tree-sitter-tolk/src", .scanner = false },

        // With scanner.c
        .{ .name = "cpp", .root = "vendor/grammars/tree-sitter-cpp/src", .scanner = true },
        .{ .name = "javascript", .root = "vendor/grammars/tree-sitter-javascript/src", .scanner = true },
        .{ .name = "move", .root = "vendor/grammars/tree-sitter-move-sui/src", .scanner = true },
        .{ .name = "noir", .root = "vendor/grammars/tree-sitter-noir/src", .scanner = true },
        .{ .name = "python", .root = "vendor/grammars/tree-sitter-python/src", .scanner = true },
        .{ .name = "rust", .root = "vendor/grammars/tree-sitter-rust/src", .scanner = true },

        // TypeScript family (separate parser dirs within same submodule)
        .{ .name = "typescript", .root = "vendor/grammars/tree-sitter-typescript/typescript/src", .scanner = true },
        .{ .name = "tsx", .root = "vendor/grammars/tree-sitter-typescript/tsx/src", .scanner = true },
    };

    addGrammarSources(b, exe.root_module, grammars);

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

    const unit_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
    });
    unit_tests.root_module.addImport("tree-sitter", tree_sitter.module("tree_sitter"));
    unit_tests.root_module.addImport("zlua", zlua.module("zlua"));
    unit_tests.root_module.addImport("clap", clap.module("clap"));

    addGrammarSources(b, unit_tests.root_module, grammars);

    const run_unit_tests = b.addRunArtifact(unit_tests);
    test_step.dependOn(&run_unit_tests.step);
}

fn addGrammarSources(b: *std.Build, module: *std.Build.Module, grammars: anytype) void {
    inline for (grammars) |g| {
        // Add the src/ directory as an include path so scanner.c can find
        // tree_sitter/parser.h (needed for TypeScript family and others
        // whose scanner.h includes relative to src/)
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
