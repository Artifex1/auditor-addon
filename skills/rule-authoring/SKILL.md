---
name: rule-authoring
description: Writing SAiST static analysis rules in Lua — both shipped rules in the auditor-addon repo and custom per-engagement rules in audit workspaces. Use when the user wants to create a new detection rule, add a security check, implement a code smell detector, turn a confirmed finding into a reusable rule, or extend the rule set. Covers rule types (scope/deep/map), the Lua API, language scoping, finding kinds, custom rules, and testing patterns.
argument-hint: "<rule idea or vulnerability pattern>"
---

# Rule Authoring

Rules are `.lua` files. Two deployment modes:

- **Shipped rules** (`rules/`): bundled with the tool. IDs use language prefixes: `SOL-` (Solidity), `GEN-` (generic/multi-language). Run automatically on `aud run` for applicable languages.
- **Adhoc rules** (any `.lua` file or inline string): per-engagement rules. Load at runtime via `--rule-path=<file>` or `--rule-inline=<lua_code>`.

Both use the exact same Lua interface.

## CLI Binary

This skill requires the `auditor-addon-cli` skill for the `aud` binary. Before running any `aud` command, load that skill to determine the correct binary path.

## Choosing a Rule Type

### Scope Rule (`type = "scope"`)

Walks every AST node across all files. Use for patterns detectable within a single function or file without following call edges. Examples: missing visibility, division before multiplication, dangerous opcode usage.

### Deep Rule (`type = "deep"`)

Same visitor pattern but the walker follows call edges across function boundaries. `ctx.depth` increments at each function transition. Use for patterns spanning multiple functions (e.g., external call followed by state write in caller). Requires `max_depth`.

### Map Rule (`type = "map"`)

Runs once after the full graph is built. No AST traversal — queries the symbol graph directly. Use for cross-function or cross-file reasoning: caller counts, visibility analysis, unused functions, state variable patterns. Defines `check()` instead of `enter()`/`exit()`.

## Rule Structure

### Visitor Rule (scope or deep)

```lua
rule = {
    id = "SOL-002",
    name = "reentrancy",
    severity = "critical",   -- critical | high | medium | low | info
    confidence = "smell",    -- issue | smell | pointer
    type = "deep",           -- "scope" or "deep"
    max_depth = 5,           -- deep only
    description = "Detects state changes after external calls",
    languages = {"solidity"}, -- nil or omitted = all languages
}

-- Module-level state persists across the entire walk (all files)
local seen_external_call = false

-- Per-kind hooks: define `enter_<node_type>` / `exit_<node_type>` for the
-- tree-sitter node kinds you care about. The walker only invokes hooks that
-- exist, so rules only pay the Lua call cost for nodes they actually handle.
function enter_function_definition(node, ctx)
    -- node = { kind, line, file, name, handle }
    -- ctx  = { depth, current_file, current_node }
    seen_external_call = false   -- reset per-function state
end

function enter_call_expression(node, ctx)
    -- Heuristic: any call is treated as potentially external.
    if not seen_external_call then
        seen_external_call = true
    end
end

local function report_write(node, ctx)
    if not seen_external_call then return end
    report.hit({
        file = ctx.current_file,
        line = node.line,
        node_text = ast.text(node.handle) or "",
    })
end

function enter_assignment_expression(node, ctx)           report_write(node, ctx) end
function enter_augmented_assignment_expression(node, ctx) report_write(node, ctx) end

-- Optional: `exit_<kind>` fires bottom-up when leaving a subtree.
-- Optional: `finalize()` fires once after all files have been walked; use for
--           findings that depend on state accumulated across the entire walk.
```

### Map Rule

```lua
rule = {
    id = "SOL-022",
    name = "broad-visibility",
    severity = "info",
    confidence = "pointer",
    type = "map",
    description = "Detects functions with broader visibility than needed",
}

function check()
    local findings = {}
    local functions = graph.get_nodes_by_kind("callable")
    for _, fn in ipairs(functions) do
        local vis = graph.get_property(fn.id, "visibility")
        if vis == "public" then
            local callers = graph.get_incoming_edges(fn.id, "call")
            if #callers == 0 then
                table.insert(findings, {
                    file = fn.file,
                    line = fn.line,
                    node_text = fn.name,
                })
            end
        end
    end
    return findings
end
```

## Hook Lifecycle

### Visitor rules (scope / deep)

1. **`enter_<kind>(node, ctx)`** — called top-down when entering a node of the given tree-sitter kind. Define one per kind you care about (e.g., `enter_function_definition`, `enter_call_expression`).
2. **`exit_<kind>(node, ctx)`** — called bottom-up when leaving a node of that kind. Use for cleanup or patterns that need to know when a subtree is fully visited.
3. **`finalize()`** — called once after all files have been walked. Use for emitting findings that depend on state accumulated across the entire walk (e.g., counting patterns across files, then reporting only if a threshold is met).

All hooks are optional — define only what the rule needs. The walker validates every `enter_*` / `exit_*` function name at load time against the declared languages' tree-sitter vocabulary; typos (e.g., `enter_function_defintion`) raise a rule-load error with a "did you mean" suggestion.

A generic `enter(node, ctx)` / `exit(node, ctx)` is also still accepted and fires on every node — only use it when the rule genuinely needs to react to every kind. Per-kind hooks are dramatically faster because the walker skips nodes with no matching hook entirely.

### Map rules

1. **`check()`** — called once after the full symbol graph is built. Query the graph, return a findings table.

## Lua API

The Lua rule API has three namespaces: `graph.*` (symbol-graph queries), `ast.*` (tree-sitter access), and `report.*` (findings + diagnostics).

**Always run `aud api` to see the current reference.** Every function registered in the Lua runtime appears with its signature and a one-line description. The output is generated from the same registry the runtime uses, so it cannot drift from the actual API.

```bash
aud api
```

Use `aud api` before writing a rule to pick the right function, and when upgrading an existing rule to see what's new.

### Discovering per-language vocabulary

`graph.language_info()` returns the valid argument vocabulary for the current language:

```lua
local info = graph.language_info()
-- info.language    — e.g. "solidity"
-- info.node_kinds  — valid graph.get_nodes_by_kind() arguments
-- info.ref_kinds   — valid ref_kind filters for get_outgoing_edges / get_refs
-- info.properties  — valid graph.get_property() keys (language-specific)
```

Passing an invalid kind or property key emits a diagnostic warning and returns an empty result.

### Graph minimalism

The symbol graph is deliberately small: only **files, containers, and callables** are nodes; only **import, call, inheritance, and using_for** are refs. State variables, modifiers, events, custom errors, structs, and enums are **not** in the graph — they live in the AST.

To query them, use the AST bridge or scope lookups:

```lua
-- Scan a function body for event emits (AST).
-- Graph-query results (fn here) carry `id` but no handle; convert via ast.node(id).
local h = ast.node(fn.id)
for _, emit in ipairs(ast.find(h, "emit_statement")) do ... end

-- Walk an inheritance chain looking for a state variable by name (graph + AST)
local var = graph.find_in_scope(container.id, "balances", "state_variable_declaration")
if graph.exists_in_scope(container.id, "owner", "state_variable_declaration") then ... end
```

`graph.find_in_scope` / `exists_in_scope` walk the C3-linearized MRO of a container and look for a direct AST child of the given tree-sitter type whose `name` field matches.

### AST bridge notes

`node.handle` in `enter()`/`exit()` is an `ast_handle`. Prefer `ast.type()` checks over `ast.text()` — type strings are interned (fast); text copies from Zig to Lua GC (slow for large nodes).

### Reporting

Visitor rules call `report.hit()` inline. Map rules return a findings table from `check()`. Rule metadata (`id`, `name`, `severity`, `description`) is attached automatically — do not repeat it per hit.

Use `report.warn()` to surface non-fatal issues during rule execution (e.g., unexpected graph state, skipped checks). Warnings appear in the `diagnostics` output section, separate from findings.

## Language Scoping

```lua
languages = {"solidity"}           -- single language
languages = {"solidity", "cairo"}  -- multi-language
-- omit or nil                     -- all languages
```

Naming convention:
- **SOL-NNN** — Solidity-specific
- **GEN-NNN** — multi-language (no filter)

Only list languages whose grammar you have verified against the vendor grammars in `vendor/grammars/`.

## Grammar Reference

Compact per-language node-type references live in `skills/rule-authoring/grammars/<lang>.md`. Each lists every named tree-sitter node type with its field names — the same strings used in `ast.type()` and `ast.child_by_field()`. Regenerate after adding a grammar:

```bash
python3 scripts/gen-grammar-refs.py          # all languages
python3 scripts/gen-grammar-refs.py solidity  # one language
```

**When writing a rule**, read the target language's grammar file first to find the correct node type names and field names before writing any `ast.*` calls. Hidden/inline grammar rules (prefixed `_` in tree-sitter) do not appear — their fields surface on the parent node.

## Confidence

Each rule declares `confidence` to signal detection reliability. This is orthogonal to `severity` (which rates how bad the finding is).

| Value | Meaning | When to use |
|---|---|---|
| `issue` | 100% accurate, zero FPs | Syntactically deterministic — the pattern is either present or not (e.g., missing SPDX, floating pragma) |
| `smell` | Real antipattern, FPs possible | Rule catches a genuine problem but can't see all context (e.g., reentrancy — guards may exist outside AST scope) |
| `pointer` | Location for investigation | Pattern flags a spot worth examining but isn't inherently a defect (e.g., broad visibility, double state read) |

Default is `"smell"` if omitted. Bias toward lower confidence — prefer surprise true positives over surprise false positives.

CLI filter: `--confidence=issue,smell` runs only rules at those confidence levels.

**Design principle:** All rules must have a **syntactic** anchor — a structural AST pattern. If detection requires understanding what a variable *means* (name-matching heuristics like "fee", "onBehalf"), it belongs to the agent, not a rule.

## Inline Adhoc Rules (Agent Use)

For quick one-off scans, use `--rule-inline` to avoid writing a file:

```bash
aud run "src/**/*.sol" --rule-inline='
rule = {id="X",name="assembly-use",severity="medium",type="scope",languages={"solidity"}}
function enter_assembly_statement(node, ctx)
  report.hit({file=ctx.current_file, line=node.line, node_text=""})
end'
```

## Testing

Test a shipped or custom rule by running it against a fixture file:

```bash
aud run tests/solidity/fixtures/Vault.sol --rule-path=./rules/SOL-002-reentrancy.lua --json
```

Every rule needs a positive case (the pattern is present and flagged) and a negative case (the safe variant produces no findings). For shipped rules, add Zig integration tests in `tests/<lang>/integration_test.zig`.

### Adding a Shipped Rule

1. Add the `.lua` file to `rules/` with a standard ID prefix
2. Register it in `src/rules/shipped.zig`
3. Add test cases in `tests/<lang>/integration_test.zig`
