High — Core functionality:

1. [x] Only Solidity config exists — 14 other languages fall back to Solidity config (wrong node types)
2. [x] No shipped rules — no rules/ directory, aud run requires explicit --rule-path
3. [x] --rule=<ID> filter not implemented — TODO in main.zig
4. [x] JSON findings output stubbed — hardcoded {"findings":[]}

Medium — Spec divergence:

5. [x] Deep walker doesn't follow has_modifier edges — modifier bodies not walked (we removed this during the rewrite)
6. [x] Inheritance resolution strategy not implemented — C3 linearization, embedded promotion etc. all use naive arbitrary-order walk

Low — Deferred by design:

7. [] aud diff / aud diff-metrics — spec explicitly defers these

Spec needs updating (implementation intentionally diverged):

8. [x] Walker §5.1/§5.2 — spec still describes per-callable walks, we now do full-file walks
9. [x] reset() — spec may still reference it, we removed it

Shipped rules — next batch (priority order):

18. [x] SOL-022 broad-visibility: public callables with no cross-container callers → could be external (56 reported)
20. [x] SOL-011 div-before-mul: binary_expression(*) whose left subtree contains (/), precision loss (26 reported)
21. [x] GEN-002 duplicated-import: same import path seen twice in a file, multi-language (16 reported)
22. [x] GEN-001 constant-not-cap: constant/immutable not UPPER_CASE, multi-language (15 reported)
23. [x] SOL-015 no-spdx: source file missing SPDX-License-Identifier comment (6 reported)
24. [x] SOL-001 unchecked-call: .call/.send/.delegatecall return value discarded

Shipped rules — second tier (implement after batch above):

19. [x] SOL-023 unused-function: internal/private callables with zero callers (13 reported)
26. [x] SOL-016 unused-error: custom error defined but never used in revert (33 reported) — MAP rule
27. [x] SOL-017 unused-event: event defined but never emitted (14 reported) — MAP rule
28. [x] SOL-013 state-update-no-event: state write with no corresponding event emit (20 reported)
29. [x] SOL-018 tx-origin: tx.origin used inside require/if/assert condition (auth pattern)

Shipped rules — implemented (previously deferred):

30. [x] SOL-020 unchecked-transfer: .transfer()/.transferFrom() return value discarded
31. [x] SOL-019 variable-could-be-constant-or-immutable: no writes = constant, constructor-only writes = immutable
32. [x] SOL-021 double-state-read: same state var read twice in a function (gas optimization)
33. [x] GEN-003 unused-import: named import symbol never referenced in file

Shipped rules — skip/defer (reasons noted):

- missing-zero-address-check: needs type inference

Bugs found during Uniswap V2 scan:

34. [x] Import resolution: resolveImportPath tries raw path relative to cwd instead of relative to importing file's directory — all relative imports fail
35. [x] abi.decode builtin filtering: tree-sitter-solidity member_expression precedence bug — patched grammar (prec.dynamic(1) → prec.left(POSTFIX_UNARY))
36. [x] Resolution backfill: applyResolutions never set ref.resolved = true — CSV-resolved refs were invisible to get_callers/get_incoming_edges/get_outgoing_edges
37. [x] Solidity builtin_functions missing ecrecover, addmod, mulmod, blockhash
38. [] `using X for Y` resolution: Solidity library calls via `using SafeMath for uint256` are not resolved — requires tracking using-directives and matching method calls on the target type to library functions
39. [] SOL-002 reentrancy: Lua enter() hook throws because the rule uses `node.start_byte`, but `pushAstNodeTable` only populates `{kind, line, file, name, handle}`. No current Lua API converts an AST node back to a graph ref (neither `ast.start_byte` nor `graph.get_ref_at` exist — both were removed as speculative). Real fix: add `ast.ref_for(handle)` that does tree-pointer → file → ref-scan internally, then rewrite SOL-002 to call it. Alternative: keep SOL-002 syntactic (any call → potential external, pointer confidence) per the reentrancy example in `skills/rule-authoring/SKILL.md`.
40. [] SPEC.md post-graph-minimalism sweep: 28 references to removed kinds (`state_read`, `state_write`, `modifier_use`, `event_emit`) across §3 (NodeKind/RefKind enums), §4 (pipeline), §5 (resolver), §15 (gap policy), §16 (resolutions.csv example). Needs a coordinated rewrite: reduce NodeKind to {file, container, callable}, RefKind to {import, call, inheritance, using_for}; delete gap-policy rows for removed kinds; update §4 pipeline pseudocode to drop variable/modifier/event/error/type_def dispatch; add a §X "Graph Minimalism" section explaining the split (graph = callgraph skeleton; everything else = AST-query). Scoped separately from the skill docs because SPEC is an internal design reference and changes don't affect users outside the repo.

Language config issues (found via real-repo testing):

10. [x] MASM: hangs on real files — fixed by updating tree-sitter-masm grammar submodule (old grammar didn't support `use path` syntax)
11. [x] Compact: config fixed (wrong field names, wrong container types). Grammar patched to add block_comment support — regenerated parser.c with tree-sitter-cli 0.26.7
12. [x] Tolk: 0 calls/imports detected — fixed callee field (`callee` not `function`) and added import_directive mapping
13. [x] JS: missing `function_expression` as callable — added function_expression and generator_function to JS/TS/TSX callable configs
14. [x] Move: functions not contained by module — fixed by making ContainerMapping.body_field optional; null = push unconditionally, pop at node end
15. [x] Java: visibility property includes raw annotation text — fixed via unified unwrap_table (.property context, search_types finds anonymous keyword tokens inside modifiers)
16. [x] C++: callable names include parentheses — fixed via unified unwrap_table (.name context unwraps function_declarator/reference_declarator/pointer_declarator chains)
17. [x] Rust comment density — not a real issue; each `///`/`//!` line is a single `line_comment` node, no over-counting


Audit

3. ast.* Lua wrappers: 6+ identical skeletons. luaAstStartLine/EndLine/StartByte/EndByte/IsNamed/File/etc. all follow: handle intCast → call bridge → pushInteger/pushBoolean/pushString/pushNil. A small pushBridgeResult(lua, handle, bridge_fn) generic collapses them. Low urgency, but every new accessor adds another copy today.

Future-proofing with concrete triggers

4. Reference.{gap, resolved, targets} three-way state. Verified independently variable: tests at graph.zig:844-872 construct refs with
gap=high, resolved=true, targets=non-empty — all three coexist. Trigger: the next state flag (e.g. external=true, stub=true, ambiguous=true)
  will force another cross-check across every ref.resolved and ref.hasTargets() gate (6 sites). Consider a tagged union ResolutionState =
{unresolved_gap: Priority, resolved: []u64, external} — but only when the next state flag actually appears.
5. inheritance_strategy lives on SymbolGraph. Breaks on mixed-language scans (a Solidity + Cairo pipeline can't hold two different
strategies). Trigger: first multi-language gaps/run invocation. Fix when it matters: move onto GraphNode.language → config lookup, not
graph-global.
6. nodeFromGraph dead g parameter. ast_bridge.zig:51 takes g: *const SymbolGraph but self.g holds the same pointer; the single caller
(lua_adapter.zig:856) passes g_graph which is what bridge.init(allocator, &g_graph) already captured. Drop the parameter.
7. pushUniquePropertyKeys hardcoded seen: [32][]const u8. 33rd key is silently dropped. Trigger: any language config growing its properties
list past 32. Move to std.ArrayList or at least assert.

Style / tightness nits (collapsed)

- getOutgoingRefs vs getAllRefsFrom differ only by the ref.resolved gate — collapse to one fn with a require_resolved: bool arg. Fine as-is,
  minor duplication.
- resolveInScope vs resolveInParentsOnly — latter is a 2-line wrapper over resolveInParents, fine but arguably inlineable.
- lookupRef vs lookupRefMut — standard const/mut pair, fine.
- Reference.ast_node: ?ts.Node — tree-sitter leaks into the graph model. Not breaking anything today; worth noting if you ever want the
graph serialisable.
- Many catch return 0 in Lua wrappers swallow errors silently. Fine for hot paths; worth a diagnostic route if rule-authoring ramps up.
- executeVisitorRule takes non-optional lang_config; executeMapRule takes optional. Minor asymmetry, no harm.
- Mutable globals (g_graph, g_bridge, g_allocator, g_hits, g_diag, g_lang_config, g_lua, g_hook_warned) reset per-rule-execution. Forced by
zlua's C-callback shape; not a real issue until concurrent rule execution becomes a goal, then pack into an ExecContext stashed in Lua
registry.

Worth verifying (didn't grep exhaustively): whether any ref queries ever get slow — getOutgoingRefs and friends are linear over
self.refs.items. If scans start touching 10k+ refs, add a from_index: AutoHashMap(u64, []u32) reverse index.
