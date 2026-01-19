<div align="center">

<img src="./logo.svg" alt="MCP Auditor Logo" width="400">

### *The LLM Multi Tool for Code Auditing*

[![MCP](https://img.shields.io/badge/MCP-Compatible-blue?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgMkw0IDZWMTJDNCAxNi40MiA3LjU4IDIwIDEyIDIyQzE2LjQyIDIwIDIwIDE2LjQyIDIwIDEyVjZMMTIgMloiIGZpbGw9IndoaXRlIi8+PC9zdmc+)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**A Gemini CLI Extension and Claude Code Plugin with Skills and Tools for code estimation, security auditing, and professional report writing.**

</div>

## 🎯 Skills

Skills are structured workflows that guide the AI through multi-step processes. Each skill contains detailed instructions, phases, and best practices for specific tasks.

| Skill | Purpose | Capabilities |
|:------|:--------|:-------------|
| 🛡️ **security-auditor** | Comprehensive security auditing | Map systems, hunt for hotspots, confirm vulnerabilities |
| 📊 **estimator** | Project scoping and effort estimation | Discovery, exploration, metrics calculation, reporting |
| 🧠 **design-challenger** | Challenge overcomplicated designs | Propose simplifications with explicit trade-offs |
| 📝 **scribe** | Report writing and finding generation | Professional issue descriptions, report introductions |

### How Skills Work

Skills provide complete instructions that the AI follows autonomously. When invoked, the AI loads the skill's protocol and executes it step-by-step, using the available tools as needed.

### Commands

Commands serve as convenient aliases for invoking skills. They map to specific skill capabilities:

| Command | Skill | Action |
|:--------|:------|:-------|
| `/audit:map`, `/audit:hunt`, `/audit:attack` | security-auditor | Map, Hunt, Attack phases |
| `/estimate:discovery`, `/estimate:explore`, `/estimate:metrics`, `/estimate:report` | estimator | Full estimation workflow |
| `/design:challenge` | design-challenger | Challenge design |
| `/write:issue`, `/write:intro` | scribe | Write findings or introductions |

---

## 🧰 Tools

Tools provide structured code analysis through Tree-sitter AST parsing. They support glob patterns for analyzing multiple files at once. Skills use these tools automatically as part of their workflows.

### 👀 `peek`

Extracts function and method signatures from source files without reading full implementations. The **estimator** skill uses peek to quickly understand a codebase's API surface, what functions exist, their parameters, visibility, and modifiers. This is ideal for initial exploration and building a mental map of unfamiliar code, without the need to read full files.

### 📏 `metrics`

The metrics tool calculates code metrics:

- **Normalized Lines of Code (nLOC)**: Total lines minus blank lines, comment-only lines, and multi-line constructs normalized to single lines (e.g., a function signature spanning 3 lines counts as 1).
- **Lines with Comments**: Count of lines containing comments, including inline comments.
- **Comment Density**: Percentage of lines that have/are comments, indicating documentation coverage.
- **Cognitive Complexity**: Measures control flow complexity by counting branches (if, for, while, etc.) weighted by nesting depth. Deeply nested logic scores higher than flat code.
- **Estimated Hours**: Review time estimate based on nLOC, adjusted by complexity (penalty for high, benefit for low) and comment density (benefit for well-documented code).

The **estimator** skill uses this tool to calculate how long it takes to perform a security audit.

### 📊 `diff_metrics`

Calculates metrics for code changes between two git refs (commits, branches, or tags). Useful for estimating incremental audit effort when reviewing pull requests or comparing versions.

- **Added/Removed Lines**: Tracks line changes per file
- **Diff nLOC**: Lines of code added (excluding blanks and comments)
- **Diff Complexity**: Sum of nesting depths for changed lines (deeply nested changes score higher)
- **Estimated Hours**: Review time for the diff, using the same estimation formula as `metrics`

Deleted files are considered "free" (zero effort) since they reduce attack surface.

### 🕸️ `execution_paths`

Traces call chains from public entrypoints through internal function calls, producing linear execution paths. The **security-auditor** skill uses this to understand how external calls flow through a system to identify attack surfaces and trace how user input propagates through the codebase.

### 🌐 Supported Languages

<div align="center">

| Language | Peek | Execution Paths | Metrics |
|:--------:|:-----------:|:-----------:|:-------:|
| 🔷 **Solidity** | ✅ | ✅ | ✅ |
| 🦀 **Rust** | ✅ | ✅ | ✅ |
| 🐹 **Go** | ✅ | ✅ | ✅ |
| 🐪 **Cairo** | ✅ | ⏳ | ✅ |
| 📦 **Compact** | ✅ | ⏳ | ✅ |
| 💧 **Move** | ✅ | ⏳ | ✅ |
| 🌑 **Noir** | ✅ | ⏳ | ✅ |
| 🧩 **Tolk** | ✅ | ⏳ | ✅ |
| ⚡ **C++** | ✅ | ⏳ | ✅ |
| ☕ **Java** | ✅ | ⏳ | ✅ |
| 🟨 **JavaScript** | ✅ | ⏳ | ✅ |
| 🔷 **TypeScript** | ✅ | ⏳ | ✅ |
| 🧩 **TSX** | ✅ | ⏳ | ✅ |
| 🌀 **Flow** | ✅ | ⏳ | ✅ |

</div>

## 📦 Installation

### Via Claude Code Plugin

```bash
# Add the marketplace
/plugin marketplace add <owner/repo>

# Then in plugin settings, install mcp-auditor
/plugin settings
```

### Via Gemini CLI Extension

> [!NOTE]
> This extension uses Skills. Please ensure the **Skills Preview** feature is enabled in your Gemini CLI settings. Confirm by typing `/skills list` in the CLI.

```bash
# Install the MCP server
gemini extensions install <this repository URL>

# Verify installation
gemini extensions list
```

### Local Development Setup

```bash
# Clone the repository
git clone <repository-url>
cd mcp-auditor

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run tests
pnpm test

# Watch mode for development
pnpm test:watch
```

---

## 🏗️ Architecture & Design

### Core Principles

- 🧩 Modular: Clear separation between MCP protocol, engine, and language adapters
- 🔌 Extensible: Easy to add new languages via `BaseAdapter` inheritance
- 🔄 DRY: Common logic shared via `BaseAdapter` class
- ✅ Tested: Tests for all language adapters

### Technology Stack

- **Runtime**: ![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)
- **AST Engine**: [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) - Fast, incremental parsing for various languages
- **Output Format**: [TOON](https://github.com/toon-format/toon) - Token-Oriented Object Notation
- **Protocol**: [MCP](https://modelcontextprotocol.io) - Model Context Protocol
- **Testing**: ![Vitest](https://img.shields.io/badge/Vitest-Latest-729B1B?logo=vitest&logoColor=white)

### Key Project Files

- [`.claude-plugin/`](./.claude-plugin/): 🔌 Claude Code plugin configuration
- [`CLAUDE.md`](./CLAUDE.md): 🤖 Claude Code plugin context guide
- [`GEMINI.md`](./GEMINI.md): 🤖 Gemini CLI extension context guide with workflow instructions
- [`gemini-extension.json`](./gemini-extension.json): ⚙️ Gemini CLI extension configuration
- [`skills/`](./skills/): 🎯 Skill definitions and protocols
- [`src/languages/`](./src/languages/): 🔧 Language adapter implementations
- [`commands/`](./commands/): 📋 Command alias definitions
