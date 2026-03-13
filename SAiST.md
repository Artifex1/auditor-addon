# SAiST — Static AI-assisted Security Testing

## Execution Plan (Revised v2)

---

## 1. Vision & Big Picture Loop

SAiST is a static analysis engine combining deterministic tree-sitter rule evaluation with best-effort static symbol resolution, and optionally AI-assisted gap filling. It lives in `auditor-addon` as a pure library consumed by MCP tool endpoints, a future CLI wrapper, and the deep scan harness.

### The Continuous Improvement Loop

```
Audit Session
  └── Deep scan / manual audit confirms novel vulnerability
        └── Auditor judgment: "is this structurally expressible?"
              ├── YES → Rule Synthesis (via SAiST skill)
              │          └── New rule added to rules/solidity/ or rules/shared/
              │          └── Or: custom rule authored locally, migrated later
              │                └── Test fixture added from vulnerable contract
              │                      └── SAiST catches it on every future audit
              └── NO  → Document as agent-only pattern (future tooling)
```

Custom rules authored during an audit live as standalone `.ts` files — in a dedicated repo, a user folder, or alongside the audited codebase. They are loaded at scan time via file paths, run identically to shipped rules, and can graduate into the main `rules/` tree once validated. This keeps the feedback loop tight: a novel finding becomes a machine-checkable rule within the same audit session.

### Future Evolution: Data Flow Layer

The current rule model operates on control flow (PathRules walking AST node sequences) and symbol-level facts (SymbolEntry metadata). A natural next step is a proper data flow graph with taint propagation — tracking how user-controlled inputs reach state writes or external calls through assignments and function boundaries. The `SymbolEntry` fields `readsState` and `writesState` are the seed data for this layer. The `isBuiltinContextValue` trait method (§6) captures caller/environment classification without full taint tracking, providing a stepping stone. Full data flow analysis is deferred — it requires solid type resolution across languages, which conflicts with the 80:20 philosophy.

### Two Execution Modes

**MCP mode (primary):** Claude Code agent drives the flow. `sast_init_scan` returns the gap list. The agent — already in the loop — reads the gaps, consults source files, fills in resolutions manually or with human input, and calls `sast_run_rules` with the enriched map. No internal agent spawning. No sub-processes.

**CLI mode (future):** End-to-end run requiring an external agent adapter (Claude Code or Gemini CLI) to close gaps autonomously. The internal library interface is identical — only the gap-closing orchestration differs. A `ModelAdapter` abstraction handles both CLI runtimes.

---

## 2. Repository Structure

```
auditor-addon/
├── src/
│   ├── languages/              # existing tree-sitter adapters
│   │   ├── base.ts
│   │   ├── solidity.ts
│   │   ├── rust.ts
│   │   ├── cairo.ts
│   │   └── ...
│   └── static/                 # SAiST engine — pure library
│       ├── engine.ts            # orchestrates full scan pipeline
│       ├── symbol-table.ts      # SymbolMap, SymbolGap, gap emission
│       ├── resolver.ts          # best-effort static 80:20 resolver
│       ├── walker.ts            # cross-function path walker
│       ├── persistence.ts       # /tmp scan state serialization
│       ├── rule-loader.ts       # loads shipped + custom rules, validates exports
│       ├── traits/
│       │   ├── trait.ts         # LanguageTrait interface
│       │   ├── solidity.ts      # Solidity trait
│       │   ├── rust.ts          # Rust trait (framework-aware: anchor, cosmwasm, substrate, near)
│       │   ├── cairo.ts         # Cairo trait (framework-aware: starknet)
│       │   ├── move.ts
│       │   └── ...
│       └── rules/
│           ├── rule.ts          # Rule types and interfaces
│           ├── shared/          # trait-parameterized cross-language rules
│           │   ├── state-write-after-call.ts
│           │   ├── missing-access-control.ts
│           │   └── unchecked-return.ts
│           └── solidity/        # Solidity-specific rules
│               ├── reentrancy.ts
│               ├── storage-collision.ts
│               └── price-manipulation.ts
├── skills/
│   └── saist.md                 # SAiST skill: MCP flow, gap resolution prompts,
│                                #   rule synthesis + custom rule authoring conventions
├── commands/
└── cli.ts                       # future thin CLI wrapper
```

---

## 3. Type Definitions

All string-literal fields use discriminated union types. No raw strings for status, severity, confidence, or resolution provenance.

```typescript
// languages.ts — extend existing SupportedLanguage
export type SupportedLanguage =
  | 'solidity' | 'cairo' | 'compact' | 'move' | 'noir'
  | 'tolk' | 'masm'                                         // on-chain
  | 'rust' | 'cpp' | 'java' | 'go'                          // context-dependent
  | 'typescript' | 'javascript' | 'tsx' | 'flow' | 'python' // off-chain (default)

export type LanguageDomain = 'on-chain' | 'off-chain'
export type InheritanceModel = 'classical' | 'trait-based' | 'none'

// Baseline metadata — these are DEFAULTS, overridable at scan time via ScanContext.
// Rust defaults to off-chain but becomes on-chain when framework is 'anchor', 'cosmwasm', etc.
export const LANGUAGE_META: Record<SupportedLanguage, {
  domain: LanguageDomain
  inheritanceModel: InheritanceModel
}> = {
  solidity:   { domain: 'on-chain',  inheritanceModel: 'classical'    },
  cairo:      { domain: 'on-chain',  inheritanceModel: 'trait-based'  },
  compact:    { domain: 'on-chain',  inheritanceModel: 'none'         },
  move:       { domain: 'on-chain',  inheritanceModel: 'none'         },
  noir:       { domain: 'on-chain',  inheritanceModel: 'none'         },
  tolk:       { domain: 'on-chain',  inheritanceModel: 'none'         },
  masm:       { domain: 'on-chain',  inheritanceModel: 'none'         },
  rust:       { domain: 'off-chain', inheritanceModel: 'trait-based'  },
  cpp:        { domain: 'off-chain', inheritanceModel: 'classical'    },
  java:       { domain: 'off-chain', inheritanceModel: 'classical'    },
  go:         { domain: 'off-chain', inheritanceModel: 'none'         },
  typescript: { domain: 'off-chain', inheritanceModel: 'classical'    },
  javascript: { domain: 'off-chain', inheritanceModel: 'classical'    },
  tsx:        { domain: 'off-chain', inheritanceModel: 'classical'    },
  flow:       { domain: 'off-chain', inheritanceModel: 'classical'    },
  python:     { domain: 'off-chain', inheritanceModel: 'classical'    },
}

// Known frameworks that override language defaults or activate
// domain-specific pattern recognition in traits.
// Not exhaustive — new frameworks can be added without engine changes.
export type KnownFramework =
  // Rust on-chain
  | 'anchor' | 'solana-native' | 'cosmwasm' | 'substrate' | 'ink' | 'near'
  // Cairo on-chain
  | 'starknet'
  // Python on-chain (e.g. Vyper tooling, or Starknet via Python SDK)
  | 'ape' | 'brownie'
  // General — trait implementations can accept any string,
  // KnownFramework is for documentation and autocomplete only.
  | (string & {})

// Resolution provenance
export type ResolvedBy = 'static' | 'agent' | 'manual'
export type Confidence  = 'high' | 'medium' | 'low'
export type ScanStatus  = 'pending' | 'needs_resolution' | 'ready' | 'complete'
export type Severity    = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type GapType     =
  | 'unresolved_callee'
  | 'interface_impl'
  | 'inherited_fn'
  | 'external_library'
  | 'dynamic_dispatch'
  | 'unknown_state_write'
export type GapPriority = 'high' | 'medium' | 'low'
export type CallTargetKind =
  | 'internal'            // same compilation unit, statically resolved
  | 'cross_module'        // different module/contract/package, source available
  | 'interface_dispatch'  // resolved to interface/trait, implementation unknown
  | 'external_unknown'    // cannot determine target
export type RuleSource = 'shipped' | 'custom'
```

---

## 4. Data Model

### 4.1 Symbol Table

The symbol table is a flat map keyed by qualified name. Language-specific concerns — inheritance resolution, trait impl lookup, module resolution, extension methods — are handled upstream by traits and the static resolver, then stored as plain facts here. The table never contains language-specific logic.

```typescript
interface CalleeEntry {
  qualifiedName: string
  targetKind: CallTargetKind
}

interface SymbolEntry {
  // Identity
  qualifiedName: string         // e.g. "VaultCore.withdraw", "pool::flash_loan"
  file: string
  line: number
  language: SupportedLanguage

  // Security-relevant facts
  writesState: string[]         // names of state variables written
  readsState: string[]          // names of state variables read
  callsExternal: boolean        // convenience: true if any callee has targetKind !== 'internal'
  callees: CalleeEntry[]        // direct callees with resolution metadata
  isPublic: boolean
  hasAccessControl: boolean
  modifiers: ModifierInfo[]     // see §6 for ModifierInfo definition

  // Resolution provenance
  // resolvedBy answers: "how did we learn these facts?"
  // 'static'  — tree-sitter + static resolver found this with confidence
  // 'agent'   — Claude Code agent filled this in during MCP gap resolution
  // 'manual'  — human explicitly provided or corrected this entry
  // Findings that depend on 'agent' or 'manual' entries are flagged in output
  // so the reviewer knows which facts were AI-inferred vs statically proven.
  resolvedBy: ResolvedBy
  confidence: Confidence
}

type SymbolMap = Map<string, SymbolEntry>
```

### 4.2 Symbol Gaps

Gaps are emitted by the static pass when a symbol cannot be resolved. They are structured tasks — not vague file references — so the Claude Code agent can address them precisely.

```typescript
interface SymbolGap {
  id: string                    // stable hash: qualifiedName + callSite
  type: GapType
  qualifiedName: string
  callSite: {
    file: string
    line: number
    col: number
  }
  codeSnippet: string           // ~5 lines of surrounding context
  relevantFiles: string[]       // derived from import analysis — where answer likely lives

  // Priority: how much does resolving this gap affect rule coverage?
  // 'high'   — this symbol appears on a hot-path call chain
  //            (reuses call_chains hotspot logic, see §4.3)
  // 'medium' — called from a public function but not a hotspot
  // 'low'    — called only from internal/private non-hotspot functions
  priority: GapPriority
}
```

### 4.3 Hotspot Priority — Reusing call_chains Logic

Gap priority is derived from call chain hotspot data. Rather than reimplementing hotspot detection, the existing `call_chains` tool logic is extracted into a shared function in `src/static/` and called by both:

- `call_chains` MCP tool (existing behavior unchanged, now delegates to shared fn)
- `sast_init_scan` (uses hotspot list to assign gap priorities)

```typescript
// src/static/hotspots.ts — shared, called by both tools
export function computeHotspots(
  callGraph: CallGraph,
  topN = 20
): string[] { ... }
```

A gap is `high` priority if its call site is inside a function that appears in the hotspot list.

### 4.4 Scan Context

Scan context allows callers to override language defaults and provide framework hints that affect trait behavior and rule applicability.

```typescript
interface ScanContext {
  // Override the default domain for specific languages in this scan.
  // e.g. { rust: 'on-chain' } when scanning an Anchor program.
  domainOverrides?: Partial<Record<SupportedLanguage, LanguageDomain>>

  // Framework hint — affects which rules are applicable and how traits behave.
  // e.g. 'anchor' activates CPI recognition, account constraint parsing,
  // signer check detection in the Rust trait.
  framework?: string
}

// Resolved at scan init time by merging LANGUAGE_META with ScanContext overrides.
interface EffectiveLanguageMeta {
  domain: LanguageDomain
  inheritanceModel: InheritanceModel
  framework?: string
}
```

### 4.5 Scan State Persistence

Scan state is persisted to `/tmp/saist-{scanId}.json` after each tool call. This allows the three MCP tools to share state across separate invocations without holding anything in memory between calls.

```typescript
interface ScanState {
  scanId: string                    // uuid, stable for the lifetime of a scan
  files: string[]
  languages: SupportedLanguage[]    // multilingual: one scan can cover multiple languages
  context: ScanContext              // preserved for rule filtering
  effective: Map<SupportedLanguage, EffectiveLanguageMeta>
  symbolMap: SymbolMap
  gaps: SymbolGap[]
  status: ScanStatus
  findings: RuleFinding[]
  createdAt: string
  updatedAt: string
}

// persistence.ts
export const writeScanState  = (state: ScanState): void   => { /* /tmp/saist-{id}.json */ }
export const readScanState   = (scanId: string): ScanState => { /* read + parse */ }
export const deleteScanState = (scanId: string): void      => { /* cleanup */ }
```

---

## 5. Static Resolver (Best-Effort 80:20)

The static resolver runs before any AI involvement. It resolves what it can from the AST and import graph alone. Anything it cannot resolve with confidence is emitted as a `SymbolGap` — not silently skipped.

**What it resolves (the 80%):**
- Direct function calls within the same file
- Calls to explicitly imported contracts/modules where source is in scope
- Extension method calls where the library/trait is in scope and the receiver type is statically determinable (see §5.1)
- Inherited functions via language-appropriate linearization (see §5.2)
- Trait implementations where impl is in the same compilation unit (Rust/Cairo)
- Library calls where the library source is available
- `super.foo()` resolution via the linearized inheritance chain (see §5.2)

**What it intentionally skips (the 20% → gaps):**
- Dynamic dispatch: `stateArray[i].iface.fn()` — type chain too deep to resolve statically
- Overloaded functions where argument types are ambiguous without full type inference
- Cross-repo or node_modules imports not present in the file set
- Interface calls where no implementation is in scope
- Anything requiring runtime type information
- Framework-specific patterns where library source is unavailable (e.g. Anchor's `anchor_lang::*` not in file set)

The resolver does not attempt heroic type resolution. The complexity cost is not worth the marginal coverage gain — that's what the gap list is for.

### 5.1 Extension Method Resolution

Many languages allow functions to be called on a type despite being defined outside that type's declaration scope. The generalizable concept is: **a function callable on a type but defined elsewhere.**

| Language    | Mechanism                          | Resolution strategy                       |
|-------------|------------------------------------|-----------------------------------------|
| Solidity    | `using SafeMath for uint256`       | Walk `using` directives in scope chain   |
| Rust        | `impl MyTrait for SomeType`        | Match impl blocks in compilation unit    |
| Cairo       | `impl MyTrait of SomeType`         | Same as Rust                             |
| Go          | Methods on types in same package   | Match receiver type to method defs       |
| C++         | ADL / friend functions             | Namespace-scoped lookup                  |
| Java        | Static utility methods             | Recognize common patterns (first-arg)    |
| TypeScript  | Module augmentations / prototype   | Best-effort, mostly gaps                 |
| Python      | Mixins                             | Best-effort via MRO, mostly gaps         |
| Move        | `fun borrow(self: &Coin)`          | Match self-parameter type                |

Languages where this doesn't apply (Noir, Tolk, Compact, Masm, Flow) simply return `null` from the trait method, and no gap is emitted — the call resolves through normal scoping or falls through to a gap for other reasons.

### 5.2 Inheritance Resolution and Linearization

For languages with classical inheritance, the resolver needs a linearization algorithm to walk the ancestor chain correctly. The specific algorithm varies by language:

- **Solidity**: C3 linearization. Required for correct `super.foo()` resolution and overridden function lookup. Diamond inheritance is common in Solidity via OpenZeppelin patterns.
- **Python**: C3 linearization (MRO). Same algorithm, critical for multiple inheritance.
- **C++ / Java / TypeScript**: Simpler models — Java has single class inheritance + interfaces, C++ uses its own linearization for virtual dispatch. TypeScript has prototype chains.

The trait method `resolveScope` returns the ordered ancestor list, and the algorithm it uses internally is a language implementation detail. The resolver walks the returned list and takes the first match.

For `super.foo()` specifically: resolution must start at index 1 (skipping self) in the linearized chain. Getting this wrong for diamond inheritance produces incorrect resolution, not just missing resolution.

### 5.3 Solidity-Specific Caveats

Full type resolution in Solidity is genuinely hard. A call like:

```solidity
stateArray[funcInput].iface.functionCall(foo, bar)
```

...requires knowing that `stateArray` is a state var, its element type is a struct, the struct has a field of interface type, and which contract in scope implements that interface. This is a compiler-level problem. The static resolver does not attempt it — it emits an `unresolved_callee` gap with the surrounding snippet, marks priority based on call chain position, and moves on.

**What Solidity trait DOES handle:**
- C3-linearized inheritance walk for unqualified calls (`foo()` → walk ancestor chain, first match wins)
- Direct contract-qualified calls (`ContractName.foo()`)
- State variable identification (contract-level declarations, not local)
- `super.foo()` resolution via C3 chain
- `using...for` directive resolution (extension methods)

**What it explicitly defers to gaps:**
- Overloaded function disambiguation (would require type resolution)
- Calls through typed variables or mappings
- Deep struct field access chains
- Dynamic interface resolution

### 5.4 Framework-Aware Resolution

When a framework is specified in `ScanContext`, the trait activates framework-specific pattern recognition. This is AST pattern matching, not type resolution — the trait recognizes common idioms without needing library source.

**Example: Rust + Anchor**
- `ctx.accounts.some_account` → recognized as account access pattern
- `invoke` / `invoke_signed` → classified as CPI (external call, `CallTargetKind: 'external_unknown'`)
- `#[account(mut, has_one = authority)]` → recognized as access control constraint
- `Signer` type in account struct → recognized as signer check

**Example: Cairo + Starknet**
- `get_caller_address()` → recognized as caller context value
- `#[external(v0)]` → recognized as public entry point
- Storage variable access patterns → recognized as state reads/writes

The trait does not attempt to resolve Anchor or Starknet library internals. If the framework library source is in the file set, normal resolution applies. If not, the trait emits gaps for unresolved callees but still captures the high-level facts (this is an external call, this is an account access) that rules need.

---

## 6. Language Trait Interface

```typescript
interface ModifierInfo {
  name: string
  // Where does the wrapped function execute relative to modifier logic?
  pattern: ModifierPattern
}

type ModifierPattern =
  | 'explicit'     // language has a syntactic placeholder (Solidity _;)
  | 'wrapper'      // decorator/annotation wrapping pattern (Python, TS, Rust, Java)
  | 'declarative'  // metadata only, no wrapping logic (Cairo #[external], Rust #[test])

// Built-in context values — language-specific identifiers that rules need to recognize
// without full taint tracking. Provides a stepping stone toward data flow analysis.
interface BuiltinContextValue {
  name: string                // e.g. "msg.sender", "get_caller_address()"
  category: BuiltinCategory
}

type BuiltinCategory =
  | 'caller'           // msg.sender, tx.origin, get_caller_address(), ctx.accounts.signer
  | 'environment'      // block.timestamp, block.number, Clock::get()
  | 'contract_state'   // address(this), self
  | 'other'

interface LanguageTrait {
  language: SupportedLanguage
  framework?: string          // set at scan init from ScanContext

  // Node classification
  isFunctionDef:      (node: SyntaxNode) => boolean
  isExternalCall:     (node: SyntaxNode) => boolean
  isStateWrite:       (node: SyntaxNode) => boolean
  isStateRead:        (node: SyntaxNode) => boolean
  isAccessModifier:   (node: SyntaxNode) => boolean
  isReturnStatement:  (node: SyntaxNode) => boolean
  isPublicFn:         (node: SyntaxNode) => boolean

  // Extraction
  getFunctionName:    (node: SyntaxNode) => string | null
  getCallTarget:      (node: SyntaxNode) => string | null
  getWrittenVar:      (node: SyntaxNode) => string | null
  getModifiers:       (node: SyntaxNode) => ModifierInfo[]

  // Resolution — language owns this entirely
  // Returns qualified callee name and target kind, or null → gap emitted by caller
  resolveCallee: (
    node: SyntaxNode,
    symbolMap: SymbolMap,
    sourceFiles: Map<string, string>
  ) => { qualifiedName: string; targetKind: CallTargetKind } | null

  // Extension method resolution
  // Given a receiver type string and method name, returns the qualified name of the
  // resolved function, or null if no extension method applies.
  // Solidity: using...for directives. Rust/Cairo: trait impls. Go: type methods.
  // Languages where this doesn't apply return null.
  resolveExtensionMethod: (
    receiverType: string,
    methodName: string,
    sourceFiles: Map<string, string>
  ) => string | null

  // Returns ordered list of ancestor scopes for a given container name.
  // Solidity: C3-linearized inheritance chain.
  // Python: C3-linearized MRO.
  // Rust/Cairo: implemented traits.
  // Java: superclass chain + implemented interfaces.
  // Move: imported modules.
  // Returns [] if not applicable.
  resolveScope: (
    containerName: string,
    sourceFiles: Map<string, string>
  ) => string[]

  // Built-in context value recognition
  // Returns classification if node represents a language/framework built-in,
  // or null if it's a user-defined symbol.
  isBuiltinContextValue: (node: SyntaxNode) => BuiltinContextValue | null
}
```

### Modifier/Decorator Patterns Across Languages

| Language    | Mechanism                   | Pattern       | Notes                                          |
|-------------|----------------------------|---------------|-------------------------------------------------|
| Solidity    | `modifier onlyOwner`       | `explicit`    | `_;` marks where function body executes          |
| Python      | `@decorator`               | `wrapper`     | Decorator calls wrapped fn at an internal point  |
| Rust        | `#[proc_macro]` attributes | `wrapper`     | Attribute macros wrap function body              |
| TypeScript  | `@Decorator()`             | `wrapper`     | Stage 3 decorators, method wrapping              |
| Java        | `@Around` (AOP)            | `wrapper`     | AspectJ-style, wraps method execution            |
| Cairo       | `#[external(v0)]`          | `declarative` | Metadata only, no body wrapping                  |
| Move        | None                       | N/A           | No modifier concept                              |
| Go          | None                       | N/A           | No decorator concept (middleware is manual)       |

For the path walker (§9): `explicit` and `wrapper` patterns mean the walker must enter the modifier/decorator body and understand that code after the placeholder or wrapped-call point executes post-function. A state write in post-function modifier code is reentrancy-relevant. For `declarative` modifiers, no body walking is needed — they are metadata only, but still relevant for rules checking "is this function marked external/public."

---

## 7. Rule Definition

### 7.1 Shared Types

```typescript
interface RuleApplicability {
  languages?: SupportedLanguage[]       // explicit list, or...
  domains?: LanguageDomain[]            // ...by domain
  inheritanceModels?: InheritanceModel[] // ...by inheritance model
  frameworks?: string[]                 // ...by framework (e.g. ['anchor', 'cosmwasm'])
}

interface RuleContext {
  node: SyntaxNode
  tree: Tree
  source: string
  file: string
  symbolMap: SymbolMap
  trait: LanguageTrait
  effective: EffectiveLanguageMeta      // resolved domain/framework for current language

  // Rules declare their applicability; engine skips if current context doesn't match.
  appliesTo: RuleApplicability
}

interface RuleFinding {
  ruleId: string
  ruleSource: RuleSource              // 'shipped' | 'custom'
  severity: Severity
  title: string
  location: { file: string; line: number; col: number }
  evidence: {
    snippet: string
    executionPath?: string[]          // qualified function names walked
  }
  confidence: Confidence
  resolvedBy: ResolvedBy              // 'static' | 'agent' | 'manual'
                                      // flags to reviewer when AI-inferred facts contributed
}

// Union type for includeSeverity filter in sast_run_rules
// Complex/high-severity rules tend to be noisier — caller decides what to run
type SeverityFilter = Severity[]
```

### 7.2 Rule Applicability Matching

The engine evaluates `appliesTo` against the scan's `EffectiveLanguageMeta` for the current file's language. A rule runs if ALL specified criteria match (AND logic within a criterion uses OR — e.g. `domains: ['on-chain']` matches any on-chain language):

```typescript
function ruleApplies(rule: RuleApplicability, meta: EffectiveLanguageMeta, lang: SupportedLanguage): boolean {
  if (rule.languages && !rule.languages.includes(lang)) return false
  if (rule.domains && !rule.domains.includes(meta.domain)) return false
  if (rule.inheritanceModels && !rule.inheritanceModels.includes(meta.inheritanceModel)) return false
  if (rule.frameworks && meta.framework && !rule.frameworks.includes(meta.framework)) return false
  if (rule.frameworks && !meta.framework) return false  // rule requires a framework, none specified
  return true
}
```

### 7.3 NarrowRule — Single-Node Context

```typescript
type NarrowRule = (ctx: RuleContext) => RuleFinding | null
```

For patterns detectable within a tight local scope. Fast, no path walking. Examples: missing zero-address check, unchecked return value, missing event emission.

### 7.4 PathRule — State Machine Across Execution Path

For patterns requiring state to be carried across node boundaries and function call edges.

```typescript
interface Phase {
  id: string
  description: string                    // human-readable; used in rule synthesis skill
  condition: (
    node: SyntaxNode,
    ctx: RuleContext,
    state: PhaseState
  ) => boolean
  onEnter?: (node: SyntaxNode, state: PhaseState) => PhaseState
}

interface PhaseState {
  currentPhase: number
  matched: boolean[]
  evidence: Array<{ node: SyntaxNode; file: string }>
  [key: string]: unknown                 // phase-local accumulation
}

interface PathRule {
  id: string
  severity: Severity
  title: string
  scope: 'function' | 'cross-function' | 'cross-contract'
  maxDepth: number                       // recursion limit; prevents infinite walk
  phases: Phase[]
  appliesTo: RuleApplicability
  buildFinding: (state: PhaseState, ctx: RuleContext) => RuleFinding
}
```

**Reentrancy as PathRule:**

```typescript
export const reentrancy: PathRule = {
  id: 'SHARED-REENTRANCY-001',
  severity: 'critical',
  title: 'State write after external call',
  scope: 'cross-function',
  maxDepth: 6,
  appliesTo: { domains: ['on-chain'] },
  phases: [
    {
      id: 'enter-public-fn',
      description: 'Enter a public or external function',
      condition: ({ node, trait }) =>
        trait.isFunctionDef(node) && trait.isPublicFn(node),
    },
    {
      id: 'external-call',
      description: 'An external call is made (including through modifier post-body)',
      condition: ({ node, trait, state }) =>
        state.matched[0] && trait.isExternalCall(node),
      onEnter: (node, state) => ({ ...state, externalCallNode: node })
    },
    {
      id: 'state-write-after-call',
      description: 'A state variable is written after the external call',
      condition: ({ node, trait, state }) =>
        state.matched[1] && trait.isStateWrite(node),
    }
  ],
  buildFinding: (state, ctx) => ({
    ruleId: 'SHARED-REENTRANCY-001',
    ruleSource: 'shipped',
    severity: 'critical',
    title: 'State write after external call',
    location: locationOf(state.evidence[2].node),
    evidence: {
      snippet: snippetOf(state.evidence[2].node, ctx.source),
      executionPath: state.evidence.map(e => `${e.file}:${locationOf(e.node).line}`)
    },
    confidence: 'high',
    resolvedBy: ctx.symbolMap.get(ctx.file)?.resolvedBy ?? 'static'
  })
}
```

---

## 8. MCP Tool Endpoints

Three tools forming a deliberate multi-turn flow. The Claude Code agent drives the process — it reads gap output, consults source files itself, then passes resolved entries back. No internal agent spawning.

All tool outputs use **TOON encoding** for token efficiency.

### Tool 1: `sast_init_scan`

Purely static. Runs tree-sitter parse, builds partial symbol map, emits gap list. No AI, no heuristic summaries.

**Input:**
```typescript
{
  files: string[]
  languages: SupportedLanguage[]     // multilingual: pass multiple if mixed codebase
  context?: ScanContext              // domain overrides, framework hint
  options?: {
    maxDepth?: number                // path walk depth limit, default 6
  }
}
```

**Output (TOON):**
```typescript
{
  scanId: string
  effective: Record<SupportedLanguage, EffectiveLanguageMeta>
  symbolMapStats: {
    totalSymbols: number
    resolvedSymbols: number
    gapCount: number
  }
  gaps: SymbolGap[]                  // full structured gap list with relevantFiles + priority
  hotspots: string[]                 // from shared computeHotspots(), reused from call_chains
  status: ScanStatus                 // 'ready' if gapCount === 0, else 'needs_resolution'
}
```

State persisted to `/tmp/saist-{scanId}.json`.

---

### Tool 2: `sast_resolve_gaps`

Accepts resolved gap entries provided by the calling agent or human. Merges them into the persisted symbol map. The agent has already done the file reading and reasoning — this tool just applies the results.

**Input:**
```typescript
{
  scanId: string
  resolutions: Array<{
    gapId: string
    facts: Partial<SymbolEntry>      // what the agent determined
    resolvedBy: 'agent' | 'manual'
    confidence: Confidence
  }>
}
```

**Output (TOON):**
```typescript
{
  scanId: string
  applied: number
  remaining: SymbolGap[]
  status: ScanStatus
}
```

The SAiST skill (see §10) defines how the Claude Code agent should read the gaps, look up relevant files, and formulate the `resolutions` payload.

---

### Tool 3: `sast_run_rules`

Runs rules against the enriched symbol map. Parallel across rules. Returns findings. Supports loading custom rules from file paths alongside shipped rules.

**Input:**
```typescript
{
  scanId: string
  ruleIds?: string[]                 // specific shipped rules; omit for all applicable
  customRulePaths?: string[]         // absolute paths to .ts files exporting NarrowRule | PathRule
  includeSeverity?: SeverityFilter   // e.g. ['critical', 'high']
                                     // omit to run all; note high-severity rules are noisier
}
```

**Output (TOON):**
```typescript
{
  scanId: string
  findings: RuleFinding[]
  summary: {
    bySeverity: Record<Severity, number>
    rulesRun: number
    shippedRulesRun: number
    customRulesRun: number
    customRulesLoaded: number        // includes any that failed validation
    customRulesFailed: string[]      // paths of rules that failed to load/validate
    agentResolvedFindings: number    // findings where resolvedBy !== 'static'
  }
}
```

### Custom Rule Loading

Custom rules are loaded from the file paths provided in `customRulePaths`. The engine:

1. Dynamically imports each `.ts` file
2. Validates that it exports a `NarrowRule` or `PathRule` conforming to the interfaces
3. Checks that the rule ID uses the `CUSTOM-` prefix (or a user-defined namespace that does not collide with shipped prefixes)
4. On validation failure: logs the error, adds the path to `customRulesFailed`, and continues — one bad rule does not abort the scan
5. Runs validated custom rules alongside shipped rules through the same engine

Custom rules have full access to `RuleContext` including the symbol map, trait, and effective metadata. They are subject to the same `appliesTo` filtering as shipped rules.

---

## 9. Path Walking Engine

Handles cross-function and cross-contract traversal for PathRules. Called per rule per entry-point function node.

The walker must handle modifier/decorator bodies for languages where `ModifierPattern` is `explicit` or `wrapper`:

- **`explicit` (Solidity):** The modifier body is split at the `_;` placeholder. Code before the placeholder executes pre-function, code after executes post-function. The walker treats the placeholder as the point where the function body (and its call graph) executes. A state write in post-placeholder modifier code that follows an external call in the function body is a reentrancy vector.
- **`wrapper` (Python, TS, Rust, Java):** The decorator wraps the function. If the decorator source is available, the walker enters it and treats the call to the wrapped function as the split point. If the decorator source is not available, a gap is emitted for the decorator's behavior.
- **`declarative` (Cairo `#[external]`, etc.):** No body to walk. The modifier is metadata only — the walker skips it but the metadata is available in `ModifierInfo` for rules that check annotations.

```typescript
async function walkPath(
  node: SyntaxNode,
  rule: PathRule,
  state: PhaseState,
  ctx: RuleContext,
  visited: Set<string>,          // cycle guard: qualifiedName
  depth: number
): Promise<RuleFinding | null> {

  if (depth > rule.maxDepth) return null

  for (const child of node.children) {
    const phase = rule.phases[state.currentPhase]

    if (phase.condition(child, ctx, state)) {
      state = {
        ...phase.onEnter?.(child, state) ?? state,
        currentPhase: state.currentPhase + 1,
        matched: [...state.matched, true],
        evidence: [...state.evidence, { node: child, file: ctx.file }]
      }
    }

    if (state.currentPhase === rule.phases.length) {
      return rule.buildFinding(state, ctx)
    }

    // Follow call edges (using CallTargetKind from symbol map)
    const callee = ctx.trait.resolveCallee(child, ctx.symbolMap, ctx.sourceFiles)
    if (callee && !visited.has(callee.qualifiedName)) {
      const calleeNode = lookupFunctionNode(callee.qualifiedName, ctx.symbolMap)
      if (calleeNode) {
        visited.add(callee.qualifiedName)
        const result = await walkPath(calleeNode, rule, state, ctx, visited, depth + 1)
        if (result) return result
      }
    }

    // Follow modifier bodies for explicit/wrapper patterns
    const entry = ctx.symbolMap.get(currentFunctionQualifiedName)
    if (entry) {
      for (const mod of entry.modifiers) {
        if (mod.pattern === 'explicit' || mod.pattern === 'wrapper') {
          const modNode = lookupModifierNode(mod.name, ctx.symbolMap)
          if (modNode && !visited.has(mod.name)) {
            visited.add(mod.name)
            const result = await walkPath(modNode, rule, state, ctx, visited, depth + 1)
            if (result) return result
          }
        }
      }
    }

    const result = await walkPath(child, rule, state, ctx, visited, depth + 1)
    if (result) return result
  }

  return null
}
```

---

## 10. SAiST Skill (`skills/saist.md`)

The skill defines the full interaction protocol for Claude Code operating as the SAiST orchestrator. It contains:

**MCP flow section:**
1. Call `sast_init_scan` with target files, specifying `context.framework` if the codebase uses a known framework (Anchor, CosmWasm, Starknet, etc.)
2. Review gap list — prioritize `high` gaps first
3. For each gap: read `relevantFiles`, determine facts, call `sast_resolve_gaps` with resolutions
4. Repeat until gaps are acceptable or exhausted
5. Call `sast_run_rules` with desired severity filter and any custom rule paths
6. Review findings — flag agent-resolved findings for extra scrutiny; note custom vs shipped rule source

**Gap resolution prompting conventions:**
- What to look for per gap type (`interface_impl` vs `inherited_fn` vs `dynamic_dispatch`)
- How to formulate a resolution entry, including `CallTargetKind` for callee entries
- When to mark confidence as `low` vs `medium`
- When to leave a gap unresolved rather than guess
- Framework-specific guidance: e.g. for Anchor gaps, check `declare_id!`, `#[program]`, account structs

**Rule synthesis conventions:**
- How to decide if a confirmed finding is structurally expressible
- PathRule vs NarrowRule decision criteria
- Phase description writing guidelines (used by future synthesis automation)
- Test fixture format: one vulnerable contract/program, one safe version
- File naming and placement conventions
- `appliesTo` guidance: prefer narrow targeting (specific framework) over broad (all on-chain)

**Custom rule authoring conventions:**
- Rule ID must use `CUSTOM-` prefix or a user-defined namespace (e.g. `MYTEAM-`)
- File must export a single `NarrowRule` or `PathRule` as the default export
- Must include `appliesTo` — rules without applicability filters are rejected
- Must include at least one test fixture (vulnerable + safe) alongside the rule file
- Recommended: co-locate custom rules in a `saist-rules/` directory in the audited repo or a dedicated rules repo
- Migration path: once a custom rule proves its value, move it to `rules/shared/` or `rules/<language>/` with a shipped prefix

---

## 11. CLI Wrapper (Future)

The CLI requires a `ModelAdapter` to close gaps autonomously — invoking either Claude Code or Gemini CLI non-interactively. The same adapter abstraction will serve the deep scan harness.

```typescript
interface ModelAdapter {
  run(prompt: string, files: string[]): Promise<string>
}

class ClaudeCodeAdapter implements ModelAdapter {
  run(prompt, files) {
    // spawn: claude -p prompt --output-format stream-json
  }
}

class GeminiAdapter implements ModelAdapter {
  run(prompt, files) {
    // spawn: gemini -p prompt --yolo (or equivalent flags)
  }
}
```

Internal library functions (`initScan`, `resolveGaps`, `runRules`) are identical between MCP and CLI. Only the gap-closing orchestration layer differs. The CLI passes resolved gaps programmatically via the same `sast_resolve_gaps` interface.

---

## 12. Implementation Sequence

**Phase 1 — Foundation**
- [ ] Type definitions (`Severity`, `Confidence`, `ResolvedBy`, `ScanStatus`, `GapType`, `GapPriority`, `CallTargetKind`, `RuleSource`, `ModifierPattern`, `BuiltinCategory`, `LanguageDomain`, `InheritanceModel`)
- [ ] `LANGUAGE_META` registry with all 16 languages
- [ ] `ScanContext` and `EffectiveLanguageMeta` resolution logic
- [ ] `SymbolMap`, `SymbolEntry` (with structured `CalleeEntry`), `SymbolGap` data model
- [ ] `LanguageTrait` interface (full: resolveCallee, resolveExtensionMethod, resolveScope, isBuiltinContextValue, getModifiers with ModifierInfo)
- [ ] Extract `computeHotspots()` from `call_chains` into `src/static/hotspots.ts`; update `call_chains` tool to delegate
- [ ] Static tree-sitter pass → partial symbol map + typed gap list
- [ ] `SolidityTrait` — C3 linearization, `using...for` extension methods, `_;` modifier analysis, built-in context values (msg.sender, etc.)
- [ ] `persistence.ts` — `/tmp` scan state read/write
- [ ] `sast_init_scan` MCP tool

**Phase 2 — Gap Resolution + Initial Rules**
- [ ] `sast_resolve_gaps` MCP tool — accepts agent-provided resolutions, merges into map
- [ ] SAiST skill — MCP flow + gap resolution conventions
- [ ] 2-3 NarrowRules (missing modifier, unchecked return, missing zero-address check)
- [ ] `rule-loader.ts` — shipped rule loading with `appliesTo` filtering
- [ ] `sast_run_rules` MCP tool with TOON output + severity filter

**Phase 3 — Path Walking + Custom Rules**
- [ ] `PathRule` interface + phase state machine
- [ ] `walkPath` engine with cycle guard, depth limit, modifier body traversal
- [ ] Reentrancy rule as first PathRule (`SHARED-REENTRANCY-001`)
- [ ] Custom rule loading in `rule-loader.ts` — dynamic import, validation, namespacing
- [ ] `customRulePaths` support in `sast_run_rules`

**Phase 4 — Language Breadth**
- [ ] `RustTrait` — framework-aware (anchor, cosmwasm, substrate, near): CPI recognition, account patterns, trait impl extension methods
- [ ] `CairoTrait` — framework-aware (starknet): dispatcher patterns, storage access, trait impls
- [ ] `MoveTrait` — module resolution, self-parameter extension methods
- [ ] `PythonTrait` — C3 MRO, decorator wrapper pattern, built-in context values
- [ ] Remaining traits (Go, Java, C++, TypeScript, JavaScript, TSX, Flow, Noir, Tolk, Compact, Masm) — scoped to 80:20
- [ ] Shared rules instantiated with `appliesTo` declarations including framework filters

**Phase 5 — CLI + Loop**
- [ ] `ModelAdapter` abstraction + `ClaudeCodeAdapter` + `GeminiAdapter`
- [ ] CLI wrapper using adapters for end-to-end gap resolution
- [ ] Rule synthesis conventions added to SAiST skill
- [ ] Custom rule authoring conventions added to SAiST skill
- [ ] First rule synthesized from a confirmed finding
- [ ] Test fixture convention established
- [ ] SAiST integrated as pre-filter layer in deep scan harness
