# Project: `mcp-auditor` – MCP Server for Code Structure & Entrypoints

## 1. Overview

We want an **MCP server** (Model Context Protocol) that provides **structured code insights** to LLMs, focused initially on:

* Discovering **entrypoints** (public/external functions) in Solidity (and other languages later),
* Extracting **per-function summaries** (reads, writes, internal calls, external calls),
* Emitting results in **TOON** format.

This MCP server will be used from **Gemini CLI** as an extension, starting from the official TypeScript MCP server example (the one in `packages/cli/src/commands/extensions/examples/mcp-server`).

The design **must be**:

* **Modular**: clear separation of core engine, language adapters, and MCP protocol glue.
* **Extensible**: easy to add support for new languages and new analysis tools.
* **DRY & navigable**: no duplicated logic per language; common flow is shared.
* **Well-tested**: automated tests that validate tools on example code snippets.

---

## 2. Goals & Non-Goals

### 2.1 Goals

1. Provide a TypeScript MCP server that exposes at least two tools:

   * `entrypoints`: return external/public entrypoints for a set of files.
   * `function_insights`: return structural info (reads, writes, calls) for a given function.
2. Use **ast-grep** (`@ast-grep/napi`) as the primary parsing/AST engine.
3. Support **Solidity** as the primary target language in v1.
4. Output **TOON**-formatted responses for all tools.
5. Be straightforward to extend to other languages (TypeScript, JavaScript, etc.).
6. Include automated tests that verify:

   * Correct entrypoint detection on sample contracts,
   * Correct function insights on sample functions.

### 2.2 Non-Goals (v1)

* No full interprocedural dataflow analysis.
* No fully precise call graph across the whole project.
* No Slither/Semgrep integration in v1 (can be added later).
* No need to persist a project index across process restarts (in-memory only for now).

---

## 3. High-Level Architecture

### 3.1 Layers

1. **MCP Layer (Protocol & Tools)**

   * Handles MCP server startup and command routing.
   * Defines MCP tools: `entrypoints`, `function_insights`.
   * Handles request/response schemas and serialization to TOON.

2. **Engine Layer (Language-Agnostic Operations)**

   * Unified API for:

     * `analyzeEntrypoints(files, language)`
     * `analyzeFunction(files, language, functionSelector)`
   * Orchestrates parsing and querying via language adapters.

3. **Language Adapter Layer (Per-Language AST logic)**

   * Each supported language has an adapter implementing:

     * `extractEntrypoints(ast, filePath)`
     * `extractFunctionInsights(ast, filePath, selector)`
   * Language adapters rely on:

     * `@ast-grep/napi` for AST.
     * Optionally, additional language-specific parsers (e.g. `@solidity-parser/parser` for contract-level state declarations).

4. **Common Utilities**

   * TOON serialization helpers.
   * Error handling, logging.
   * Node location utilities (line/column mapping).

### 3.2 Modularity & Extensibility

* Add a new language by:

  * Creating a new adapter implementing a small interface (`LanguageAdapter`).
  * Registering it in a `languageRegistry`.
* Add a new tool by:

  * Implementing a new engine method (if needed),
  * Wiring it in the MCP tool handler.

No MCP tool should be hard-coded to Solidity. Each tool should accept a `language` parameter (with sensible defaults) and use the appropriate adapter.

---

## 4. Tools (MCP Interface)

All MCP tools will:

* Accept JSON arguments,
* Return TOON-formatted text as the main output.

### 4.1 Tool: `entrypoints`

**Purpose:**
List externally reachable entrypoints (functions) for a given set of files in a given language.

**Arguments (JSON):**

```json
{
  "files": [
    {
      "path": "contracts/Vault.sol",
      "content": "<file-content>"
    }
  ],
  "language": "solidity"
}
```

* `files`:

  * Array of objects with `path` (string) and `content` (string).
  * In v1, we can assume small to medium projects; no streaming is needed.
* `language`:

  * String; initial support `"solidity"`.
  * Should be easy to extend to `"typescript"`, `"javascript"`, etc.

**Behavior (Solidity v1):**

* Parse each file as Solidity.
* Identify functions that:

  * Are declared `public` or `external`,
  * Are not purely `view`/`pure` (unless otherwise specified by a flag later),
  * Belong to a contract.
* Extract:

  * `file`: file path.
  * `contract`: contract name.
  * `name`: function name.
  * `signature`: function name + parameter types/names (best effort).
  * `visibility`: `public` or `external`.
  * `location`: line & column of function declaration.

**Response (TOON):**

Example:

```toon
entrypoints[2]:
  - file: contracts/Vault.sol
    contract: Vault
    name: deposit
    signature: deposit(uint256 amount)
    visibility: external
    location:
      line: 42
      column: 2
  - file: contracts/Vault.sol
    contract: Vault
    name: withdraw
    signature: withdraw(uint256 amount)
    visibility: external
    location:
      line: 80
      column: 2
```

### 4.2 Tool: `function_insights`

**Purpose:**
Provide structural insights for a specific function: what it reads, writes, and calls.

**Arguments (JSON):**

```json
{
  "files": [
    {
      "path": "contracts/Vault.sol",
      "content": "<file-content>"
    }
  ],
  "language": "solidity",
  "selector": {
    "file": "contracts/Vault.sol",
    "contract": "Vault",
    "name": "withdraw",
    "signature": "withdraw(uint256 amount)"
  }
}
```

* `files`, `language`: same as `entrypoints`.
* `selector`:

  * Defines which function to analyze.
  * In v1, matching can be done by:

    * `file` + `contract` + `name` (signature may be used as an extra hint but not strictly required).
  * Future version can support more robust selectors (e.g. by position or fully qualified ID).

**Behavior (Solidity v1):**

1. Identify contract-level state vars:

   * Use a Solidity parser (e.g. `@solidity-parser/parser`) to find declarations like:

     * `uint256 totalSupply;`
     * `mapping(address => uint256) balances;`
   * Maintain a set of state variable names per contract.

2. For the target function:

   * Use ast-grep to:

     * Find all AST nodes for the function body.
     * Detect **writes**: assignments where left-hand side is a known state var, including array/mapping indexes.

       * Patterns like:

         * `$V = $EXPR;`
         * `$V += $EXPR;`
         * `$V -= $EXPR;`
         * `$V++`, `$V--`
         * `$V[$IDX] = $EXPR;`
     * Detect **reads**: any usage of state vars not identified as writes (best effort; can double-check via AST node types).
     * Detect **internal calls**:

       * Calls to functions within the same contract (e.g. `_updateRewards(...)`).
     * Detect **external calls**:

       * Calls to other contracts / tokens / low-level calls:

         * `.call`, `.delegatecall`, `.staticcall`
         * `.transfer`, `.send`, `.transferFrom`
         * `SomeContract(something).foo(...)`

3. Build a structural summary.

**Response (TOON):**

Example:

```toon
function:
  file: contracts/Vault.sol
  contract: Vault
  name: withdraw
  signature: withdraw(uint256 amount)
  visibility: external
  location:
    line: 80
    column: 2
  state:
    reads[2]:
      - balances[msg.sender]
      - totalSupply
    writes[1]:
      - balances[msg.sender]
  calls:
    internal[1]:
      - _updateRewards
    external[2]:
      - token.transfer(msg.sender, amount)
      - priceOracle.getPrice()
```

If the function cannot be found, return a TOON error payload:

```toon
error:
  type: function_not_found
  message: "Could not find function withdraw in contract Vault in file contracts/Vault.sol"
```

---

## 5. Implementation Details

### 5.1 Tech Stack

* **Language:** TypeScript
* **Runtime:** Node.js (version compatible with Gemini CLI requirements)
* **MCP base:** Copy the structure from the Gemini CLI MCP server TypeScript example.
* **Core dependencies:**

  * `@ast-grep/napi` for AST parsing & pattern queries.
  * `@solidity-parser/parser` (or similar) for Solidity contract-level state declarations.
  * Test framework: Jest or Vitest (preference: pick one and be consistent).
  * Type-checking: `tsc`.

### 5.2 Project Structure (Suggested)

```text
src/
  mcp/
    server.ts           # MCP server startup, tool registration
    tools/
      entrypoints.ts    # Tool implementation for entrypoints
      functionInsights.ts
  engine/
    index.ts            # Engine APIs used by tools
    languageRegistry.ts # Maps language -> adapter
  languages/
    solidityAdapter.ts  # Solidity-specific AST logic
    typescriptAdapter.ts (stub)
    javascriptAdapter.ts (stub)
  util/
    toon.ts             # Helpers to emit TOON
    positions.ts        # Line/column helpers
tests/
  fixtures/
    solidity/
      SimpleVault.sol
      ...
  unit/
    entrypoints.test.ts
    functionInsights.test.ts
```

Keep files small and focused. No large “god files”.

---

## 6. Language Adapters

### 6.1 LanguageAdapter Interface (Conceptual)

Define a TypeScript interface, something like:

```ts
interface LanguageAdapter {
  languageId: string; // e.g. "solidity"

  extractEntrypoints(
    files: { path: string; content: string }[]
  ): Entrypoint[];

  extractFunctionInsights(
    files: { path: string; content: string }[],
    selector: FunctionSelector
  ): FunctionInsights;
}
```

* `Entrypoint` and `FunctionInsights` are TS interfaces reflecting the structures used in TOON output.

### 6.2 Solidity Adapter (v1 focus)

Responsibilities:

* Parse Solidity files with `@ast-grep/napi` and `@solidity-parser/parser`.
* Implement:

  * `extractEntrypoints` as per Section 4.1.
  * `extractFunctionInsights` as per Section 4.2.

Implementation notes:

* Use ast-grep patterns to find function declarations and bodies.
* Use Solidity parser to extract contract names and state variable declarations.
* Keep heuristics simple but robust; err on side of including more reads/writes rather than missing them.

### 6.3 Future Language Adapters

Leave stubs for:

* TypeScript adapter,
* JavaScript adapter.

These can initially throw a clear error like:

```toon
error:
  type: language_not_supported
  message: "Language typescript is not yet supported"
```

but must be placed in a way that adding support is straightforward.

---

## 7. TOON Output

All tool responses must be valid **TOON** as per [https://github.com/toon-format/toon](https://github.com/toon-format/toon).

General guidelines:

* Use clear, descriptive keys (`entrypoints`, `function`, `state`, `calls`, `error`, etc.).
* Avoid excessive nesting where unnecessary.
* Maintain a consistent schema across tools so the LLM can learn patterns.

Example schema slices were shown above in each tool’s section.

---

## 8. Testing Requirements

### 8.1 Test Framework

* Use Jest or Vitest (pick one).
* Tests should be runnable via `npm test` or `pnpm test`.

### 8.2 Test Coverage (minimum)

1. **Solidity entrypoints:**

   * Given a sample contract file that contains:

     * A mix of `public`, `external`, `internal`, `private` functions,
     * Functions with modifiers (`view`, `pure`, `payable`, etc.).
   * Verify:

     * Only `public`/`external` functions are included as entrypoints.
     * `view`/`pure` entrypoints are included/excluded based on the defined logic (document behavior in tests).
     * Correct contract and function names.
     * Correct basic signature construction.

2. **Solidity function insights:**

   * Given a sample contract with:

     * Simple state vars (e.g. `totalSupply`, `balances`),
     * Functions that:

       * read and write these vars,
       * call internal helper functions,
       * call external contracts/tokens.
   * Verify:

     * `state.reads` and `state.writes` include the expected variables.
     * `calls.internal` lists internal helper functions.
     * `calls.external` lists external calls.
     * Location information is present.

3. **Error handling:**

   * Requesting `function_insights` for a non-existing function should produce a TOON `error` object with `type: function_not_found`.
   * Requesting a language that is not supported should produce a TOON `error` with `type: language_not_supported`.

### 8.3 DRYness & Code Quality

* Ensure minimal duplicated logic:

  * Shared utilities for TOON emission,
  * Shared AST helpers per language adapter.
* Add at least one test that verifies **TOON format** superficially:

  * E.g. responses match expected snapshots or structure.

---

## 9. Operational & Developer Notes

* The MCP server should:

  * Log errors in a concise way (e.g. console error logs) without leaking excessive internal details.
  * Handle invalid input gracefully and return TOON `error` payloads.
* Keep dependency list minimal.
* README / docs (at least minimal):

  * How to run the MCP server locally.
  * How to run tests.
  * How to register the extension with Gemini CLI.
  * Brief explanation of each tool (`entrypoints`, `function_insights`).

---

## 10. Future Extensions (Nice-to-Haves, Not v1 Requirements)

These should **not** block v1, but the architecture should not make them difficult:

* Add a `callgraph` tool that uses repeated ast-grep queries to build a lightweight intra-contract callgraph.
* Add language adapters for TypeScript/JavaScript:

  * Identify exported functions,
  * Identify external calls (HTTP, DB, etc.).
* Add a “project index” tool for caching analysis across multiple calls:

  * e.g. `index_project` returning a `projectId` keyed in memory.
* Integrate with Slither via a separate MCP server for deep Solidity analysis.

---

**Deliverable:**
A TypeScript MCP server project, starting from the Gemini CLI MCP server example, implementing the above tools and structure, with tests and TOON output as specified.
