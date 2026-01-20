# MCP Auditor Context

**MCP Auditor** is an MCP server for code estimation, security auditing, and reporting. It supports Solidity, Cairo, Compact, Move, Noir, Tolk, C++, Java, Go, Rust, JavaScript, TypeScript, TSX, and Flow.

## Tools Reference

| Tool | Inputs | Output | Purpose |
| :--- | :--- | :--- | :--- |
| `peek` | `paths` (str[]) | `Signature[]` | Extract function signatures for quick overview. |
| `metrics` | `paths` (str[]) | `Metrics[]` | Calculate NLoC, complexity, and effort estimates. |
| `diff_metrics` | `base` (str), `head?` (str), `paths?` (str[]) | `DiffMetrics[]` | Calculate metrics for changes between git refs. |
| `diff` | `base` (str), `head?` (str), `paths?` (str[]), `output?` ('full'\|'signatures') | `FileDiff[]` or `FileSignatureChanges[]` | Get raw diff or function-level signature changes. |
| `execution_paths` | `paths` (str[]) | `string[]` | Generate linear execution call chains from public entrypoints. |

**Note:** `paths` allow for glob patterns. For `diff_metrics` and `diff`, `base` and `head` are git refs (commit, branch, tag).
**Format**: The output format of the MCP tools is Token-Oriented Object Notation (TOON).

## Skills

This project uses Gemini CLI Skills for its primary workflows.

- **Security Auditor** (`security-auditor`): Comprehensive auditing (Map, Hunt, Attack).
- **Estimator** (`estimator`): Project scoping and effort estimation. Full scope (Discovery, Explore, Metrics, Report) or Diff scope (Discovery, Diff Metrics, Review, Report).
- **Design Challenger** (`design-challenger`): Challenge overcomplicated designs and propose simplifications with trade-offs.
- **Scribe** (`scribe`): Report writing and finding generation.

Refer to the respective `SKILL.md` files in the `skills/` directory for detailed protocols and prompts.
