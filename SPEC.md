# aud (auditor-addon) Zig+Lua — Architecture Specification

Port of the auditor-addon static analysis engine from TypeScript to a Zig CLI with Lua rule engine.

## 1. Design Principles

- **80/20 graph construction**: Zig builds nodes and resolves easy references deterministically. Hard references (deep inheritance resolution, type-resolved state access, cross-contract dispatch) are annotated as **gaps** for an LLM agent to fill.
- **Unified reference model**: Every non-structural relationship (calls, reads, writes, modifiers, inheritance, imports, emits) is a **Reference** — a site-specific link from source location to zero or more target nodes. References replace the old edge/gap/PendingRef split with a single type that carries resolution state.
- **Config-driven adapters**: Language-specific knowledge is expressed as declarative config (node type mappings, field names, property extraction) + minimal Zig custom handlers for edge cases.
- **Common taxonomy**: Rules target a language-agnostic node model. Language-specific detail is accessible via the AST bridge for pattern-level rules.
- **Lua rules with visitor pattern**: Rules define `enter(node)`/`exit(node)` hooks. The Zig walker drives traversal (scope or deep), Lua reacts. No iteration boilerplate in rules.
- **Two rule families**: Visitor rules (AST-aware, walker-driven) and Map rules (graph-only, no AST walking).
- **Import-driven file expansion**: A single scan automatically discovers imports, parses referenced files, and iterates until no new files are found. Nodes are cheap to rebuild; references are the persisted artifact.

---

## 2. Data Model

The graph has three concepts: **Nodes** (declared source entities), **Contains
edges** (structural parent→child), and **References** (all other relationships).

### 2.1 Graph Node

```
GraphNode {
    id:             u64             -- content-addressed hash (see §2.5)
    kind:           NodeKind        -- taxonomy kind (file, container, callable, variable, modifier, event)
    language_kind:  []const u8      -- raw tree-sitter node type (e.g., "contract_declaration")
    name:           []const u8      -- short label (e.g., "withdraw")
    qualified_name: []const u8      -- fully qualified (e.g., "Vault.withdraw")
    container:      ?u64            -- parent container node id (denormalized for fast lookup)
    visibility:     ?[]const u8     -- "public", "private", "internal", "external", or null
    language:       Language         -- which language produced this node

    -- Source location (for display in findings and agent context only)
    locator: ?SourceLocator {
        file:        []const u8
        start_byte:  u32
        end_byte:    u32
        line:        u32            -- 1-indexed, for display
        column:      u32            -- 0-indexed
    }

    -- Direct reference to tree-sitter node (valid while Tree is alive).
    -- Used by the walker for zero-cost AST re-entry. Not serialized.
    -- On re-scan, populated naturally during the walk phase (no rehydration needed).
    ast_node:    ?ts.Node

    -- Flexible key-value properties (visibility, mutability, type, decorators, etc.)
    properties:  StringHashMap([]const u8)
}
```

### 2.2 Node Taxonomy (NodeKind)

| Taxonomy Kind | Solidity              | Python          | Go                  | Java           | Rust              | C++             |
|---------------|-----------------------|-----------------|---------------------|----------------|-------------------|-----------------|
| `file`        | .sol file             | .py module      | .go file            | .java file     | .rs file          | .cpp/.h file    |
| `container`   | contract, interface, library | class    | struct (synthetic)  | class          | impl, mod         | class           |
| `callable`    | function, constructor, fallback, receive | def, method | func, method | method, constructor | fn, method | method, function |
| `variable`    | state_variable        | attribute       | field               | field          | field             | field           |
| `modifier`    | modifier              | decorator       | —                   | annotation     | attribute         | attribute       |
| `event`       | event                 | —               | —                   | —              | —                 | —               |

Every file parsed becomes a `file` node — the root container for that file's
declarations. Contracts, classes, and other containers are children of the file
node. Free functions (Solidity ≥0.7.1), module-level definitions (Python), and
package-level functions (Go) use the file node as their container directly.

Languages that lack a concept simply produce no nodes of that kind. Rules that check for it find nothing and move on.

### 2.3 Contains Edges (Structural)

Contains edges are the only traditional graph edges. They model the structural
parent→child relationship between containers and their members:

```
ContainsEdge {
    from:   u64     -- container (file, contract, class, impl, module)
    to:     u64     -- child (callable, variable, modifier, event, nested container)
}
```

Contains edges are set at walk time, always concrete, never unresolved. They are
not references — they don't go through resolution and never become gaps.

### 2.4 References (Unified Relationship Model)

Every non-structural relationship in the graph is a **Reference** — a site-specific
link from a source location to zero or more target nodes. References unify what
was previously three separate types: `PendingRef`, `GraphEdge`, and `EdgeGap`.

A reference is identified by its source location (`hash(file, start_byte)`) and
carries orthogonal resolution and gap state:

```
Reference {
    id:           u64               -- hash(file, start_byte), unique per source location
    from:         u64               -- enclosing scope node (callable or container)
    container:    u64               -- enclosing container (for scoped resolution)
    kind:         RefKind           -- what type of reference this is
    target_name:  []const u8        -- name being referenced (always preserved)
    site:         SourceLocator     -- where the reference occurs in source

    -- Resolution: 0..N target node IDs
    targets:      []u64             -- empty = unresolved, 1 = normal, N = dispatch
    target_kind:  ?CallTargetKind  -- for call refs: internal, external, etc.

    -- Gap signal (orthogonal to targets)
    gap:          ?Priority         -- non-null = agent should look at this
    resolved:     bool              -- true once resolution has been attempted
}

RefKind = enum {
    import,         -- file → file
    call,           -- callable → callable
    inheritance,    -- container → container (parent)
    state_read,     -- callable → variable
    state_write,    -- callable → variable (state modification)
    modifier_use,   -- callable → modifier
    event_emit,     -- callable → event
}

CallTargetKind = enum {
    internal,           -- same container
    cross_module,       -- different container in scope
    external,           -- external contract/library call
    interface_dispatch, -- call through interface (may have multiple targets)
    unknown,
}

Priority = enum {
    high,       -- critical for analysis (missing modifier, unresolved inheritance)
    medium,     -- affects completeness (unresolved call)
    low,        -- nice to have (external call target refinement)
}
```

**Reference ID** is `hash(file, start_byte)`:
- **Deterministic**: same source → same byte offsets → same IDs across re-scans.
- **Collision-free**: two AST nodes cannot start at the same byte in the same file.
- **Walker-computable**: `hash(ctx.current_file, node.startByte())` — O(1) lookup
  during deep walk.
- **Opaque to agents**: agents see the ref_id in gaps output and echo it back in
  the resolution file. They never compute it.

**Orthogonal resolution and gap state:**

The `targets` list and `gap` field are independent dimensions:

| targets | gap | meaning | example |
|---------|-----|---------|---------|
| `[X definite]` | `null` | Fully resolved, no help needed | `_transfer()` → internal call |
| `[]` | `.low` | Resolved as external, agent could identify target | `addr.call()` → known external, unknown destination |
| `[X candidate, Y candidate]` | `null` | Agent provided multiple dispatch targets | `IVault(addr).withdraw()` → two implementations |
| `[]` | `.high` | Unresolved, agent should help | `onlyOwner` → modifier not in scope |
| `[]` | `null` | Dropped — not worth a gap | `amount` → local variable, not state |

This replaces the old model where edges and gaps were separate collections that
couldn't express "resolved but also worth investigating."

**Lifecycle**: References start with `resolved = false` during the walk phase (was
`PendingRef`). During resolution, each reference transitions: targets are populated
(was `GraphEdge`), gap is set if needed (was `EdgeGap`), and `resolved` is set to
true. Dropped references get `resolved = true` with empty targets and no gap.

### 2.5 Content-Addressed Node IDs

Node IDs are deterministic hashes derived from the node's identity:

```zig
fn nodeId(name: []const u8, file: []const u8, line: u32) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(name);
    hasher.update(file);
    hasher.update(std.mem.asBytes(&line));
    return hasher.final();
}
```

Reference IDs are deterministic hashes of the source location:

```zig
fn refId(file: []const u8, start_byte: u32) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(file);
    hasher.update(std.mem.asBytes(&start_byte));
    return hasher.final();
}
```

**Node ID properties:**
- **Deterministic**: same source → same IDs across re-scans.
- **Serialization-friendly**: u64 values, no pointers, works in JSON/TOON.
- **Agent-computable**: the agent can compute a node ID from `file:line:name` —
  the same information it sees in source. The resolution file target format
  maps directly to the hash inputs.
- **Collision-safe**: Wyhash over (name, file, line) is unique in practice — two
  declarations with the same name on the same line in the same file cannot exist.

**Reference ID properties:**
- **Collision-free**: two AST nodes cannot start at the same byte in the same file.
- **Not agent-computable**: ref IDs are opaque handles. The agent reads them from
  gaps output and echoes them back in the resolution file.

### 2.6 Symbol Graph

The graph stores nodes, structural edges, and references with indices for
efficient lookup:

```
SymbolGraph {
    nodes:          HashMap(u64, *GraphNode)        -- node ID → node
    contains:       ArrayList(ContainsEdge)          -- structural edges
    refs:           ArrayList(Reference)             -- all non-structural relationships
    children_index: HashMap(u64, ArrayList(u64))     -- container → child node IDs
    site_index:     HashMap(u64, u32)                -- ref ID → index in refs list
}
```

The `site_index` is built during resolution and enables O(1) lookup by source
location — the deep walker's primary access pattern.

---

## 3. Execution Model

### 3.1 No Persistence

There is no persisted scan state. The full pipeline (walk + expand + resolve)
runs from scratch on every invocation — sub-second even for hundreds of files.

Agent-resolved references are stored in a **resolution file** (CSV), managed
outside the tool. This file is the only artifact that carries state across
invocations. It is portable, versionable, and human-readable.

**Rebuilt on every invocation:**
- All graph nodes (from fresh AST parse + import expansion)
- All references (discovered during walk, resolved during resolution phase)
- `ast_node` references (populated naturally during walk)
- Gap annotations (what's left after static resolution)

**External artifact (resolution file):**
- Agent-resolved references, passed in via `--resolutions=<file>`
- Applied after static resolution: matching gap references gain targets,
  gap annotations are cleared

### 3.2 Workflow

```
Step 1:  aud gaps "src/**/*.sol"
  → full pipeline (parse, walk, expand, resolve)
  → output references with gap annotations in TOON format

Step 2:  agent creates resolutions.csv from gap output

Step 3:  aud gaps "src/**/*.sol" --resolutions=resolutions.csv
  → full pipeline again
  → apply resolutions: validate each entry, add targets, clear gaps
  → output remaining gaps + flag stale/broken resolutions

Step 4:  aud run "src/**/*.sol" --resolutions=resolutions.csv
  → full pipeline + apply resolutions
  → run rules (rules see all references: static + agent-resolved)
  → output findings in TOON format
```

### 3.3 Resolution File Application

When `--resolutions` is provided, after the static pipeline completes:
- Parse the CSV file (see §8.3 for format)
- For each resolution: look up reference by `ref_id` in the site index
- Compute target node ID: `nodeId(target_name, target_file, target_line)`
  — same hash as §2.5 — and look up in the node HashMap
- If reference found and has a gap, and target node exists → add target
  to reference, clear gap annotation
- If ref_id not found → stale resolution, report warning
- If target node not found → broken resolution, report error

### 3.4 Import-Driven File Expansion

File expansion happens automatically within a single invocation. During
the walk phase, import statements are collected as a side effect. Any imported
file not yet in the file set is parsed and walked, which may discover further
imports. This repeats until no new files are found.

```
aud scan "src/Vault.sol"
  Round 1: parse + walk src/Vault.sol
    → nodes created, pending references recorded
    → import "src/Ownable.sol" discovered
  Round 2: parse + walk src/Ownable.sol
    → Ownable nodes created
    → import "src/AccessControl.sol" discovered
  Round 3: parse + walk src/AccessControl.sol
    → no new imports
  Resolution: all files walked, resolve pending references
    → Vault.withdraw → Ownable.onlyOwner: reference gains target, fully resolved
    → remaining unresolved references get gap annotations
```

No `--expand` flag, no multi-invocation workflow. One scan, full transitive
closure of imports.

**Unresolvable import paths**: Not all import paths map to files on disk.
Solidity remappings (`@openzeppelin/contracts/...`), uninstalled node_modules,
or framework-specific path aliases may produce import paths the pipeline can't
resolve. These become references with `kind = .import` and `gap = .high`.
The agent can resolve them by providing the correct file path or suggesting
dependency installation.

---

## 4. Graph Construction Pipeline

### 4.1 Single-Pass Walk with Deferred Resolution

The pipeline does **one walk + one resolution pass**. All references discovered
during the walk are recorded as `Reference` items (see §2.4) with
`resolved = false`. During the resolution phase, each reference is resolved:
targets are populated, gap annotations are set, and `resolved` is set to true.

**Walk phase state:**

The walk maintains a scope stack to track nesting context. Both containers
and callables are pushed — a callable inside a contract is just the next
scope level:

```
scope_stack: ArrayList(ScopeFrame)  -- stack of scope-bearing node IDs + names

ScopeFrame { id: u64, name: []const u8, kind: NodeKind }

Before walking a file → create file node, push its ID
On entering a container's body → push container
On entering a callable's body  → push callable
On exiting a scope's body      → pop
After walking a file → pop file node

current_scope     = stack.last()                      -- always non-null (file is always on the stack)
current_container = nearest frame with kind=container  -- for scoped resolution
```

The stack provides:
- **`from` field** on references: `current_scope` — the nearest enclosing scope
  (callable or container). A call inside a function gets `from = function`, not
  `from = contract`.
- **`container` field** on references: `current_container` — the nearest
  enclosing container, for scoped name resolution.
- **`container` field** on child nodes: callables, variables, modifiers, events
  get `container = current_container`.
- **`qualified_name` construction**: join stack entries with "." — e.g.,
  stack `[Vault, withdraw]` → `"Vault.withdraw"`. For nested
  containers (Python classes-in-classes, Rust mod-in-mod), the stack naturally
  handles depth: `[OuterMod, InnerMod]` + fn `foo` → `"OuterMod.InnerMod.foo"`.
- **`contains` edges**: emitted between `current_container` and child nodes.

**Walk phase** (single top-down AST traversal per file, iterated over imports):
- When an import statement is encountered: record reference with
  `kind = .import` and `target_name = raw_import_path`.
- When a container node is encountered (per config mapping): create graph node,
  push onto scope stack. On exiting the container's body, pop.
- When a callable is encountered inside a container: create graph node, emit
  `ContainsEdge` from `current_container`, push onto scope stack, store
  `ast_node` reference directly. On exiting the callable's body, pop.
- When a variable/modifier/event is encountered: create graph node, emit
  `ContainsEdge` from `current_container`.
- When a call expression is encountered: record reference with `kind = .call`.
- When an inheritance specifier is encountered: record reference with
  `kind = .inheritance`.
- When a modifier invocation is encountered: record reference with
  `kind = .modifier_use`.
- When an emit statement is encountered: record reference with
  `kind = .event_emit`.
- When an assignment/write is encountered: unwrap the LHS expression to its root
  identifier (see §4.2), record reference with `kind = .state_write`.
- When a state variable read is encountered: unwrap to root identifier, record
  reference with `kind = .state_read`.
- Property extraction (visibility, mutability, etc.) happens inline via config.

**Import expansion loop** (between walk and resolution):

After walking all current files, process references with `kind = .import`:
- Resolve import path to file on disk → add target to the reference, queue file
  for walking.
- Path not found → leave unresolved (gets gap annotation during resolution).

Walk any newly queued files (which may produce new import references).
Repeat until no new files are queued. Then proceed to resolution.

**Resolution phase** (after all files walked, two ordered steps):

**Step 1 — Annotate unresolved imports, then resolve inheritance:**
```
for each ref where kind == .import and targets is empty:
    ref.gap = .high
    ref.resolved = true

for each ref where kind == .inheritance:
    node = graph.lookup_container(ref.target_name)
    if node → ref.targets = [{node.id, .definite}]
    else   → ref.gap = .high
    ref.resolved = true
```

Unresolved imports get gap annotations. Inheritance must resolve before step 2
so that scoped lookups can walk the full inheritance chain.

**Step 2 — Resolve all other references (run resolve hook first):**

For each unresolved reference, the language-specific resolve hook runs first.
The hook can mutate the reference directly (set targets, attrs, gap). If the
hook sets `resolved = true`, default resolution is skipped.

```
for each ref where resolved == false:
    if resolve_hook → hook(&ref, &graph)  -- may set targets, gap, resolved
    if ref.resolved → continue            -- hook handled it

    switch (ref.kind) {
        .call         → resolveInScope(ref, .callable)
        .state_read,
        .state_write  → resolveInScope(ref, .variable)
        .modifier_use → resolveInScope(ref, .modifier)
        .event_emit   → resolveInScope(ref, .event)
    }
    ref.resolved = true
```

Scoped resolution walks the inheritance chain in language-specific order:
```
fn resolveInScope(ref, expected_kind) {
    target = lookupInScope(ref.container, ref.target_name, expected_kind)
    if target:
        ref.targets = [{target.id, .definite}]
    else:
        // failure handling depends on kind (see table below)
}

fn lookupInScope(container_id, name, expected_kind) ?*GraphNode {
    // Check own container first
    if found in container's children of matching kind → return it

    // Walk parents in language-defined order (via resolved inheritance refs)
    for parent in inheritanceOrder(container_id) {
        if found in parent's children → return it
    }
    return null
}
```

The inheritance traversal order is language-specific (see §4.3).

**Failure handling by kind:**

| RefKind | On success | On failure | Rationale |
|---------|-----------|------------|-----------|
| import | Add target (during expansion) | `gap = .high` | Missing dependency, agent can help |
| call | Add target | `gap = .medium` | Unresolved call is worth investigating |
| inheritance | Add target | `gap = .high` | Missing parent is worth investigating |
| modifier_use | Add target | `gap = .high` | Missing modifier affects access control analysis |
| state_read | Add target | drop (no gap) | Likely a local, parameter, or storage pointer (§15.7) |
| state_write | Add target | drop (no gap) | Same — not worth a gap |
| event_emit | Add target | drop (no gap) | Likely a locally defined event or import issue |

**Site index**: After all references are resolved, build the `site_index`
mapping each `ref.id` to its position in the refs list.

### 4.2 Expression Unwrapping

State variable references in expressions are often nested behind member access
and indexing. The walk phase unwraps to the root identifier before storing the
`target_name` in the `PendingRef`:

```
balances[msg.sender].amount = 0     → root: "balances"
config.limits.maxAmount = 100       → root: "config"
totalSupply += amount               → root: "totalSupply"  (write)
                                      root: "amount"       (read, separate reference)
items.push(x)                       → root: "items"
```

Algorithm: starting from the target AST node, match against the language
config's `unwrap_rules`. If the node type matches a rule, follow its
`child_field`. Repeat until hitting `identifier_type` (return the name) or
a node type with no matching rule (return null — can't resolve).

```zig
fn unwrapToRoot(node: ts.Node, config: LanguageConfig) ?[]const u8 {
    var current = node;
    while (true) {
        const node_type = current.nodeType();
        if (mem.eql(u8, node_type, config.identifier_type)) {
            return current.text();
        }
        // Try each unwrap rule
        for (config.unwrap_rules) |rule| {
            if (mem.eql(u8, node_type, rule.ts_type)) {
                current = current.childByField(rule.child_field) orelse return null;
                break;
            }
        } else {
            return null;  // no matching rule — function call result, literal, etc.
        }
    }
}
```

If unwrapping returns null (e.g., `getResult().field = x`), no `PendingRef` is
created — the expression can't be statically resolved to a state variable.

### 4.3 Inheritance Resolution Order

The `lookupInScope` function walks parent containers in a language-specific
order. Parents are found by querying resolved inheritance references
(`kind = .inheritance` with non-empty targets) from the container. Insertion
order in the refs list preserves declaration order from the walk.

```zig
const InheritanceStrategy = enum {
    c3_linearization,    // Solidity, Python — right-to-left depth-first, deduplicated
    embedded_promotion,  // Go — shallowest embedding wins, ambiguity is error
    flat,                // Rust — no inheritance chain, own scope only
    single_chain,        // Java — single parent + interfaces
};
```

- **C3 linearization** (Solidity): `contract C is A, B` linearizes to `[C, B, A]`.
  First match wins. Handles diamond inheritance deterministically.
- **Embedded promotion** (Go): embedded struct fields are promoted to the
  embedding struct. Shallowest embedding wins; ambiguous promotions are skipped.
- **Flat** (Rust): `impl` blocks have no inheritance. Lookup checks own scope only.
  Trait method resolution is a future extension.
- **Single chain** (Java): walk single parent class, then interfaces in order.

### 4.4 Config-Driven Adapter Schema

Each language defines a static config struct consumed at comptime:

```zig
const LanguageConfig = struct {
    language: Language,

    // Node extraction: tree-sitter type → taxonomy kind + field mappings
    containers: []const ContainerMapping,
    callables:  []const CallableMapping,
    variables:  []const VariableMapping,
    modifiers:  []const ModifierMapping,
    events:     []const EventMapping,

    // Reference detection: how to find calls, inheritance, state refs, etc.
    call_expression:    CallExpressionMapping,
    inheritance:        ?InheritanceMapping,
    modifier_invocation: ?ModifierInvocationMapping,
    emit_expression:    ?EmitMapping,
    write_expressions:  []const WritePattern,
    write_call_methods: []const []const u8,    // method names that mutate receiver (e.g., "push", "pop")

    // Import extraction: how to find file imports for expansion
    imports:            ?ImportMapping,

    // Inheritance resolution strategy
    inheritance_strategy: InheritanceStrategy,

    // Builtins to filter out (don't create edge gaps for these)
    builtin_functions: []const []const u8,
    builtin_receivers: []const []const u8,

    // Expression unwrapping: how to drill down to the root identifier
    // for state ref resolution (see §4.2). Each entry says "if you see
    // this node type, follow this child field to keep unwrapping."
    unwrap_rules:    []const UnwrapRule,
    identifier_type: []const u8,       // terminal node type, e.g., "identifier"

    // Optional: custom handler for edge cases the config can't express
    custom_handler: ?*const fn(*SymbolGraph, ts.Node, []const u8) void,

    // Language-specific resolve hook (§4.1) — called before default resolution.
    // Mutates the reference directly (set targets, attrs, gap, resolved).
    // If the hook sets resolved=true, default resolution is skipped.
    resolve_hook: ?*const fn(ref: *Reference, g: *const SymbolGraph) void,
};

const ContainerMapping = struct {
    ts_type:    []const u8,     // e.g., "contract_declaration"
    name_field: []const u8,     // tree-sitter field name for the identifier
    body_field: []const u8,     // field name for the body/block
    properties: []const PropertyExtractor = &.{},
};

const CallableMapping = struct {
    ts_type:    []const u8,     // e.g., "function_definition"
    name_field: ?[]const u8,    // null for anonymous (fallback, receive)
    body_field: ?[]const u8,    // null for interface declarations
    properties: []const PropertyExtractor = &.{},
};

const VariableMapping = struct {
    ts_type:    []const u8,
    name_field: []const u8,
    type_field: ?[]const u8,
    properties: []const PropertyExtractor = &.{},
};

const ModifierMapping = struct {
    ts_type:    []const u8,     // e.g., "modifier_definition"
    name_field: []const u8,
    body_field: ?[]const u8,
    properties: []const PropertyExtractor = &.{},
};

const EventMapping = struct {
    ts_type:    []const u8,     // e.g., "event_definition"
    name_field: []const u8,
    properties: []const PropertyExtractor = &.{},
};

const PropertyExtractor = struct {
    key:        []const u8,     // property name in the graph node
    child_type: []const u8,     // tree-sitter child node type to match
};

const CallExpressionMapping = struct {
    ts_type:        []const u8,     // e.g., "call_expression"
    function_field: []const u8,     // field pointing to callee
    // Callee node may be an identifier ("withdraw()"), member_expression
    // ("vault.withdraw()"), or other forms. The walk phase extracts the
    // callee name by unwrapping member access to get the function name
    // (rightmost identifier for member calls, bare identifier otherwise).
};

const InheritanceMapping = struct {
    ts_type:    []const u8,     // e.g., "inheritance_specifier"
    name_field: []const u8,     // field pointing to parent name
};

const ImportMapping = struct {
    ts_type:    []const u8,     // e.g., "import_directive"
    path_field: []const u8,     // field pointing to the import path string
};

const ModifierInvocationMapping = struct {
    ts_type:    []const u8,     // e.g., "modifier_invocation"
    name_field: []const u8,     // field pointing to modifier name
};

const EmitMapping = struct {
    ts_type:    []const u8,     // e.g., "emit_statement"
    name_field: []const u8,     // field pointing to event name
};

const WritePattern = struct {
    ts_type:      []const u8,   // e.g., "assignment_expression", "augmented_assignment"
    target_field: []const u8,   // e.g., "left" — field containing the write target
};

const UnwrapRule = struct {
    ts_type:     []const u8,    // node type to unwrap through
    child_field: []const u8,    // field to follow toward root identifier
};

const InheritanceStrategy = enum {
    c3_linearization,    // Solidity, Python
    embedded_promotion,  // Go
    flat,                // Rust
    single_chain,        // Java
};
```

### 4.5 Example: Solidity Config

```zig
const solidity_config = LanguageConfig{
    .language = .solidity,

    .containers = &.{
        .{ .ts_type = "contract_declaration", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "interface_declaration", .name_field = "name", .body_field = "body" },
        .{ .ts_type = "library_declaration",  .name_field = "name", .body_field = "body" },
    },

    .callables = &.{
        .{ .ts_type = "function_definition", .name_field = "name", .body_field = "body", .properties = &.{
            .{ .key = "visibility",  .child_type = "visibility" },
            .{ .key = "mutability",  .child_type = "state_mutability" },
        }},
        .{ .ts_type = "modifier_definition",    .name_field = "name", .body_field = "body" },
        .{ .ts_type = "constructor_definition",  .name_field = null,  .body_field = "body" },
        .{ .ts_type = "fallback_receive_definition", .name_field = null, .body_field = "body" },
    },

    .variables = &.{
        .{ .ts_type = "state_variable_declaration", .name_field = "name", .type_field = "type", .properties = &.{
            .{ .key = "visibility", .child_type = "visibility" },
        }},
    },

    .modifiers = &.{},
    .events = &.{
        .{ .ts_type = "event_definition", .name_field = "name" },
    },

    .call_expression = .{ .ts_type = "call_expression", .function_field = "function" },
    .inheritance = .{ .ts_type = "inheritance_specifier", .name_field = "name" },
    .modifier_invocation = .{ .ts_type = "modifier_invocation", .name_field = "name" },
    .emit_expression = .{ .ts_type = "emit_statement", .name_field = "name" },
    .write_expressions = &.{
        .{ .ts_type = "assignment_expression", .target_field = "left" },
        .{ .ts_type = "augmented_assignment_expression", .target_field = "left" },
        .{ .ts_type = "delete_statement", .target_field = "expression" },
    },
    .write_call_methods = &.{ "push", "pop" },
    .imports = .{ .ts_type = "import_directive", .path_field = "source" },
    .inheritance_strategy = .c3_linearization,

    .builtin_functions = &.{ "require", "assert", "revert", "keccak256", "abi.encode", "abi.encodePacked" },
    .builtin_receivers = &.{ "abi", "block", "msg", "tx", "type" },

    .unwrap_rules = &.{
        .{ .ts_type = "member_expression",      .child_field = "object" },
        .{ .ts_type = "subscript_expression",    .child_field = "object" },
        .{ .ts_type = "slice_expression",        .child_field = "object" },
        .{ .ts_type = "parenthesized_expression", .child_field = "expression" },
        .{ .ts_type = "type_cast_expression",    .child_field = "expression" },
    },
    .identifier_type = "identifier",

    .custom_handler = &solidityCustomHandler,
};
```

---

## 5. Walker

Both walker types traverse full file ASTs top-to-bottom, firing `enter()`/`exit()`
on every node — including contract declarations, state variables, and other
non-callable nodes. Rules see the complete file structure, not just function
bodies. This allows rules that inspect class properties, inheritance declarations,
or cross-declaration patterns.

The walker updates `current_node` in the context as it enters graph-tracked
scopes (callables, containers, modifiers), so rules can query the symbol graph
relative to the enclosing scope at any point.

`finalize()` is called once after all files are walked. Rules manage their own
scope boundaries via `enter()`/`exit()` — e.g., resetting per-function state
when entering a `function_definition` node.

### 5.1 Scope Walker

Walks full file ASTs. Does not follow call edges.

```
for each file node in graph:
    walk file's ast_node (tree root) depth-first:
        update current_node when entering a callable/container/modifier
        call rule.enter(node, ctx) on entry
        call rule.exit(node, ctx) on exit
finalize()
```

Used for syntax-level checks: naming conventions, missing modifiers, code style,
and any rule that needs to see the full file structure.

### 5.2 Deep Walker

Same full-file traversal as scope, but follows resolved call references across
function boundaries when encountering call expressions. Uses site-based lookup
(`refId(file, start_byte)` → site_index → reference → targets) for O(1)
matching of each call expression to its resolved callee(s).

```
for each file node in graph:
    walk file's ast_node (tree root) depth-first:
        update current_node when entering a callable/container/modifier
        call rule.enter(node, ctx)
        on call_expression (if depth < max_depth):
            ref = site_index.lookup(refId(current_file, node.start_byte))
            if ref exists and ref has targets:
                for each target in ref.targets:
                    if target.node has ast_node and not visited:
                        mark visited
                        walk target's ast_node with depth+1
        call rule.exit(node, ctx)
finalize()
```

Used for cross-function analysis: reentrancy, unchecked return values, access
control chains. Multi-target references (dynamic dispatch) naturally follow all
candidate targets.

### 5.3 Walk Context

The walker provides a context to Lua hooks:

```
WalkContext {
    current_file:   []const u8
    depth:          u32             -- 0 = file-level walk, 1+ = followed call
    call_stack:     []u64           -- stack of scope node IDs being walked
    current_node:   u64             -- graph node ID of the enclosing scope
}
```

`current_node` tracks the nearest enclosing callable, container, or modifier
as the walker descends. Rules use it to query the symbol graph (e.g.,
`graph.get_outgoing_edges(ctx.current_node, "calls")`).

---

## 6. Lua Rule Interface

### 6.0 Shipped vs Adhoc Rules

**Shipped rules** are bundled with the tool in the `rules/` directory. They
run by default on `aud run` (all applicable rules for the detected language).
Use `--rule=<ID>` to filter to specific shipped rules.

**Adhoc rules** are provided at runtime by the agent or user:
- `--rule-path=<path>`: load a `.lua` file from any location
- `--rule-inline=<lua_code>`: execute a Lua string directly

Adhoc rules follow the exact same interface as shipped rules (rule table,
`enter()`/`exit()`, `finalize()` for visitor rules; `check()` for map rules).
They have full access to the `graph.*`, `ast.*`, and `report.*` APIs.

This is the primary reason for the Lua rule engine: an agent can generate a
rule on the fly, invoke it against the scanner, and get findings — without
recompiling the tool. The agent writes Lua, passes it via `--rule-inline`,
and reads TOON output.

### 6.1 Visitor Rules (enter/exit hooks, walker-driven)

Each rule file is loaded into its own Lua environment. Module-level variables
persist across `enter()`/`exit()` calls for the entire walk (all files). This
allows rules to accumulate state across functions and files.

The walker traverses all file ASTs top-to-bottom, calling `enter()`/`exit()` on
every node. Rules manage their own scope boundaries — e.g., resetting
per-function state when entering a `function_definition` node. `finalize()` is
called once after all files are walked, allowing rules to emit findings based
on accumulated cross-file state.

```lua
rule = {
    id = "SOL-002",
    name = "reentrancy",
    severity = "critical",
    type = "deep",              -- "scope" or "deep"
    max_depth = 5,              -- deep only
    description = "Detects state changes after external calls",
    languages = {"solidity"},   -- nil = all languages
}

-- Module-level state: persists across the entire walk
local seen_external_call = false

function enter(node, ctx)
    -- node = { kind, line, file, name, handle }
    -- ctx  = { depth, current_file, current_node }

    -- Reset per-function state at function boundaries
    if node.kind == "function_definition" then
        seen_external_call = false
    end

    -- Check if this specific call expression is an external call (O(1) site lookup)
    if not seen_external_call and node.kind == "call_expression" then
        local ref = graph.get_ref_at(ctx.current_file, node.start_byte)
        if ref and ref.target_kind == "external" then
            seen_external_call = true
        end
    end

    -- After an external call, any state write is a reentrancy risk
    if seen_external_call then
        if node.kind == "assignment_expression"
            or node.kind == "augmented_assignment_expression" then
            report.hit({
                file = ctx.current_file,
                line = node.line,
                node_text = ast.text(node.handle) or "",
            })
        end
    end
end
```

### 6.2 Map Rules (direct graph query, no walking)

```lua
rule = {
    id = "MAP-001",
    name = "broad-visibility",
    severity = "info",
    type = "map",
    description = "Detects functions with broader visibility than needed",
}

function check()
    local findings = {}
    local functions = graph.get_nodes_by_kind("callable")
    for _, fn in ipairs(functions) do
        local vis = graph.get_property(fn.id, "visibility")
        if vis == "public" then
            local callers = graph.get_incoming_edges(fn.id, "call")
            -- ... check if any caller is from a different container
        end
    end
    return findings
end
```

### 6.3 Lua API — Graph Queries (`graph.*`)

```
-- Node queries
graph.get_nodes_by_kind(kind)                -> [{id, kind, name, qualified_name, visibility}]
graph.get_node(id)                           -> {id, kind, name, qualified_name, visibility, ...}
graph.get_property(id, key)                  -> string | nil
graph.get_children(id)                       -> [node]  (from contains edges)
graph.get_parent(id)                         -> node | nil
graph.language_info()                        -> {language, node_kinds, ref_kinds, properties}

-- Reference queries (resolved refs presented as edges for backward compat)
graph.get_outgoing_edges(id, ?ref_kind)      -> [{to, kind, target_name, call_site_line, target_kind}]
graph.get_incoming_edges(id, ?ref_kind)      -> [{from, kind, target_name, call_site_line, target_kind}]
graph.get_callers(id)                        -> [node]
graph.get_callees(id)                        -> [node]

-- Reference-native queries (new — exposes full reference state)
graph.get_refs(id, ?ref_kind)                -> [{ref_id, from, kind, target_name, targets, gap, site_line}]
graph.get_ref_at(file, start_byte)           -> ref | nil  (O(1) site lookup)
graph.get_gaps(?ref_kind)                    -> [{ref_id, from, kind, target_name, gap, site_line}]
```

`get_outgoing_edges` and `get_incoming_edges` wrap resolved references as
edge-like tables for backward compatibility. Rules that need full reference
state (including gaps and provisional targets) use `get_refs` instead.

### 6.4 Lua API — AST Bridge (`ast.*`)

For pattern-level rules that need raw tree-sitter access. Language-agnostic,
works identically for all grammars.

```
ast.node(graph_node_id)                     -> ast_handle (from graph node's ast_node ref)
ast.children(handle)                        -> [ast_handle]
ast.named_children(handle)                  -> [ast_handle] (skip anonymous nodes)
ast.child(handle, index)                    -> ast_handle | nil
ast.child_by_field(handle, field_name)      -> ast_handle | nil
ast.parent(handle)                          -> ast_handle | nil
ast.next_sibling(handle)                    -> ast_handle | nil
ast.prev_sibling(handle)                    -> ast_handle | nil
ast.type(handle)                            -> string (tree-sitter node type)
ast.text(handle)                            -> string (source text)
ast.find(handle, type_name)                 -> [ast_handle] (recursive descendant search)
ast.start_line(handle)                      -> number
ast.end_line(handle)                        -> number
ast.start_byte(handle)                      -> number
ast.end_byte(handle)                        -> number
ast.is_named(handle)                        -> boolean
```

Implementation: ~12 Zig functions wrapping tree-sitter Node methods. The `ast_handle`
is an opaque integer (index into a handle table managed by Zig) — avoids passing
raw pointers to Lua.

### 6.5 Lua API — Reporting (`report.*`)

Lua rules are pure detectors — they report **hits** (instances), not formatted
findings. Zig consolidates hits across all rules, attaches rule metadata (id,
name, severity from the `rule` table), and formats the output.

```
report.hit(opts)    -> records an instance for the current rule
    opts = {
        file:       string,         -- from ctx.current_file
        line:       number,         -- from AST node
        node_text:  string,         -- optional, source text for context
    }
```

Rule metadata (`id`, `name`, `severity`, `description`) is read once from the
`rule` table when loading the rule file. No need for Lua to repeat it per hit.

---

## 7. AST Handle Management

AST nodes from tree-sitter are small value types in Zig (~24 bytes). They are valid
as long as the owning `Tree` is alive. The graph stores `ast_node: ?ts.Node` directly
on each `GraphNode`.

For the Lua bridge, handles are needed since Lua can't hold Zig value types:

- Zig maintains a **handle table**: `ArrayList(ts.Node)` indexed by integer.
- `ast.node(graph_node_id)` reads `graph_node.ast_node`, pushes it into the handle
  table, and returns the integer index to Lua.
- When Lua calls `ast.children(handle)`, Zig looks up the ts.Node, calls
  `childCount()`/`child()`, pushes new entries into the handle table, and returns
  new integer handles.
- The handle table is **cleared between rule invocations** to prevent unbounded growth.

This keeps the Lua↔Zig boundary clean: Lua only ever sees integers. All tree-sitter
memory stays in Zig.

### 7.1 Re-scan After Deserialization

When a scan state is loaded from disk, nodes are **not** rehydrated from locators.
Instead, the full graph is rebuilt from scratch (single-pass walk of all source
files). This is cheap (sub-second) and produces fresh `ast_node` references
naturally. Persisted edges are then re-applied by matching content-addressed node
IDs.

The `locator` field exists solely for **display purposes** — showing line numbers
in findings and giving the agent a human-readable source location.

---

## 8. Serialization & Output

### 8.1 CLI Output (TOON)

CLI output uses TOON (Token-Oriented Object Notation) — a compact format
designed for low token consumption in LLM agent contexts. Schema is declared
once, data follows as compact rows.

**`aud gaps` output** — gaps after initial scan:

```
gaps[3]{ref_id,from_name,target_name,kind,file,line,priority}:
  a4f2e81b,withdraw,onlyOwner,call,src/Vault.sol,22,high
  b7c3d012,Vault,Ownable,inheritance,src/Vault.sol,3,high
  c9e4f123,src/Vault.sol,@openzeppelin/contracts/access/Ownable.sol,import,src/Vault.sol,1,high
```

**`aud run` output** — findings grouped by rule:

```
findings[2]:
  SOL-002{severity:critical,name:reentrancy,hits[2]{file,line,node_text}}:
    src/Vault.sol,42,balances[msg.sender]
    src/Vault.sol,67,_transfer(msg.sender)
  MAP-001{severity:info,name:broad-visibility,hits[1]{file,line,node_text}}:
    src/Vault.sol,15,deposit
```

Each rule's metadata (severity, name) is declared once in the group header.
Hits are compact rows — no repeated fields per instance.

**`aud graph` output** — full graph dump:

```
nodes[3]{id,kind,name,qualified_name,visibility,language,file,line}:
  a4f2e81b,container,Vault,Vault,,solidity,src/Vault.sol,4
  b7c3d012,callable,withdraw,Vault.withdraw,public,solidity,src/Vault.sol,10
  e9a1f345,variable,balance,Vault.balance,public,solidity,src/Vault.sol,5
contains[2]{from,to}:
  a4f2e81b,b7c3d012
  a4f2e81b,e9a1f345
refs[1]{ref_id,from,kind,target_name,targets,site_line,gap}:
  f1a2b3c4,b7c3d012,state_write,balance,[e9a1f345],42,
```

### 8.2 JSON (Machine Interop)

JSON output is available via `--format=json` on all commands. Used for MCP tool
interop and programmatic consumption where token efficiency is not a concern.

Node IDs are serialized as hex strings of the u64 hash for readability.

### 8.3 Resolution File (CSV)

The resolution file is the only artifact that carries state across invocations.
It is a CSV with `ref_id` as key (opaque, from gaps output) and target as
`file,line,name` (human-readable, agent-friendly):

```csv
ref_id,target_file,target_line,target_name
a4f2e81b,src/Ownable.sol,15,onlyOwner
b7c3d012,src/Ownable.sol,3,Ownable
c9e4f123,lib/openzeppelin/contracts/access/Ownable.sol,1,Ownable
```

The CLI looks up the reference by `ref_id` in the site index, then computes
`nodeId(target_name, target_file, target_line)` from the CSV columns — same
hash function as §2.5 — and looks up the target node in O(1). The reference
gains the target and its gap annotation is cleared.

- If `ref_id` doesn't match a current reference → stale, report warning
- If target node doesn't exist → broken, report error
- Both are reported as warnings, not fatal errors

The `ref_id` is collision-free (`hash(file, start_byte)`) — two calls to the
same function from different sites produce different ref_ids and can be resolved
independently. The agent never computes ref_ids; it reads them from gaps output.

CSV is straightforward to parse in Zig without external dependencies.

---

## 9. Import-Driven File Expansion

File expansion is built into the scan pipeline (see §3.4 and §4.1). There is no
separate expansion step or CLI flag.

During the walk phase, import statements are collected per language config via
`ImportMapping` (see §4.4). The pipeline maintains a work queue of files to
parse. Argument files are seeded first. As each file is walked, discovered
imports are added to the queue. The loop terminates when the queue is empty —
all transitively reachable files have been walked.

**Performance**: Tree-sitter parsing + walk is sub-millisecond per file. Even
with transitive expansion over hundreds of files, the full pipeline completes
in under a second. The expensive work is agent-provided gap resolutions, which
are persisted and never recomputed.

---

## 10. CLI Interface

```
aud gaps <glob...>                            -- build graph, output gaps
    --resolutions=<file>                        -- validate resolutions, output remaining gaps
    --kind=<edge_kind>                          -- filter gaps (calls, inherits, imports, ...)
    --priority=<high|medium|low>                -- filter gaps
    --language=<lang>                           -- force language (otherwise auto-detected)
    --no-expand                                 -- skip import expansion (argument files only)
    --json                                      -- JSON output instead of TOON

aud run <glob...>                             -- build graph, run rules, output findings
    --resolutions=<file>                        -- apply resolutions before running rules
    --rule=<ID>                                 -- run specific shipped rule(s) only (repeatable)
    --rule-path=<path>                          -- run adhoc rule from .lua file
    --rule-inline=<lua_code>                    -- run adhoc rule from inline Lua string
    --json                                      -- JSON output instead of TOON

aud call-chains <glob...>                     -- map caller→callee chains (see §11)
    --resolutions=<file>                        -- include agent-resolved edges
    --root=<node_name>                          -- start from specific function(s)
    --max-depth=<n>                             -- limit chain depth (default: 10)
    --json                                      -- JSON output instead of TOON

aud graph <glob...>                           -- build graph, dump it
    --resolutions=<file>                        -- include resolved edges in dump
    --format=<toon|json|dot>                    -- output format (default: toon)

aud peek <file...>                            -- see SPEC-CLI.md
aud metrics <glob...>                         -- see SPEC-CLI.md

aud info <language>                           -- list taxonomy kinds, properties, edges
                                                -- (no scanning, prints language config)
```

Graph commands (`gaps`, `run`, `call-chains`, `graph`) rebuild from source on
every invocation. No persistence, no scan IDs. The resolution file (CSV) is the
only artifact that carries state across invocations (see §8.3 for format).

Utility commands (`peek`, `metrics`) are graph-independent and specified in
`SPEC-CLI.md`.

For MCP integration: the CLI is invoked by MCP tools as a subprocess.

---

## 11. Call Chains

The `aud call-chains` command maps caller→callee relationships through the
graph. Call chains show **who calls what** — static dependency paths, not
runtime execution order or control flow.

```
aud call-chains <glob>                        -- map call chains from entry points
    --resolutions=<file>                        -- include agent-resolved edges
    --root=<node_name>                          -- start from specific function(s)
    --max-depth=<n>                             -- limit chain depth (default: 10)
    --json                                      -- JSON output instead of TOON
```

**Algorithm:**
1. Identify root nodes: callables with no incoming call references (entry points),
   or specific roots via `--root`
2. DFS from each root, following resolved call references (all targets per ref)
3. Record each unique caller→callee path as a chain

**TOON output:**
```
roots[2]:
  withdraw{chains[2]{path}}:
    withdraw -> _transfer -> _updateBalance
    withdraw -> _checkOwner
  deposit{chains[1]{path}}:
    deposit -> _updateBalance
```

Useful for auditors to understand call dependencies, identify which entry points
reach sensitive functions, and scope which callables are affected by a change.

---

## 12. File Structure

```
src/
    main.zig                    -- CLI entry point, arg parsing (gaps/run/graph/info)
    graph.zig                   -- SymbolGraph, GraphNode, Reference, ContainsEdge types
    walker.zig                  -- Scope and Deep walkers
    lua_adapter.zig             -- Lua VM init, graph/ast/report API registration
    ast_bridge.zig              -- AST handle table, tree-sitter ↔ Lua bridge
    pipeline.zig                -- Single-pass walk + import expansion + deferred resolution
    resolution.zig              -- Resolution file (CSV) parsing and application
    output.zig                  -- TOON and JSON output formatting
    call_chains.zig             -- Call chain traversal and output
    languages/
        config.zig              -- LanguageConfig type definitions
        solidity.zig            -- Solidity config + custom handler
        python.zig              -- Python config + custom handler
        go.zig                  -- Go config + custom handler
        ... (one file per language)
rules/
    MAP-001-broad-visibility.lua
    SOL-002-reentrancy.lua
    SOL-017-variable-could-be-constant.lua
    GEN-001-naming-conventions.lua
    ...
```

---

## 13. Port Strategy

### Phase 1: Core (prove the architecture)
1. `graph.zig` — data model with Node/Reference/ContainsEdge types, content-addressed IDs
2. `pipeline.zig` — single-pass walk + import expansion + Reference collection
3. `pipeline.zig` — deferred resolution (inheritance-first, then scoped lookup, site_index)
4. `languages/solidity.zig` — first adapter config + resolve hook
5. `output.zig` — TOON + JSON formatting for gaps and graph
6. CLI: `gaps` + `graph` commands
7. `resolution.zig` — CSV parsing and application (ref_id based)

### Phase 2: Rules engine ✓
1. `lua_adapter.zig` — graph query API in Lua ✓
2. `walker.zig` — full-file scope walker ✓
3. `ast_bridge.zig` — AST handle table for pattern rules ✓
4. CLI: `run` command with TOON findings output ✓
5. `report.hit()` API and findings consolidation in Zig ✓

### Phase 3: Deep analysis ✓
1. Deep walker with site-based reference following (using site_index + `ast_node`) ✓
2. Reentrancy rule (deep + ref queries + AST bridge) ✓
3. `call-chains` command ✓
4. Resolve hooks for language-specific reference classification ✓

### Phase 4: Scale
1. Remaining language adapter configs
2. Port remaining rules
3. MCP tool integration

---

## 14. Testing Strategy

Zig supports inline test declarations (`test "description" { ... }`) co-located
with the code they test. Every source file should contain tests for its own
functionality. Run all tests with `zig build test`.

### 14.1 Unit Tests (per file)

**`graph.zig`**:
- Node creation and content-addressed ID determinism (`name + file + line`)
- Reference ID determinism (`file + start_byte`)
- Reference ID collision resistance (different byte offsets → different IDs)
- Node ID collision resistance (different inputs → different IDs)
- ContainsEdge addition and children_index
- Reference addition, site_index building, O(1) lookup
- Reference lifecycle: pending → resolved (with targets) / gap / dropped
- Multi-target references (adding multiple ResolvedTargets)
- Outgoing/incoming reference queries by kind
- lookupContainerByName, lookupChildByName

**`pipeline.zig`**:
- Reference collection from a minimal AST (real parse of Solidity fixtures)
- References carry correct site SourceLocator (file, start_byte)
- Import expansion loop: file A imports B imports C → all three walked
- Unresolvable import → reference with `gap = .high`
- Resolution phase ordering: inheritance resolves before scoped lookups
- `resolveInScope`: own container → inherited → not found
- Resolve hook: Solidity external calls get `attrs.target_kind = .external` + gap
- Resolve hook: non-external calls pass through to default resolution
- Expression unwrapping: `a[b].c.d` → root `"a"`
- Builtin filtering: `require(...)` does not produce a reference
- Site index populated after resolution

**`resolution.zig`**:
- CSV parsing (header, rows, edge cases: commas in names, empty fields)
- Valid resolution: ref_id found + target node found → target added, gap cleared
- Stale resolution: ref_id not found → warning
- Broken resolution: target node not found → error
- Batch application: multiple resolutions in one file
- Provisional resolution: ref with existing default target gets agent target added

**`output.zig`**:
- TOON formatting for gaps (ref_id, from_name, target_name, kind, file, line, priority)
- TOON formatting for findings (rule groups + hit rows)
- TOON formatting for graph (nodes, contains, refs)
- JSON output matches expected structure for all formats
- Gaps output includes provisional refs (has target + has gap)

**`walker.zig`**:
- Scope walker visits all AST nodes in a file (including containers, variables)
- Deep walker follows resolved call references via site_index
- Deep walker: specific call_expression maps to correct callee (not all callees)
- Deep walker: multi-target reference follows all targets
- Deep walker respects max_depth
- Deep walker skips unresolved refs (no target to follow)
- Cycle detection (recursive calls don't infinite loop)
- `current_node` updates when entering callable/container/modifier scopes
- `finalize()` called once after all files walked

**`call_chains.zig`**:
- Root finding: callables with no incoming call references
- DFS follows resolved call references
- Multi-target: DFS explores all candidate targets
- Cycle detection across chains
- max_depth limiting

**`languages/solidity.zig`** (and each language config):
- Config-driven node extraction: parse a fixture, verify correct graph nodes
- Config-driven reference collection: verify references created for calls,
  inheritance, modifiers, emits, state writes with correct site info
- Resolve hook: `.call`, `.send`, `.transfer` → external + low-priority gap
- Resolve hook: normal calls → unhandled (default resolution runs)
- Builtin filtering: builtins don't produce references
- Unwrap rules: Solidity-specific expression forms resolve to correct roots

### 14.2 Integration Tests

End-to-end tests using small Solidity fixture files:

- **Basic scan**: single file → correct nodes, contains edges, resolved refs
- **Import expansion**: file with imports → transitive files parsed, refs resolved
- **Unresolved gaps**: file referencing missing contract → refs with gap annotations
- **Resolution round-trip**: scan → gaps → create resolution CSV → re-scan with
  resolutions → gaps cleared, targets added
- **Stale resolution**: modify source so ref disappears → resolution flagged stale
- **Deep walker precision**: function with multiple calls → each call_expression
  follows exactly its resolved callee
- **Provisional refs**: external call shows in both edges and gaps output
- **Rule execution**: scan + run → expected findings in TOON format
- **TOON output**: verify output parses correctly and matches expected structure

Fixture files live in `tests/solidity/fixtures/` organized by scenario.

### 14.3 Test Discipline

- Every new function or struct gets tests in the same file
- Every bug fix gets a regression test
- Integration tests added for each new CLI command or flag
- Fixture files are minimal — smallest possible Solidity to exercise the feature
- Deep walker site-matching must be tested with multi-call functions to prevent
  regression of the "follows all callees" bug

---

## 15. Open Questions / Known Hurdles

### 15.1 Go Synthetic Containers
Go has no container declaration in the AST. Containers are inferred from method
receiver types (`func (s *Server) Handle()`). The config schema's `ContainerMapping`
assumes a tree-sitter node type for containers. Go needs a custom handler that
creates containers on-the-fly when processing methods.

### 15.2 Rust Impl Blocks
Rust `impl Foo` and `impl Trait for Foo` both map to containers, but the second
form establishes an inheritance-like relationship. The config can capture both as
container types, but the trait→struct relationship needs custom handling.

### 15.3 JavaScript Family
JS/TS/TSX/Flow share most of the grammar but have subtle differences. The TypeScript
codebase uses a shared `JSFamilyAdapter` base class. In Zig, this could be a shared
config with per-variant overrides, or separate configs that share a custom handler.

### 15.4 Lua GC Pressure Under Deep Walks
Every `ast.text()` call copies a string from Zig to Lua's GC heap. For deep rules
walking thousands of nodes, this creates garbage. Mitigations:
- Use LuaJIT (supported by ziglua) for better GC
- Cache text lookups in the bridge (return same Lua string for same byte range)
- Rule authors should prefer `ast.type()` checks (interned strings) over `ast.text()`

### 15.5 Cross-File Tree Lifetime
All parsed trees must stay alive for the duration of a scan (since `ast_node`
references are valid only while the owning `Tree` lives). This means a HashMap of
`file_path → *Tree` kept alive for the scan scope. Memory cost is low — tree-sitter
trees are compact.

### 15.6 Reference Attributes Extensibility
Current spec has `RefAttrs` as a fixed struct with `target_kind`. If new reference
metadata is needed (e.g., call argument types, receiver type info), the struct
needs extension. Consider a `properties` map on references similar to nodes, at
the cost of more allocations.

### 15.7 Storage Pointer Writes and Data Flow Analysis

The symbol graph cannot track state writes through storage pointers. In Solidity,
patterns like EIP-7201 namespaced storage use local variables with `storage`
qualifiers that alias contract state:

```solidity
function withdraw() external {
    MyStorage storage $ = _getStorage();
    $.balance -= amount;  // state write invisible to symbol graph
}
```

The symbol graph correctly reports: "`withdraw` calls `_getStorage()`" and
"`withdraw` has no direct state variable writes." Both are true — but the state
write through `$` is missed entirely.

Resolving this requires **data flow analysis** — a separate layer that tracks
value flow through assignments, return values, and aliases. This is fundamentally
different from symbol resolution:

- **Symbol graph**: which declarations exist and how they relate (calls, contains,
  inherits). Nodes are contract-level declarations.
- **Data flow graph**: how values move through expressions within and across
  function bodies. Tracks locals, aliases, field accesses.

A future data flow layer would *consume* the symbol graph (follow call edges to
resolve interprocedural flow) but maintain its own structures. It would not change
the node/edge model — locals should never become graph nodes (there are too many,
and they're ephemeral).

For now, direct state variable name matches are the limit of `reads`/`writes` edge
resolution. Storage pointer writes are a known blind spot, addressable by a future
data flow pass layered on top of the current architecture.
