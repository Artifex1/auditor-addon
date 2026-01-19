# MCP Auditor Context

**MCP Auditor** is an MCP server for code estimation, security auditing, and reporting. It supports Solidity, Cairo, Compact, Move, Noir, Tolk, C++, Java, Go, Rust, JavaScript, TypeScript, TSX, and Flow.

## Tools Reference

| Tool | Inputs | Output | Purpose |
| :--- | :--- | :--- | :--- |
| `peek` | `paths` (str[]) | `Signature[]` | Extract function signatures for quick overview. |
| `metrics` | `paths` (str[]) | `Metrics[]` | Calculate NLoC, complexity, and effort estimates. |
| `execution_paths` | `paths` (str[]) | `string[]` | Generate linear execution call chains from public entrypoints. |

**Note:** `paths` allow for glob patterns.
**Format**: The output format of the MCP tools is Token-Oriented Object Notation (TOON).

## Skills

Skills provide complete instructions for structured workflows. The agent should invoke skills directly.

| Skill | Purpose | Capabilities |
| :--- | :--- | :--- |
| `security-auditor` | Comprehensive security auditing | Map, Hunt, Attack |
| `estimator` | Project scoping and effort estimation | Discovery, Explore, Metrics, Report |
| `design-challenger` | Challenge overcomplicated designs | Challenge |
| `scribe` | Report writing and finding generation | Issue, Intro |

Refer to the `SKILL.md` files in `skills/` for detailed protocols.

## Commands

Commands are human-friendly shortcuts for triggering specific capabilities. They point to a skill but don't load its instructions. **The agent should use the skill directly instead.**

| Command | Maps to |
| :--- | :--- |
| `/audit:map`, `/audit:hunt`, `/audit:attack` | `security-auditor` |
| `/estimate:discovery`, `/estimate:explore`, `/estimate:metrics`, `/estimate:report` | `estimator` |
| `/write:issue`, `/write:intro` | `scribe` |
| `/design:challenge` | `design-challenger` |
