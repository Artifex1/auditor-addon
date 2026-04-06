---
name: auditor-addon-cli
description: Provides the `aud` CLI binary used by all other auditor-addon skills (estimator, security-auditor, threat-modeling, sast-pipeline, rule-authoring). Load this skill whenever any `aud` command needs to be invoked. The binary is at `<SKILL_DIR>/bin/aud` — use the `bin/aud` dispatcher which auto-selects the correct platform binary.
---

# auditor-addon-cli

The `aud` CLI is a single-binary tool that parses source code with tree-sitter, builds a symbol graph, and runs analysis. Pre-built binaries for all platforms are shipped in this skill's `bin/` directory.

## Invoking aud

The `bin/aud` dispatcher auto-detects the current platform and runs the correct binary. Invoke it using its absolute path:

```bash
<SKILL_DIR>/bin/aud <command> [options] <glob...>
```

Where `<SKILL_DIR>` is the directory containing this SKILL.md file.

## Commands

| Command | Purpose |
|:--------|:--------|
| `aud peek <glob...>` | Extract function signatures for quick overview. |
| `aud metrics <glob...>` | Calculate nLOC, complexity, and effort estimates. |
| `aud gaps <glob...>` | Build symbol graph, output unresolved edge gaps. |
| `aud run <glob...>` | Build symbol graph, run rules, output findings. |
| `aud call-chains <glob...>` | Map caller->callee chains from entry points. |
| `aud graph <glob...>` | Build symbol graph, dump nodes and edges. |
| `aud info <language>` | List language config (node types, properties). |

### Common Options

| Option | Applies to | Description |
|:-------|:-----------|:------------|
| `--help` | all | Per-command help. |
| `--language=<lang>` | all except info | Force language (otherwise auto-detected from extension). |
| `--json` | all except info | JSON output instead of TOON. |
| `--resolutions=<file>` | gaps, run, call-chains, graph | Apply resolution CSV. |
| `--no-expand` | gaps | Skip import-driven file expansion. |
| `--rule=<ID>` | run | Run specific shipped rule (repeatable). |
| `--rule-path=<path>` | run | Run adhoc rule from .lua file. |
| `--root=<name>` | call-chains | Start from specific function (repeatable). |
| `--max-depth=<n>` | call-chains | Limit chain depth (default: 10). |

File arguments accept glob patterns (e.g., `"src/**/*.sol"`).

## Output Format

Output uses Token-Oriented Object Notation (TOON) by default. Pass `--json` for JSON.

## Supported Languages

Solidity, Rust, Go, Python, Cairo, Compact, Move, Noir, Tolk, Masm, C++, Java, JavaScript, TypeScript, TSX, Flow.

## Adding aud to PATH (optional, for manual use)

### macOS / Linux

```bash
ln -s "$(pwd)/bin/aud" /usr/local/bin/aud
```

### Windows (PowerShell, admin)

```powershell
New-Item -ItemType SymbolicLink -Path "C:\Windows\aud.exe" -Target "$PWD\bin\aud-x86_64-windows.exe"
```
