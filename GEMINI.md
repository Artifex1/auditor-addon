# MCP Auditor Context

**MCP Auditor** is an MCP server for code estimation, security auditing, and reporting. It supports Solidity, Cairo, Compact, Move, Noir, Tolk, C++, Java, Go, and Rust.

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

## Key Concepts

-   **Threat Model**: Privileged roles are honest; focus on unprivileged/external actors.
-   **TOON**: The output format of the MCP tools is Token-Oriented Object Notation (TOON).
-   **Invariants**: Properties that must always hold true (e.g., `UserBalance <= TotalSupply`).
-   **No Code Fixes**: Do NOT suggest code fixes; focus on identifying and explaining issues.
-   **Tool-first rule:** User tool calls quickly where applicable; avoid preamble.
-   **Batching:** Prefer glob/array inputs; minimize number of tool calls.
