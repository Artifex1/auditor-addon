---
name: sast-pipeline
description: Running the SAiST (Static AI-assisted Security Testing) pipeline against a codebase. Use when the user wants to run static analysis rules, detect code smells, find vulnerability patterns, or scan code with the built-in rule engine. Covers the full init → resolve gaps → run rules flow.
argument-hint: "<files or scope>"
---

# SAiST Pipeline

Three-phase static analysis: **init** → **resolve gaps** → **run rules**.

## Phase 1: Init Scan

```
sast_init_scan({
  files: ["src/**/*.sol"],
  languages: ["solidity"],
  context: {
    domainOverrides: { "rust": "on-chain" },  // e.g. Anchor/CosmWasm
    framework: "anchor"
  }
})
```

Builds `SymbolMap` (functions, state variables, call edges, modifiers, state reads/writes). Computes **hotspots** (functions in the most call chains). Detects **gaps** — callees the static pass cannot resolve:

- `unresolved_callee`: target not found in scope
- `interface_dispatch`: call through interface (concrete impl unknown)
- `external_library`: target exists but out-of-scope

Returns `scanId`, gaps (prioritized high/medium/low by hotspot proximity), hotspots. Status is `needs_resolution` if gaps exist, `ready` if none.

## Phase 2: Resolve Gaps (optional)

Review gaps and resolve what you can. Each gap has `id`, `type`, `qualifiedName`, `callSite`, `codeSnippet`, `priority`.

**Triage:**
- **high** (in hotspots): read code, determine writesState/callsExternal
- **medium** (public callers): resolve if affecting rule accuracy
- **low** (internal): often safe to skip

```
sast_resolve_gaps({
  scanId: "abc123",
  resolutions: [{
    gapId: "deadbeef1234",
    facts: { writesState: ["balances"], callsExternal: false },
    resolvedBy: "agent",
    confidence: "medium"
  }]
})
```

Skip entirely if gap count is zero or all low priority.

## Phase 3: Run Rules

```
sast_run_rules({
  scanId: "abc123",
  includeSeverity: ["critical", "high", "medium"],
  includeKind: ["issue", "smell"],
})
```

**Filters:** `ruleIds` (specific IDs), `includeSeverity`, `includeKind` (`issue`, `smell`, `pointer`).

**Output per finding:** `ruleId`, `severity`, `kind`, `title`, `description`, `confidence`, instances with `location: { file, line, col }` and optional `executionPath`. Summary has `bySeverity` and `byKind` counts.

## Finding Kinds

| Kind | Confidence | Meaning |
|---|---|---|
| `issue` | high | Confirmed defect — must fix |
| `smell` | medium | Likely problem — investigate |
| `pointer` | low | Suspicious pattern — verify manually |

**Pointer rules** flag syntactic patterns (rounding in branch conditions, few fields in EIP-712 hashes, inconsistent guard-vs-assignment) that have historically led to vulnerabilities. Expect false positives.

## Custom Rules

Besides shipped rules, the pipeline supports per-engagement custom rules. Pass file paths via `customRulePaths`:

```
sast_run_rules({
  scanId: "abc123",
  customRulePaths: ["./rules/CUSTOM-001-unbounded-loop.ts"],
})
```

Custom rule IDs **must** use the `CUSTOM-` prefix. Use the rule-authoring skill to create them.

**Flywheel:** Find an issue → recognize it's a pattern → write a custom rule → test it flags the known instance → run it against the full codebase to find more.

## Typical Workflow

1. Init scan with all in-scope files
2. If gaps > 0 and high priority: read relevant code, resolve
3. Run rules with `includeKind: ["issue", "smell"]`
4. Validate findings against code at reported locations
5. Optionally run `includeKind: ["pointer"]` for lower-confidence flags
6. If a confirmed finding is a repeatable pattern, write a custom rule (rule-authoring skill) and re-scan
7. Write up confirmed findings with the scribe skill
