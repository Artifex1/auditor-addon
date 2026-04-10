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

## Discovering Commands and Options

Run `--help` on the binary itself to get the current command list and per-command options. This is always more up-to-date than any documentation:

```bash
<SKILL_DIR>/bin/aud --help              # list all commands
<SKILL_DIR>/bin/aud <command> --help     # per-command options
```

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
