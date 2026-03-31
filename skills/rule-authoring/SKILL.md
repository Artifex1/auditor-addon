---
name: rule-authoring
description: Writing SAiST static analysis rules in Lua — both shipped rules in the auditor-addon repo and custom per-engagement rules in audit workspaces. Use when the user wants to create a new detection rule, add a security check, implement a code smell detector, turn a confirmed finding into a reusable rule, or extend the rule set. Covers rule types (scope/deep/map), the Lua API, language scoping, finding kinds, custom rules, and testing patterns.
argument-hint: "<rule idea or vulnerability pattern>"
---

# Rule Authoring

Rules are `.lua` files. Two deployment modes:

- **Shipped rules** (`rules/`): bundled with the tool. IDs use standard prefixes: `SOL-`, `GEN-`, `MAP-`. Run automatically on `aa run` for applicable languages.
- **Adhoc rules** (any `.lua` file or inline string): per-engagement rules. Load at runtime via `--rule-path=<file>` or `--rule-inline=<lua_code>`. CUSTOM- prefix is conventional.

Both use the exact same Lua interface.

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
    type = "deep",           -- "scope" or "deep"
    max_depth = 5,           -- deep only
    description = "Detects state changes after external calls",
    languages = {"solidity"}, -- nil or omitted = all languages
}

-- Module-level state persists across the entire walk (all files)
local seen_external_call = false

function enter(node, ctx)
    -- node = { kind, line, file, name, handle, start_byte }
    -- ctx  = { depth, current_file, current_node }

    -- Reset per-function state at function boundaries
    if node.kind == "function_definition" then
        seen_external_call = false
    end

    if not seen_external_call and node.kind == "call_expression" then
        local ref = graph.get_ref_at(ctx.current_file, node.start_byte)
        if ref and ref.target_kind == "external" then
            seen_external_call = true
        end
    end

    if seen_external_call then
        if node.kind == "assignment_expression"
            or node.kind == "augmented_assignment_expression" then
            report.hit({
                file = ctx.current_file,
                line = node.line,
                node_text = ast.text(node.handle) or "",
            })
        end
    end
end

function exit(node, ctx) end   -- optional
function reset() end           -- optional: reset module state between rule invocations
```

### Map Rule

```lua
rule = {
    id = "MAP-001",
    name = "broad-visibility",
    severity = "info",
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

## Lua API

### Graph Queries (`graph.*`)

```
graph.get_nodes_by_kind(kind)              -> [{id, kind, name, qualified_name, visibility}]
graph.get_node(id)                         -> {id, kind, name, qualified_name, visibility, ...}
graph.get_property(id, key)                -> string | nil
graph.get_children(id)                     -> [node]  (from contains edges)
graph.get_parent(id)                       -> node | nil
graph.language_info()                      -> {language, node_kinds, ref_kinds, properties}

graph.get_outgoing_edges(id, ?ref_kind)    -> [{to, kind, target_name, call_site_line, target_kind}]
graph.get_incoming_edges(id, ?ref_kind)    -> [{from, kind, target_name, call_site_line, target_kind}]
graph.get_callers(id)                      -> [node]
graph.get_callees(id)                      -> [node]

graph.get_refs(id, ?ref_kind)              -> [{ref_id, from, kind, target_name, targets, gap, site_line}]
graph.get_ref_at(file, start_byte)         -> ref | nil   (O(1) site lookup)
graph.get_gaps(?ref_kind)                  -> [{ref_id, from, kind, target_name, gap, site_line}]
```

### AST Bridge (`ast.*`)

For pattern-level rules that need raw tree-sitter access. Works identically for all grammars.

```
ast.node(graph_node_id)           -> ast_handle
ast.children(handle)              -> [ast_handle]
ast.named_children(handle)        -> [ast_handle]  (skip anonymous nodes)
ast.child(handle, index)          -> ast_handle | nil
ast.child_by_field(handle, name)  -> ast_handle | nil
ast.parent(handle)                -> ast_handle | nil
ast.next_sibling(handle)          -> ast_handle | nil
ast.prev_sibling(handle)          -> ast_handle | nil
ast.type(handle)                  -> string  (tree-sitter node type)
ast.text(handle)                  -> string  (source text)
ast.find(handle, type_name)       -> [ast_handle]  (recursive descendant search)
ast.start_line(handle)            -> number
ast.end_line(handle)              -> number
ast.start_byte(handle)            -> number
ast.end_byte(handle)              -> number
ast.is_named(handle)              -> boolean
```

`node.handle` in `enter()`/`exit()` is an `ast_handle`. Prefer `ast.type()` checks over `ast.text()` — type strings are interned (fast); text copies from Zig to Lua GC (slow for large nodes).

### Reporting (`report.*`)

```
report.hit(opts)
    opts = {
        file:       string,   -- ctx.current_file
        line:       number,   -- node.line
        node_text:  string,   -- optional, source text for context
    }
```

Visitor rules call `report.hit()` inline. Map rules return a findings table from `check()`. Rule metadata (`id`, `name`, `severity`, `description`) is attached automatically — do not repeat it per hit.

## Language Scoping

```lua
languages = {"solidity"}           -- single language
languages = {"solidity", "cairo"}  -- multi-language
-- omit or nil                     -- all languages
```

Naming convention:
- **SOL-NNN** — Solidity-specific
- **GEN-NNN** — multi-language (no filter)
- **MAP-NNN** — map rules (post-graph)
- **CUSTOM-NNN** — per-engagement adhoc rules

Only list languages whose grammar you have verified against the vendor grammars in `vendor/grammars/`.

## Grammar Reference

Compact per-language node-type references live in `skills/rule-authoring/grammars/<lang>.md`. Each lists every named tree-sitter node type with its field names — the same strings used in `ast.type()` and `ast.child_by_field()`. Regenerate after adding a grammar:

```bash
python3 scripts/gen-grammar-refs.py          # all languages
python3 scripts/gen-grammar-refs.py solidity  # one language
```

**When writing a rule**, read the target language's grammar file first to find the correct node type names and field names before writing any `ast.*` calls. Hidden/inline grammar rules (prefixed `_` in tree-sitter) do not appear — their fields surface on the parent node.

## Finding Kinds

| Kind | When to use |
|---|---|
| `issue` | High confidence — confirmed defect pattern |
| `smell` | Medium confidence — likely problem, anti-pattern |
| `pointer` | Low confidence — structural pattern historically linked to bugs |

**Design principle:** All rules must have a **syntactic** anchor — a structural AST pattern. If detection requires understanding what a variable *means* (name-matching heuristics like "fee", "onBehalf"), it belongs to the agent, not a rule.

## Inline Adhoc Rules (Agent Use)

For quick one-off scans, use `--rule-inline` to avoid writing a file:

```bash
aa run "src/**/*.sol" --rule-inline='
rule = {id="X",name="assembly-use",severity="medium",type="scope",languages={"solidity"}}
function enter(node, ctx)
  if node.kind == "assembly_statement" then
    report.hit({file=ctx.current_file, line=node.line, node_text=""})
  end
end'
```

## Testing

Test a shipped or custom rule by running it against a fixture file:

```bash
aa run tests/solidity/fixtures/Vault.sol --rule-path=./rules/SOL-002-reentrancy.lua --json
```

Every rule needs a positive case (the pattern is present and flagged) and a negative case (the safe variant produces no findings). For shipped rules, add Zig integration tests in `tests/<lang>/integration_test.zig`.

### Adding a Shipped Rule

1. Add the `.lua` file to `rules/` with a standard ID prefix
2. Register it in `src/rules/shipped.zig`
3. Add test cases in `tests/<lang>/integration_test.zig`
