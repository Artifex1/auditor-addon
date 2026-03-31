High — Core functionality:

1. [x] Only Solidity config exists — 14 other languages fall back to Solidity config (wrong node types)
2. [x] No shipped rules — no rules/ directory, aa run requires explicit --rule-path
3. [x] --rule=<ID> filter not implemented — TODO in main.zig
4. [x] JSON findings output stubbed — hardcoded {"findings":[]}

Medium — Spec divergence:

5. [x] Deep walker doesn't follow has_modifier edges — modifier bodies not walked (we removed this during the rewrite)
6. [x] Inheritance resolution strategy not implemented — C3 linearization, embedded promotion etc. all use naive arbitrary-order walk

Low — Deferred by design:

7. [] aa diff / aa diff-metrics — spec explicitly defers these

Spec needs updating (implementation intentionally diverged):

8. [x] Walker §5.1/§5.2 — spec still describes per-callable walks, we now do full-file walks
9. [x] reset() — spec may still reference it, we removed it

Shipped rules — next batch (priority order):

18. [x] MAP-001 broad-visibility: public callables with no cross-container callers → could be external (56 reported)
20. [x] SOL-011 div-before-mul: binary_expression(*) whose left subtree contains (/), precision loss (26 reported)
21. [x] GEN-002 duplicated-import: same import path seen twice in a file, multi-language (16 reported)
22. [x] GEN-001 constant-not-cap: constant/immutable not UPPER_CASE, multi-language (15 reported)
23. [x] SOL-015 no-spdx: source file missing SPDX-License-Identifier comment (6 reported)
24. [x] SOL-001 unchecked-call: .call/.send/.delegatecall return value discarded

Shipped rules — second tier (implement after batch above):

19. [x] MAP-002 unused-function: internal/private callables with zero callers (13 reported)
26. [x] SOL-016 unused-error: custom error defined but never used in revert (33 reported) — MAP rule
27. [x] SOL-017 unused-event: event defined but never emitted (14 reported) — MAP rule
28. [x] SOL-013 state-update-no-event: state write with no corresponding event emit (20 reported)
29. [x] SOL-018 tx-origin: tx.origin used inside require/if/assert condition (auth pattern)

Shipped rules — skip/defer (reasons noted):

- SOL-005 unchecked-transfer: transfer()/transferFrom() by name = agent territory (name-matching)
- SOL-017/018 variable-could-be-constant/immutable: require full constructor-path analysis
- double-state-read: gas optimization, deferred
- missing-zero-address-check: needs type inference
- unused-imports: needs import resolution

Language config issues (found via real-repo testing):

10. [x] MASM: hangs on real files — fixed by updating tree-sitter-masm grammar submodule (old grammar didn't support `use path` syntax)
11. [x] Compact: config fixed (wrong field names, wrong container types). Grammar patched to add block_comment support — regenerated parser.c with tree-sitter-cli 0.26.7
12. [x] Tolk: 0 calls/imports detected — fixed callee field (`callee` not `function`) and added import_directive mapping
13. [x] JS: missing `function_expression` as callable — added function_expression and generator_function to JS/TS/TSX callable configs
14. [x] Move: functions not contained by module — fixed by making ContainerMapping.body_field optional; null = push unconditionally, pop at node end
15. [x] Java: visibility property includes raw annotation text — fixed via unified unwrap_table (.property context, search_types finds anonymous keyword tokens inside modifiers)
16. [x] C++: callable names include parentheses — fixed via unified unwrap_table (.name context unwraps function_declarator/reference_declarator/pointer_declarator chains)
17. [x] Rust comment density — not a real issue; each `///`/`//!` line is a single `line_comment` node, no over-counting
