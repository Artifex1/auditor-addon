<div align="center">

<img src="./logo.svg" alt="Auditor Addon Logo" width="400">

### *The LLM Multi Tool for Code Auditing*

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Zig](https://img.shields.io/badge/Zig-0.15+-F7A41D?logo=zig&logoColor=white)](https://ziglang.org/)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Plugin-6B48FF?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-Extension-4285F4?logo=google&logoColor=white)](https://github.com/google-gemini/gemini-cli)
[![Cursor](https://img.shields.io/badge/Cursor-Compatible-000000?logo=cursor&logoColor=white)](https://cursor.sh)
[![Windsurf](https://img.shields.io/badge/Windsurf-Compatible-0B100F?logo=windsurf&logoColor=white)](https://codeium.com/windsurf)
[![Codex](https://img.shields.io/badge/OpenAI_Codex-Compatible-412991?logo=openai&logoColor=white)](https://openai.com/codex)

**Skills and a CLI for code estimation, security auditing, and professional report writing. Works with any AI coding environment.**

</div>

## 🎯 Skills

Skills are structured workflows that guide the AI through multi-step processes. Each skill contains detailed instructions, phases, and best practices for specific tasks.

| Skill | Purpose | Capabilities |
|:------|:--------|:-------------|
| 🛡️ **security-auditor** | Interactive security auditing with Map & Probe methodology | Map (structural inventory) → Checklist (optional, standard-specific) → Probe (per-path vulnerability analysis) |
| 🔍 **threat-modeling** | Systematic threat enumeration before code-level auditing | Analyze → Diagram → Attackers → Assets → Threats (STRIDE) → Report |
| 📊 **estimator** | Project scoping and effort estimation | Full scope (Discovery, Explore, Metrics, Report) or Diff scope (Discovery, Review, Report) |
| 🧠 **design-challenger** | Challenge overcomplicated designs | Propose simplifications with explicit trade-offs |
| 📝 **scribe** | Report writing and finding generation | Professional issue descriptions, report introductions |
| 🔬 **sast-pipeline** | Run the SAiST static analysis pipeline | Init scan → Resolve gaps → Run rules (shipped + custom) |
| ✏️ **rule-authoring** | Author SAiST detection rules | Scope, deep, and map rule types with testing patterns |

### How Skills Work

Skills provide complete workflows that the AI follows autonomously. When invoked, the AI loads the skill's protocol and executes it step-by-step, using the available tools as needed. Each skill can be invoked through its respective slash command (e.g., `/security-auditor`, `/estimator`).

> [!NOTE]
> **Model Performance**: Skills perform differently across AI models. Depending on your needs, you may want to adjust the model for optimal results:
> 
> - **Speed**: Lighter models (e.g., Claude Haiku, Gemini Flash) execute faster but may miss subtle issues
> - **Reasoning Effort**: More capable models (e.g., Claude Sonnet/Opus, Gemini Pro) provide deeper analysis and better edge case detection
> - **Thoroughness**: Higher-tier models tend to be more comprehensive in their exploration and validation
> - **Verbosity**: Models with higher reasoning capabilities can be less verbose in their thinking process
>
> Experiment with different models to find the right balance for your use case.

---

## 🧰 CLI Tools

The `aud` CLI provides structured code analysis through tree-sitter AST parsing. All commands support glob patterns for analyzing multiple files at once (e.g., `"src/**/*.sol"`). Skills invoke these commands automatically as part of their workflows. Output uses TOON by default; pass `--json` for JSON.

### 👀 `aud peek`

Extracts function and method signatures from source files without reading full implementations. The **estimator** skill uses peek to quickly understand a codebase's API surface, what functions exist, their parameters, visibility, and modifiers. This is ideal for initial exploration and building a mental map of unfamiliar code, without the need to read full files.

### 📏 `aud metrics`

Calculates code metrics:

- **Normalized Lines of Code (nLOC)**: Total lines minus blank lines, comment-only lines, and multi-line constructs normalized to single lines (e.g., a function signature spanning 3 lines counts as 1).
- **Comment Density**: Percentage of lines that have/are comments, indicating documentation coverage.
- **Cognitive Complexity**: Measures control flow complexity by counting branches (if, for, while, etc.) weighted by nesting depth. Deeply nested logic scores higher than flat code.
- **Estimated Hours**: Review time estimate based on nLOC and a per-language base rate.

The **estimator** skill uses this command to calculate how long it takes to perform a security audit.

### 🔗 `aud gaps`

Builds a symbol graph (containers, callables, variables, events, modifiers, edges) from source files and outputs unresolved **edge gaps** — references the static pass cannot resolve (unresolved callees, interface dispatch, external libraries). Gaps are prioritized by edge kind (high/medium/low) for agent triage.

Supports `--resolutions=<file>` to apply a CSV of manually resolved gaps, promoting them to concrete edges.

### ⛓️ `aud call-chains`

Traces call chains from root functions (callables with no incoming call edges) through the full call graph, grouped by root and sorted longest-first. The **security-auditor** skill uses this to understand how execution flows through a system and to identify attack surfaces.

Supports `--root=<name>` to start from specific functions, and `--max-depth=<n>` to limit traversal depth.

### 📊 `aud graph`

Builds and dumps the full symbol graph — all nodes (files, containers, callables, variables, modifiers, events) and edges (contains, calls, reads, writes, has_modifier, inherits, emits, imports). Useful for inspecting the graph structure directly.

### 🔬 `aud run` — Rules Engine

Builds the symbol graph and runs Lua-based detection rules against it. Rules are either shipped (built-in) or custom (`.lua` files).

- `--rule=<ID>` — run specific shipped rule(s) only
- `--rule-path=<path>` — run an adhoc rule from a `.lua` file
- `--rule-inline=<lua>` — run an adhoc rule from an inline Lua string

Findings include rule metadata, confidence, location, and optional execution paths for deep rules. Supports filtering by confidence level (issue, smell, pointer).

### ℹ️ `aud info`

Lists language config details (container types, callable types, variable types, visibility extraction, builtin filters, metrics config). Useful for understanding what the parser sees for a given language.

### 🌐 Supported Languages

<div align="center">

Solidity · Rust · Go · Python · Cairo · Compact · Move · Noir · Tolk · Masm · C++ · Java · JavaScript · TypeScript · TSX · Flow

</div>

## 📦 Installation

### Via Claude Code Plugin

```bash
# 1. Start Claude Code
claude

# 2. Go to plugins
/plugin

# 3. Navigate to Marketplaces tab
# 4. <enter> on "+ Add Marketplace"
# 5. Paste this repo's link, <enter>
# 6. Hit <space> and <i>
```

### Via Gemini CLI Extension

```bash
gemini extensions install https://github.com/Artifex1/auditor-addon
```

### Other AI Coding Environments (Cursor, Codex, Windsurf, etc.)

Skills can be installed using the [skills CLI](https://skills.sh/). This includes the `aud` CLI — pre-built binaries for all platforms are shipped with the `auditor-addon-cli` skill:

```bash
npx skills add Artifex1/auditor-addon
```

The AI can invoke `aud` directly via the skill path. For manual use, see the `auditor-addon-cli` skill's SKILL.md for instructions on adding `aud` to your PATH.

### Building from Source

Requires [Zig 0.15+](https://ziglang.org/download/).

```bash
# Clone the repository
git clone <repository-url>
cd auditor-addon

# Native build
zig build

# Run tests
zig build test

# Cross-compile all platforms (macOS/Linux/Windows × arm64/x86_64)
./scripts/build-all.sh --release
```

---

## 🏗️ Architecture & Design

### Core Principles

- 🧩 Modular: Clear separation between CLI, pipeline, language configs, and output
- 🔌 Extensible: Add new languages via declarative `LanguageConfig` structs
- ⚡ Fast: Single Zig binary, zero runtime dependencies, tree-sitter grammars compiled in
- 🔬 Rules in Lua: Detection rules are authored in Lua, loaded at runtime

### Technology Stack

- **Language**: ![Zig](https://img.shields.io/badge/Zig-0.15+-F7A41D?logo=zig&logoColor=white) — single binary, cross-compiles to all platforms
- **AST Engine**: [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) — grammars compiled into the binary
- **Rules Engine**: [Lua](https://www.lua.org/) — embedded via ziglua
- **Output Format**: [TOON](https://github.com/toon-format/toon) — Token-Oriented Object Notation (or JSON)
- **CLI Parsing**: [zig-clap](https://github.com/Hejsil/zig-clap)

### Key Project Files

- [`.claude-plugin/`](./.claude-plugin/): 🔌 Claude Code plugin configuration
- [`CLAUDE.md`](./CLAUDE.md): 🤖 Claude Code plugin context guide
- [`GEMINI.md`](./GEMINI.md): 🤖 Gemini CLI extension context guide
- [`gemini-extension.json`](./gemini-extension.json): ⚙️ Gemini CLI extension configuration
- [`skills/`](./skills/): 🎯 Skill definitions and protocols
- [`commands/`](./commands/): 📋 Command alias definitions for Gemini CLI
- [`src/`](./src/): 🔧 Zig source (pipeline, language configs, output, CLI)
- [`vendor/grammars/`](./vendor/grammars/): 🌳 Tree-sitter grammar sources
- [`skills/auditor-addon-cli/bin/`](./skills/auditor-addon-cli/bin/): 📦 Pre-built binaries + platform dispatcher
- [`SPEC.md`](./SPEC.md): 📐 Symbol graph and pipeline specification
- [`SPEC-CLI.md`](./SPEC-CLI.md): 📐 CLI commands specification
