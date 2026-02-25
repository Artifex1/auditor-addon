# Auditor Addon Context

**Auditor Addon** is an MCP server for code estimation, security auditing, and reporting. It supports Solidity, Cairo, Compact, Move, Noir, Tolk, Masm, C++, Java, Go, Rust, JavaScript, TypeScript, TSX, Flow, and Python.

## Tools Reference

| Tool | Inputs | Output | Purpose |
| :--- | :--- | :--- | :--- |
| `peek` | `paths` (str[]) | `Signature[]` | Extract function signatures for quick overview. |
| `metrics` | `paths` (str[]) | `Metrics[]` | Calculate NLoC, complexity, and effort estimates. |
| `call_chains` | `paths` (str[]) | `{ call_chains: Record<root, string[]>, hotspots: string[] }` | Generate call chains from root functions (called by nothing), grouped by root and sorted longest-first. Includes a hotspot summary of functions appearing across the most chains. |
| `diff_metrics` | `base` (str), `head?` (str), `paths?` (str[]) | `DiffMetrics[]` | Calculate metrics for changes between git refs. |
| `diff` | `base` (str), `head?` (str), `paths?` (str[]), `output?` ('full'\|'signatures') | `FileDiff[]` or `FileSignatureChanges[]` | Get raw diff or function-level signature changes. |

**Note:** `paths` allow for glob patterns. For `diff_metrics` and `diff`, `base` and `head` are git refs (commit, branch, tag).
**Format**: The output format of the MCP tools is Token-Oriented Object Notation (TOON).
