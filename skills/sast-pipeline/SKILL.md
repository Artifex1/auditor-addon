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

```bash
aud gaps <files...>
aud gaps <files...> --json   # JSON output
```

Builds the symbol graph and emits all unresolved references (gaps). Gaps are grouped by priority:

- `high` — in call chains from public entry points
- `medium` — have public callers
- `low` — internal, unlikely to affect rule accuracy

Gap output (TOON):
```
gaps[3]{ref_id,from_name,target_name,kind,file,line,priority}:
  a4f2e81b,withdraw,onlyOwner,call,src/Vault.sol,42,high
  b7c3d012,deposit,Ownable,call,src/Vault.sol,12,medium
  ...
```

Status is clean if no gaps; otherwise proceed to Phase 2 before running rules.

## Phase 2: Resolve Gaps (optional)

Review gaps and resolve what you can. Create a CSV file:

```csv
ref_id,target_file,target_line,target_name
a4f2e81b,src/Ownable.sol,15,onlyOwner
b7c3d012,src/Ownable.sol,3,Ownable
```

**Triage:**
- **high**: read code, determine the real target, add to CSV
- **medium**: resolve if it affects rule accuracy
- **low**: safe to skip

Resolution target files do NOT need to be in the original scope — `aud` automatically parses them into the graph when applying the CSV. Findings and gaps still only report on scoped files.

Verify resolutions are applied correctly:
```bash
aud gaps <files...> --resolutions=resolutions.csv
```

Stale/broken resolutions are reported as warnings.

## Phase 3: Run Rules

```bash
aud run <files...>
aud run <files...> --resolutions=resolutions.csv   # with resolved gaps
aud run <files...> --rule=SOL-002                  # specific shipped rule
aud run <files...> --rule-path=./rules/CUSTOM-001.lua   # adhoc rule file
aud run <files...> --rule-inline='rule={id="X",name="x",severity="info",type="scope"} function enter(n,c) if n.kind=="assembly_statement" then report.hit({file=c.current_file,line=n.line,node_text=""}) end end'
```

Findings are grouped by rule in TOON output:
```
findings[SOL-002]{severity=critical,name=reentrancy}:
  src/Vault.sol:42  withdraw → balances[msg.sender] -= amount
```

## Finding Kinds

Shipped rules tag findings with a kind (visible in `--json` output):

| Kind | Confidence | Meaning |
|---|---|---|
| `issue` | high | Confirmed defect — must fix |
| `smell` | medium | Likely problem — investigate |
| `pointer` | low | Suspicious pattern — verify manually |

## Custom Rules (Per-Engagement)

Custom rules are `.lua` files (see `rule-authoring` skill for authoring details). The flywheel:

1. **Find an issue** during manual review
2. **Recognize it's a pattern** — could it appear elsewhere?
3. **Write a custom rule** (e.g. `./rules/CUSTOM-001-unbounded-loop.lua`)
4. **Test against the known instance** — the rule should flag the exact location
5. **Run against the full codebase** — discover other instances

```bash
aud run <files...> --rule-path=./rules/CUSTOM-001-unbounded-loop.lua
```

Multiple adhoc rules: repeat `--rule-path` or use `--rule-inline` for short patterns.

## Typical Workflow

1. `aud gaps <files...>` — find gaps
2. If high-priority gaps: read code, determine real targets, create `resolutions.csv`
3. `aud run <files...> --resolutions=resolutions.csv`
4. Validate findings against code at reported locations
5. If a confirmed finding is a repeatable pattern, write a custom rule and re-run
6. Write up confirmed findings with the `scribe` skill
