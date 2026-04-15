---
name: sast-pipeline
description: Running the SAiST (Static AI-assisted Security Testing) pipeline against a codebase. Use when the user wants to run static analysis rules, detect code smells, find vulnerability patterns, or scan code with the built-in rule engine. Covers the full gaps → resolve → run flow using the `aud` CLI.
argument-hint: "<files or scope>"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
---

# SAiST Pipeline

Three-phase static analysis: **gaps** → **resolve** → **run rules**.

## CLI Binary

This skill requires the `auditor-addon-cli` skill for the `aud` binary. Before running any `aud` command, load that skill to determine the correct binary path.

## Scope

When the user provides specific files or a file list as input to this skill, use those exact files as the scope for all commands. Do NOT broaden to glob patterns — the user's scope is intentional, and broad globs pull in out-of-scope files that create irrelevant gaps and noisy findings.

```bash
# User provides: contracts/src/Vault.sol contracts/src/Token.sol
aud gaps contracts/src/Vault.sol contracts/src/Token.sol

# NOT: aud gaps "contracts/src/**/*.sol"
```

Only use glob patterns when the user explicitly asks for a broad scan (e.g., "scan all Solidity files").

## Phase 1: Gaps Scan

Run `aud gaps <files...>` to build the symbol graph and emit all unresolved references. Use `aud gaps --help` for filtering options (by priority, kind, etc.).

Gaps are grouped by priority:
- `high` — in call chains from public entry points
- `medium` — have public callers
- `low` — internal, unlikely to affect rule accuracy

Clean (no gaps) → skip to Phase 3. Otherwise proceed to Phase 2.

## Phase 2: Resolve Gaps

Review gaps and resolve what you can. Create a CSV file:

```csv
ref_id,target_file,target_line,target_name
a4f2e81b,src/Ownable.sol,15,onlyOwner
b7c3d012,src/Ownable.sol,3,Ownable
```

**Triage:**
- **high**: always resolve
- **medium**: resolve if they touch public entry points or affect rule accuracy
- **low**: safe to skip

**How to resolve a gap:** Use only basic file operations — Read, Glob, Grep. No scripts.
1. Grep the codebase for the target name (function, contract, modifier, type)
2. Read the candidate file to confirm it's the right definition
3. Note the file path, line number, and name — add a row to the CSV

Use `aud peek` on candidate files to quickly scan signatures without reading full source.

**Iterate:** After resolving a batch, re-run `aud gaps <files...> --resolutions=resolutions.csv` to confirm progress. Resolve more if high/medium gaps remain. Repeat until only low-priority or genuinely unresolvable gaps are left.

Resolution target files do NOT need to be in the original scope — `aud` automatically parses them into the graph when applying the CSV. Findings and gaps still only report on scoped files.

## Phase 3: Run Rules

Run `aud run <files...> --resolutions=resolutions.csv` (omit `--resolutions` if Phase 1 was clean). Use `aud run --help` for options (specific rules, adhoc rule files, confidence filters, etc.).

Findings are tagged with a confidence kind:
- `issue` — high confidence, confirmed defect
- `smell` — medium confidence, likely problem
- `pointer` — low confidence, suspicious pattern

## Custom Rules (Per-Engagement)

Custom rules are `.lua` files (see `rule-authoring` skill for authoring details). The flywheel:

1. Find an issue during manual review
2. Recognize it's a repeatable pattern
3. Write a custom rule (see `aud run --help` for `--rule-path` usage)
4. Test against the known instance
5. Run against the full codebase to discover other instances
