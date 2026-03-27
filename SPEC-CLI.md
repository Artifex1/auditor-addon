# aa CLI — Utility Commands Specification

Utility subcommands for the aa CLI that operate independently of the symbol
graph. These are lightweight tools for codebase exploration and estimation.

The symbol graph commands (`gaps`, `run`, `call-chains`, `graph`, `info`) are
specified in `SPEC.md`.

---

## 1. peek

Extract function signatures from source files. Gives auditors a quick API
surface view without reading full function bodies.

```
aa peek <glob...>
    --language=<lang>                           -- force language (otherwise auto-detected)
    --json                                      -- JSON output instead of TOON
```

**How it works**: Parse each file with tree-sitter, find function/callable
declarations, extract the text from the declaration start up to (but not
including) the opening brace. Clean up whitespace: collapse multi-line
signatures into a single line, normalize spacing around parentheses and commas.

**TOON output:**
```
src/Vault.sol{signatures[3]}:
  function withdraw(uint256 amount) external
  function deposit() external payable
  function _transfer(address to, uint256 amount) internal returns (bool)
src/Ownable.sol{signatures[2]}:
  function owner() public view returns (address)
  function _checkOwner() internal view
```

Plain signatures as they appear in source, just flattened and trimmed. No
structured decomposition into fields — the raw signature is more useful for
auditors who read Solidity (or any language) natively.

Uses the same tree-sitter grammars and `CallableMapping` from SPEC.md for
function detection. No graph construction — just a per-file AST walk.

---

## 2. metrics

Calculate code metrics for audit scoping and effort estimation.

```
aa metrics <glob...>
    --language=<lang>                           -- force language (otherwise auto-detected)
    --json                                      -- JSON output instead of TOON
```

### 2.1 nLOC (Normalized Lines of Code)

All counting is tree-sitter node driven. No line-by-line text scanning.

```
total_lines     = count of \n in file text + 1
blank_lines     = count of lines where trim() == ""
comment_lines   = sum of (count \n in node.text() + 1) for each comment node
normalization   = sum of (count \n in node.text()) for each normalizable node
nLOC            = total_lines - blank_lines - comment_lines - normalization
```

**Comment lines**: Find all `comment` and `block_comment` nodes (per config).
For each node, get its text via tree-sitter and count `\n` + 1 to get the
number of lines it spans. A single-line `// comment` spans 1 line. A block
comment spanning 5 lines spans 5.

**Normalization**: Multi-line constructs that are commonly split for readability
(function definitions, call expressions, parameter lists) should count as 1
line, not N. Find these nodes (per config), get their text, count `\n` — that's
the extra lines to subtract. A function signature spanning 4 lines contributes
3 to normalization (4 lines → 1 normalized line, subtract 3).

**Blank lines**: Only metric requiring line-by-line check. Cheap — split on
`\n`, trim, count empties.

### 2.2 Cognitive Complexity

Measures how difficult code is to understand. Each control flow structure
contributes `1 + nesting_depth`:

```
complexity = 0
for each branch node (per config: if, for, while, do-while, catch):
    nesting = count ancestor nodes that are also branch nodes
    complexity += 1 + nesting
```

A deeply nested `if` inside a `for` inside a `while` contributes more than a
flat `if` at the top level. Nesting is determined by walking up the AST from
each branch node and counting ancestor branch nodes.

Reported as a raw score and normalized per 100 nLOC (integer math, multiply
first to avoid truncation):
```
normalized_complexity = (complexity * 100) / nLOC   -- cognitive complexity per 100 lines
```

### 2.3 Comment Density

```
comment_density = (comment_lines * 100) / nLOC   -- percentage of lines with comments
```

`comment_lines` is already computed in §2.1 from tree-sitter comment nodes.
No separate pass needed.

### 2.4 Effort Estimation

Simplified estimation based on nLOC throughput:

```zig
const hours: f32 = @as(f32, @floatFromInt(nloc)) / @as(f32, @floatFromInt(base_rate)) * 6.0;
```

Formatted with one decimal (`{d:.1}`). Float is idiomatic Zig here — auditors
sum hours across files, so precision in the total matters.

Where `base_rate_per_day` is the expected nLOC an auditor reviews per working
day (language-specific constant, e.g., 150 for Solidity). Multiplied by 6 to
convert days to hours (6 productive hours per day).

Example: 120 nLOC at 150/day → `120 / 150 * 6 = 4.8h`.

No complexity or comment adjustments — just a linear estimate from code volume.
The auditor applies judgment for complexity; the tool gives a baseline.

### 2.5 Config

Metrics detection is language-specific via config. All detection is tree-sitter
node driven — no text pattern matching needed.

```zig
const MetricsConfig = struct {
    /// Tree-sitter node types for cognitive complexity (control flow)
    branching_types: []const []const u8,
    /// Tree-sitter node types for comments (count \n + 1 for lines)
    comment_types: []const []const u8,
    /// Tree-sitter node types for multi-line normalization (count \n for extra lines)
    normalization_types: []const []const u8,
    /// nLOC throughput per day for estimation
    base_rate_per_day: u32,
};
```

Example for Solidity:
```zig
.metrics = .{
    .branching_types = &.{
        "if_statement", "for_statement", "while_statement",
        "do_while_statement", "catch_clause",
    },
    .comment_types = &.{ "comment", "block_comment" },
    .normalization_types = &.{ "function_definition", "call_expression" },
    .base_rate_per_day = 150,
},
```

This config is part of `LanguageConfig` (see SPEC.md §4.4), so every language
that supports graph construction also supports metrics out of the box.

### 2.6 Output

**TOON output:**
```
files[3]{file,nLOC,cognitiveComplexity(per100),commentDensity(%),estimatedHours}:
  src/Vault.sol,120,24,7.35,0.13
  src/Ownable.sol,45,6,12.50,0.05
  src/AccessControl.sol,80,12,5.00,0.09
totals:
  nLOC: 245
  hours: 0.27
  days: 0.04
```

Uses tree-sitter for parsing. No graph construction — each file is parsed and
walked independently.

---

## 3. Future Commands

The following may be added later:

- **`aa diff <ref1> <ref2>`** — git diff with optional signature-level
  summarization (function-level changes rather than line-level)
- **`aa diff-metrics <ref1> <ref2>`** — metrics computed on the diff between
  two git refs for incremental audit scoping

These are deferred until their value over standard git tooling is validated.
