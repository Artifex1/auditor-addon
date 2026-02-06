# Auditor Addon Context

**Auditor Addon** is an MCP server for code estimation, security auditing, and reporting. It supports Solidity, Cairo, Compact, Move, Noir, Tolk, Masm, C++, Java, Go, Rust, JavaScript, TypeScript, TSX, and Flow.

## Tools Reference

| Tool | Inputs | Output | Purpose |
| :--- | :--- | :--- | :--- |
| `peek` | `paths` (str[]) | `Signature[]` | Extract function signatures for quick overview. |
| `metrics` | `paths` (str[]) | `Metrics[]` | Calculate NLoC, complexity, and effort estimates. |
| `execution_paths` | `paths` (str[]) | `string[]` | Generate linear execution call chains from public entrypoints. |
| `diff_metrics` | `base` (str), `head?` (str), `paths?` (str[]) | `DiffMetrics[]` | Calculate metrics for changes between git refs. |
| `diff` | `base` (str), `head?` (str), `paths?` (str[]), `output?` ('full'\|'signatures') | `FileDiff[]` or `FileSignatureChanges[]` | Get raw diff or function-level signature changes. |

**Note:** `paths` allow for glob patterns. For `diff_metrics` and `diff`, `base` and `head` are git refs (commit, branch, tag).
**Format**: The output format of the MCP tools is Token-Oriented Object Notation (TOON).

## Skills

Skills provide complete instructions for structured workflows. The agent should invoke skills directly.

| Skill | Purpose | Capabilities |
| :--- | :--- | :--- |
| `security-auditor` | Comprehensive security auditing | Map, Hunt, Attack |
| `estimator` | Project scoping and effort estimation | Full scope (Discovery, Explore, Metrics, Report) or Diff scope (Discovery, Review, Report) |
| `design-challenger` | Challenge overcomplicated designs | Challenge |
| `scribe` | Report writing and finding generation | Issue, Intro |

Refer to the `SKILL.md` files in `skills/` for detailed protocols.
