# Implementation Plan: Unified Reference Model

## Overview
Replace `GraphEdge`, `EdgeGap`, and `PendingRef` with unified `Reference` type.
Add `ContainsEdge` for structural relationships. Update all consumers.

## File-by-file changes

### 1. `src/graph.zig` — Core data model

**Remove:**
- `EdgeKind` enum
- `EdgeAttrs` struct
- `GraphEdge` struct
- `EdgeGap` struct
- `Priority` enum (move into Reference section)
- `PendingRef` struct
- `RefKind` enum (already exists, keep but review)
- `gapId()` function
- `SymbolGraph.edges`, `SymbolGraph.gaps`, `SymbolGraph.pending_refs` fields
- `addEdge()`, `addGap()`, `addPendingRef()`, `lookupGap()`, `removeGap()`
- `getOutgoingEdges()`, `getIncomingEdges()` (replace with ref-based versions)
- `edgeCount()`, `gapCount()`

**Add:**
- `Confidence` enum: `definite`, `probable`, `candidate`
- `ResolvedTarget` struct: `{ node: u64, confidence: Confidence }`
- `CallTargetKind` enum: keep existing
- `RefAttrs` struct: `{ target_kind: ?CallTargetKind }`
- `Reference` struct: `{ id, from, container, kind, target_name, site, targets, attrs, gap, resolved }`
- `ContainsEdge` struct: `{ from: u64, to: u64 }`
- `refId(file, start_byte)` function
- On `SymbolGraph`:
  - `contains: ArrayListUnmanaged(ContainsEdge)` — replaces contains entries in edges
  - `refs: ArrayListUnmanaged(Reference)` — replaces edges + gaps + pending_refs
  - `site_index: AutoHashMapUnmanaged(u64, u32)` — ref.id → index in refs
  - `addContains(from, to)` method
  - `addRef(ref)` method — appends to refs list
  - `buildSiteIndex()` method — populates site_index after resolution
  - `lookupRef(ref_id)` method — O(1) via site_index
  - `getOutgoingRefs(from_id, ?RefKind)` method
  - `getIncomingRefs(target_id, ?RefKind)` method
  - `hasIncomingRefs(target_id, RefKind)` method — for call_chains root finding
  - `getResolvedInheritanceTargets(container_id)` method — for resolveInScope
  - `refCount()`, `gapCount()`, `containsCount()` methods

**Keep:** `NodeKind`, `GraphNode`, `SourceLocator`, `nodeId()`, `lookupNode()`,
`lookupContainerByName()`, `lookupChildByName()`, `getChildren()`, `children_index`

**Update tests:** Rewrite all existing tests to use new types.

### 2. `src/languages/config.zig` — Config types

**Remove:**
- `ResolveAction` union (`.resolved`, `.unhandled`, `.drop`)
- `ResolveHookFn` type (old signature taking PendingRef + *SymbolGraph)

**Add:**
- `ResolveHookFn = *const fn(ref: *graph.Reference, g: *const graph.SymbolGraph) void`
  Hook mutates the reference directly. If it sets `ref.resolved = true`,
  default resolution is skipped. No return value needed.

### 3. `src/languages/solidity.zig` — Solidity resolve hook

**Rewrite `solidityResolveHook`:**
```zig
fn solidityResolveHook(ref: *graph.Reference, g: *const graph.SymbolGraph) void {
    _ = g;
    if (ref.kind != .call) return;
    for (&external_call_methods) |ecm| {
        if (std.mem.eql(u8, ref.target_name, ecm)) {
            // No concrete target, but mark as external + low-priority gap
            ref.attrs = .{ .target_kind = .external };
            ref.gap = .low;
            ref.resolved = true;
            return;
        }
    }
    // Non-external calls: don't set resolved, let default resolution handle it
}
```

### 4. `src/pipeline.zig` — Walk + resolution

**Walk phase changes:**
- `processContainer/Callable/Variable/Modifier/Event`: replace `graph.addEdge(.contains)`
  with `graph.addContains(from, to)`
- `processCallExpression`, `processInheritance`, `processModifierInvocation`,
  `processEmit`, `processWrite`, `processImport`: replace `graph.addPendingRef()`
  with `graph.addRef()` creating a Reference with `resolved = false`,
  `id = refId(file_path, node.startByte())`, proper `site` SourceLocator
- `addPendingRef` helper → `addReference` helper: builds Reference with
  `id = graph.refId(file_path, node.startByte())`

**Import expansion changes:**
- Instead of removing PendingRefs, iterate `graph.refs` for `kind == .import`
  and `resolved == false`. On success: set `ref.targets = [target_file_node_id]`,
  `ref.resolved = true`. On failure: leave unresolved.

**Resolution phase changes:**
- Step 1: iterate refs, handle `.import` (set gap) and `.inheritance` (resolve or gap)
- Step 2: for each remaining unresolved ref:
  - Run resolve_hook if present. If `ref.resolved` after hook, continue.
  - Default resolution via `resolveInScope` → set targets or gap/drop
- After resolution: call `graph.buildSiteIndex()`

**Inheritance chain helpers:**
- `resolveC3`, `resolveSingleChain`, `resolveEmbedded`: change from querying
  `getOutgoingEdges(id, .inherits)` to `graph.getResolvedInheritanceTargets(id)`

### 5. `src/walker.zig` — Deep walker site-based lookup

**`walkAstNodeDeep` changes:**
- When encountering `call_expression_type`, instead of scanning all edges:
  ```zig
  const ref_id = graph.refId(updated_ctx.current_file, child.startByte());
  if (g.lookupRef(ref_id)) |ref| {
      for (ref.targets.items) |target| {
          if (visited.contains(target.node)) continue;
          if (g.lookupNode(target.node)) |callee| {
              // walk callee.ast_node
          }
      }
  }
  ```
- Remove `call_expression_type` parameter from `walkDeep` — the walker checks
  any ref at the current byte position, no need to know the call expression type.
  Actually, keep it: we still need to know which AST node types trigger deep following.

**`WalkContext` changes:** None — stays the same.

### 6. `src/call_chains.zig` — Adapt to refs

**`findRoots`:**
- Replace `g.getIncomingEdges(node.id, .calls, allocator)` with
  `g.hasIncomingRefs(node.id, .call)` — more efficient, no allocation

**`dfs`:**
- Replace `g.getOutgoingEdges(node_id, .calls, allocator)` with
  `g.getOutgoingRefs(node_id, .call)` (returns slice into refs list, no alloc)
- Follow `ref.targets` (may have multiple entries for dispatch)
- Adjust: `edge.to` → `target.node` for each target in ref.targets

### 7. `src/resolution.zig` — CSV format change

**`Resolution` struct:**
- Remove `edge_kind` field (ref carries its own kind)
- `gap_id` → `ref_id`
- Fields: `ref_id, target_file, target_line, target_name`

**`parseCsvLine`:**
- 4 fields instead of 5
- No edge_kind parsing

**`applyResolutions`:**
- Look up reference by ref_id via `graph.lookupRef(ref_id)`
- Check `ref.gap != null` (if no gap, it's stale — this ref wasn't a gap)
- Compute `nodeId(target_name, target_file, target_line)`, look up node
- Add `ResolvedTarget{ .node = target_id, .confidence = .definite }` to ref.targets
- Clear `ref.gap = null`
- Rebuild site_index if needed (targets changed)

### 8. `src/output.zig` — Format changes

**`writeToonGaps` / `writeJsonGaps`:**
- Iterate `g.refs`, filter `ref.gap != null`
- Output: `ref_id, from_name (lookup node), target_name, kind, file, line, priority`

**`writeToonGraph` / `writeJsonGraph`:**
- Nodes section: unchanged
- Replace edges section with `contains` + `refs` sections
- Contains: `{from, to}` rows
- Refs: `{ref_id, from, kind, target_name, targets, site_line, gap}` rows

### 9. `src/main.zig` — Minimal changes

- `cmdGaps`: passes `&pipe.graph` to output functions (same)
- `cmdGraph`: passes `&pipe.graph` to output functions (same)
- `cmdCallChains`: passes `&pipe.graph` to call_chains (same)
- Resolution application: calls updated `resolution.applyResolutions`

### 10. `src/rules/SOL-002-reentrancy.lua` — Update rule

- Replace `graph.get_outgoing_edges` + line matching with `graph.get_ref_at`

## Implementation order

1. **graph.zig** — new types + SymbolGraph methods (everything else depends on this)
2. **config.zig** — new ResolveHookFn signature
3. **solidity.zig** — adapt resolve hook
4. **pipeline.zig** — walk + resolution (biggest change)
5. **walker.zig** — site-based deep walker
6. **call_chains.zig** — adapt to refs
7. **resolution.zig** — new CSV format + apply logic
8. **output.zig** — new formatting
9. **main.zig** — wire it all together
10. **SOL-002-reentrancy.lua** — update rule
11. **Tests** — comprehensive test suite

## Key invariants to test

- `refId(file, byte)` is deterministic and collision-free for different bytes
- A reference starts `resolved = false`, transitions to `resolved = true` exactly once
- `targets` and `gap` are orthogonal (can have both, either, or neither)
- `site_index` maps every ref.id to its position in refs list
- Deep walker at byte X follows exactly the target(s) of the ref at byte X
- Two calls to `transfer()` in the same function produce different ref_ids
- Resolution file round-trip: gap output → CSV → apply → gap cleared
- Provisional refs (target + gap) appear in both edges queries and gaps output
