# Auditor Addon Context

**Auditor Addon** is a CLI tool (`aud`) for code estimation, security auditing, and reporting. It supports Solidity, Cairo, Compact, Move, Noir, Tolk, Masm, C++, Java, Go, Rust, JavaScript, TypeScript, TSX, Flow, and Python.

## CLI Reference

```
aud <command> [options] <glob...>
```

| Command | Purpose |
| :--- | :--- |
| `aud peek <glob...>` | Extract function signatures for quick overview. |
| `aud metrics <glob...>` | Calculate nLOC, complexity, and effort estimates. |
| `aud diff-metrics <base> <head> [<glob>...]` | Metrics restricted to lines changed between two git refs. |
| `aud gaps <glob...>` | Build symbol graph, output unresolved edge gaps. |
| `aud run <glob...>` | Build symbol graph, run rules, output findings. |
| `aud call-chains <glob...>` | Map caller->callee chains from entry points. |
| `aud graph <glob...>` | Build symbol graph, dump nodes and edges. |
| `aud info <language>` | List language config (node types, properties). |
| `aud api` | Print the Lua rule API reference (graph.*, ast.*, report.*). |

### Common Options

| Option | Description |
| :--- | :--- |
| `--language=<lang>` | Force language (otherwise auto-detected from extension). |
| `--json` | JSON output instead of TOON. |
| `--resolutions=<file>` | Apply resolution CSV (gaps/run/call-chains/graph). |
| `--no-expand` | Skip import-driven file expansion (gaps only). |
| `--rule=<ID>` | Run specific shipped rule (run only, repeatable). |
| `--rule-path=<path>` | Run adhoc rule from .lua file (run only). |
| `--confidence=<level>` | Filter by confidence: issue, smell, pointer (run only, repeatable). |
| `--root=<name>` | Start from specific function (call-chains only, repeatable). |
| `--max-depth=<n>` | Limit chain depth, default 10 (call-chains only). |

**Note:** File arguments accept glob patterns (e.g., `"src/**/*.sol"`).
**Format:** Output uses Token-Oriented Object Notation (TOON) by default. Use `--json` for JSON.
