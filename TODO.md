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

Language config issues (found via real-repo testing):

10. [x] MASM: hangs on real files — fixed by updating tree-sitter-masm grammar submodule (old grammar didn't support `use path` syntax)
11. [x] Compact: config fixed (wrong field names, wrong container types). Grammar patched to add block_comment support — regenerated parser.c with tree-sitter-cli 0.26.7
12. [x] Tolk: 0 calls/imports detected — fixed callee field (`callee` not `function`) and added import_directive mapping
13. [x] JS: missing `function_expression` as callable — added function_expression and generator_function to JS/TS/TSX callable configs
14. [x] Move: functions not contained by module — fixed by making ContainerMapping.body_field optional; null = push unconditionally, pop at node end
15. [x] Java: visibility property includes raw annotation text — fixed via unified unwrap_table (.property context, search_types finds anonymous keyword tokens inside modifiers)
16. [x] C++: callable names include parentheses — fixed via unified unwrap_table (.name context unwraps function_declarator/reference_declarator/pointer_declarator chains)
17. [x] Rust comment density — not a real issue; each `///`/`//!` line is a single `line_comment` node, no over-counting
