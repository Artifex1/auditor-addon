# MCP Auditor Context

**MCP Auditor** is an MCP server for code estimation, security auditing, and reporting. It supports Solidity, Cairo, Compact, Move, Noir, Tolk, C++, Java, Go, Rust, JavaScript, TypeScript, TSX, and Flow.

## Tools Reference

| Tool | Inputs | Output | Purpose |
| :--- | :--- | :--- | :--- |
| `entrypoints` | `paths` (str[]) | `Entrypoint[]` | List public/external functions (attack surface). |
| `peek` | `paths` (str[]) | `Signature[]` | Extract function signatures for quick overview. |
| `metrics` | `paths` (str[]) | `Metrics[]` | Calculate NLoC, complexity, and effort estimates. |
| `callgraph` | `paths` (str[]) | `CallGraph` | Generate call graph (nodes/edges) for flow analysis. |

**Note:** `paths` allow for glob patterns.

## Workflows

Workflows are defined in `commands/` as TOML prompts. Use them sequentially.

### 1. Estimation (`/estimate/*`)
1.  **Discovery** (`discovery`): Identify scope and chunk files.
2.  **Explore** (`explore`): Categorize files and refine scope using `peek`.
3.  **Metrics** (`metrics`): Calculate effort for in-scope files using `metrics`.
4.  **Report** (`report`): Generate final estimation report.

**Important:** Agents should work primarily from context and **must not** write any intermediate outcomes to files unless explicitly asked to do so.

### 2. Audit (`/audit/*`)
1.  **Map** (`map`): Build system map (Components, Invariants, Flows) using `entrypoints` & `callgraph`.
2.  **Hunt** (`hunt`): Identify suspicious spots (high recall) using `entrypoints`.
3.  **Attack** (`attack`): Verify specific spots (high precision) via rigorous reasoning.

### 3. Writing (`/write/*`)
1.  **Issue** (`issue`): Write up confirmed vulnerabilities (OpenZeppelin style).
2.  **Intro** (`intro`): Generate audit report introduction.

## Critical Reasoning & Validation Protocol

**Agents MUST adhere to this protocol for every code review or vulnerability analysis task:**

1.  **Hypothesis-Driven Analysis**: Treat every user-provided "issue" or "vulnerability" as a **hypothesis to be falsified**, not a fact to be confirmed.
2.  **Cross-Reference Mandate**: Never validate a code finding in isolation. You MUST cross-reference the code against documentation, specs, and protocol invariants.
3.  **Devil's Advocate**: Before concluding that an issue is true, you must explicitly try to find a reason why it is "False" (e.g., a constraint in another file, a protocol constant, or a deterministic fallback).

## Key Concepts

-   **Anti-Parroting**: Do not repeat the user's claims back to them. Provide independent, evidence-based (in)validation.
-   **Threat Model**: Privileged roles are honest; focus on unprivileged/external actors.
-   **TOON**: The output format of the MCP tools is Token-Oriented Object Notation (TOON).
-   **Invariants**: Properties that must always hold true (e.g., `UserBalance <= TotalSupply`).
-   **No Code Fixes**: Do NOT suggest code fixes; focus on identifying and explaining issues.
-   **Tool-first rule**: Use tool calls quickly where applicable; avoid preamble.
