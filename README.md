<div align="center">

<img src="./logo.svg" alt="MCP Auditor Logo" width="400">

### *The LLM Multi Tool for Code Auditing*

[![MCP](https://img.shields.io/badge/MCP-Compatible-blue?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgMkw0IDZWMTJDNCAxNi40MiA3LjU4IDIwIDEyIDIyQzE2LjQyIDIwIDIwIDE2LjQyIDIwIDEyVjZMMTIgMloiIGZpbGw9IndoaXRlIi8+PC9zdmc+)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**A powerful Model Context Protocol (MCP) server that provides structured code insights for estimation, security auditing, and professional report writing.**

</div>


## ✨ Features at a Glance

<table>
<tr>
<td width="33%" align="center">

### 📊 **Estimation**
Calculate code complexity metrics and estimate audit effort with precision

</td>
<td width="33%" align="center">

### 🛡️ **Auditing**
Map systems, identify security hotspots, and confirm vulnerabilities

</td>
<td width="33%" align="center">

### 📝 **Writing**
Generate professional audit reports in OpenZeppelin style

</td>
</tr>
</table>

### 🧠 **Design Challenge**
Challenge overcomplicated designs and propose simpler alternatives with explicit trade-offs

## 🌐 Supported Languages

<div align="center">

| Language | Peek | Execution Paths | Metrics | Status |
|:--------:|:-----------:|:-----------:|:-------:|:------:|
| 🔷 **Solidity** | ✅ | ✅ | ✅ | **Full Support** |
| 🐪 **Cairo** | ✅ | ⏳ | ✅ | Partial |
| 📦 **Compact** | ✅ | ⏳ | ✅ | Partial |
| 💧 **Move** | ✅ | ⏳ | ✅ | Partial |
| 🌑 **Noir** | ✅ | ⏳ | ✅ | Partial |
| 🧩 **Tolk** | ✅ | ⏳ | ✅ | Partial |
| ⚡ **C++** | ✅ | ⏳ | ✅ | Partial |
| ☕ **Java** | ✅ | ⏳ | ✅ | Partial |
| 🐹 **Go** | ✅ | ⏳ | ✅ | Partial |
| 🦀 **Rust** | ✅ | ⏳ | ✅ | Partial |
| 🟨 **JavaScript** | ✅ | ⏳ | ✅ | Partial |
| 🔷 **TypeScript** | ✅ | ⏳ | ✅ | Partial |
| 🧩 **TSX** | ✅ | ⏳ | ✅ | Partial |
| 🌀 **Flow** | ✅ | ⏳ | ✅ | Partial |

</div>

## 📦 Installation

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

## 🧰 Available Tools

> [!TIP]
> All tools support **glob patterns** for the `paths` parameter, making it easy to analyze multiple files at once!

<table>
<thead>
<tr>
<th width="15%">Tool</th>
<th width="20%">Inputs</th>
<th width="20%">Output</th>
<th width="45%">Purpose</th>
</tr>
</thead>
<tbody>
<tr>
<tr>
<td><code>peek</code></td>
<td><code>paths</code> (string[])</td>
<td><code>Signature[]</code></td>
<td>👀 Extract function signatures for a quick codebase overview</td>
</tr>
<tr>
<td><code>metrics</code></td>
<td><code>paths</code> (string[])</td>
<td><code>Metrics[]</code></td>
<td>📏 Calculate NLoC, complexity, and effort estimates</td>
</tr>
<tr>
<td><code>execution_paths</code></td>
<td><code>paths</code> (string[])</td>
<td><code>string[]</code></td>
<td>🕸️ Generate linear execution call chains from public entrypoints</td>
</tr>
</tbody>
</table>

---

## 🔄 Command Workflows

The `commands/` directory contains **TOML-based systematic prompts** for structured analysis:

### 1️⃣ Estimation Workflow

```
/estimate:discovery  → Identify scope and chunk files
/estimate:explore    → Categorize files and refine scope
/estimate:metrics    → Calculate complexity and effort
/estimate:report     → Generate final estimation report
```

**Perfect for:** Project scoping, effort estimation, resource planning

### 2️⃣ Audit Workflow

```
/audit:map     → Build system map (contracts, invariants, flows)
/audit:hunt    → Identify security hotspots (high recall)
/audit:attack  → Confirm vulnerabilities (high precision)
```

**Perfect for:** Security audits, vulnerability assessment, threat modeling

### 3️⃣ Design Challenge Workflow

```
/design:challenge  → Challenge design and propose simplifications
```

**Perfect for:** Overcomplication review, protocol simplification, design trade-offs

### 4️⃣ Writing Workflow

```
/write:intro   → Generate professional report introduction
/write:issue   → Write formal vulnerability descriptions
```

**Perfect for:** Audit reports, security documentation, issue tracking

> [!IMPORTANT]
> See [`GEMINI.md`](./GEMINI.md) for detailed workflow instructions, best practices, and examples.

---

## 🏗️ Architecture & Design

### Core Principles

- 🧩 Modular: Clear separation between MCP protocol, engine, and language adapters
- 🔌 Extensible: Easy to add new languages via `BaseAdapter` inheritance
- 🔄 DRY: Common logic shared via `BaseAdapter` class
- ✅ Tested: Automated tests for all language adapters

### Technology Stack

- **Runtime**: ![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)
- **AST Engine**: [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) - Fast, incremental parsing for various languages
- **Output Format**: [TOON](https://github.com/toon-format/toon) - Token-Oriented Object Notation
- **Protocol**: [MCP](https://modelcontextprotocol.io) - Model Context Protocol
- **Testing**: ![Vitest](https://img.shields.io/badge/Vitest-Latest-729B1B?logo=vitest&logoColor=white)

### Key Project Files

- [`GEMINI.md`](./GEMINI.md): 🤖 AI assistant context guide with workflow instructions
- [`gemini-extension.json`](./gemini-extension.json): ⚙️ Gemini CLI extension configuration
- [`src/languages/`](./src/languages/): 🔧 Language adapter implementations
- [`commands/`](./commands/): 📋 TOML workflow prompts

---
