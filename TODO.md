# TODO

## SAiST Gap Resolution
- **Demand-driven gaps**: Run rules on the gapped symbol table first, let them report which unresolved callees they actually tried to use, then only surface those as actionable gaps for the agent. Avoids resolving gaps that no rule cares about.

## Rules

Already shipped: SOL-001 (unchecked low-level call), SOL-002 (reentrancy / state write after external call).

Legend — on-chain: `[S]` Solidity, `[C]` Cairo, `[Compact]` Compact, `[M]` Move, `[Noir]` Noir, `[Tolk]` Tolk, `[Masm]` Masm. Off-chain: `[R]` Rust, `[C++]` C++, `[Java]` Java, `[Go]` Go, `[TS]` TypeScript, `[JS]` JavaScript, `[TSX]` TSX, `[Flow]` Flow, `[Py]` Python. `[*]` = all 16 languages. Domain: `on-chain` / `off-chain` / `any`.

---

### Security — symbol table required

**BROAD-VISIBILITY** — Functions with overly broad visibility
- `[S, C, M, R, Java, C++]` · `any`
- Public functions never called externally → should be `external`/tighter. Internal functions only called from same container → should be `private`.
- Needs: call graph (callers of each function), visibility, virtual/override flags
- Plan: Post-processing pass over `symbolMap`. For each `public` function, check if any cross-module callee edge points to it; if not, flag. For `internal`, check if all callers share the same `contract`.

**STATE-UPDATE-WITHOUT-EVENT** — Public function modifies state without emitting an event
- `[S, C, M]` · `on-chain`
- Needs: `isStateWrite`, event/emit detection, visibility
- Plan: `PathRule` or function-scoped walker. Detect state write + absence of emit in same function body.

**SHADOW-STATE-VARIABLE** — Local/parameter shadows a state variable
- `[*]` · `any`
- Needs: state variable names from symbol table, local variable names from AST
- Plan: `NarrowRule` on variable declarations. Check if name collides with a state variable in the same container.

**UNUSED-STATE-VARIABLE** — State variable declared but never read or written
- `[*]` · `any`
- Needs: `readsState` / `writesState` across all functions in a contract
- Plan: Post-processing pass. Collect all state variables; subtract those appearing in any function's reads/writes sets. Flag remainder.

**UNUSED-FUNCTION** — Internal/private function never called
- `[*]` · `any`
- Needs: call graph (is any edge pointing to this function?)
- Plan: Post-processing pass. Functions with no incoming edges and non-public visibility are dead code.

**MISSING-ZERO-ADDRESS-CHECK** — Function accepts address param but never validates != address(0)
- `[S, C, M]` · `on-chain`
- Needs: parameter types, function body AST
- Plan: `NarrowRule` on functions with address-typed params. Walk body for `require(param != address(0))` or equivalent. Language-specific address types.

**ARBITRARY-SEND-ETH** — Unprotected function sends ETH to user-controlled address
- `[S]` · `on-chain`
- Needs: call graph, `isExternalCall`, access control modifiers
- Plan: `PathRule`. Phase 1: public function entry with no access-control modifier. Phase 2: `.call{value: ...}` or `.transfer()` to a parameter-derived address.

**DELEGATECALL-TO-ARBITRARY-ADDRESS** — `delegatecall` target derived from user input
- `[S]` · `on-chain`
- Needs: parameter taint tracking (basic)
- Plan: `NarrowRule` detecting `delegatecall` where the target address traces back to a function parameter.

**PRECISION-LOSS-DIV-BEFORE-MUL** — Division before multiplication causing precision loss
- `[S, C, M, R]` · `on-chain`
- Needs: AST expression analysis
- Plan: `NarrowRule`. Detect `(a / b) * c` patterns where division precedes multiplication in the same expression tree.

**UNSAFE-CASTING** — Type cast that can silently truncate or overflow
- `[S, R, C++, Go]` · `any`
- Needs: type information from AST
- Plan: `NarrowRule` on cast expressions. Flag narrowing casts (e.g., `uint256` → `uint128`, `int` → `int8`).

### Security — AST-only

**TX-ORIGIN** — `tx.origin` used for authentication
- `[S]` · `on-chain`
- Plan: `NarrowRule` checking `node.text === 'tx.origin'` on `member_expression` nodes.

**DANGEROUS-STRICT-EQUALITY** — Using `==` on ETH balances or token amounts
- `[S, C, M]` · `on-chain`
- Plan: `NarrowRule` on equality comparisons involving `.balance` or known balance-returning calls.

**MANIPULABLE-RANDOMNESS** — Using `block.timestamp`, `block.prevrandao`, `blockhash` as randomness source
- `[S]` · `on-chain`
- Plan: `NarrowRule` on member access to `block.timestamp`, `block.prevrandao`, `blockhash()`.

**MSG-VALUE-IN-LOOP** — `msg.value` read inside a loop body (double-counted)
- `[S]` · `on-chain`
- Plan: `NarrowRule` detecting `msg.value` inside `for`/`while` body.

**UNCHECKED-TRANSFER** — ERC20 `transfer`/`transferFrom` return value not checked
- `[S]` · `on-chain`
- Plan: `NarrowRule` similar to SOL-001, but specifically for `transfer`/`transferFrom` calls in expression_statement context.

**DELEGATECALL-IN-LOOP** — `delegatecall` inside a loop
- `[S]` · `on-chain`
- Plan: `NarrowRule` detecting `delegatecall` inside `for`/`while` body.

**POSSIBLE-RETURN-BOMB** — External call return data not length-bounded (returndata copy DoS)
- `[S]` · `on-chain`
- Plan: `NarrowRule` on low-level `.call()` where return data is captured without size limit.

**UNSAFE-ABI-ENCODING** — `abi.encodePacked` with dynamic types (hash collision risk)
- `[S]` · `on-chain`
- Plan: `NarrowRule` on `abi.encodePacked` calls where arguments include `string` or `bytes`.

**MISSING-ORACLE-VALIDATION** — Chainlink oracle result used without freshness/validity checks
- `[S]` · `on-chain`
- Plan: `NarrowRule` detecting `latestRoundData()` calls without checks on `updatedAt`, `answeredInRound`, or `answer > 0`.

### Quality — AST-only, mostly shared

**DOUBLE-STATE-READ** — Same state variable read multiple times in one function
- `[S, C, M]` · `on-chain`
- Needs: state variable resolution, per-function read tracking
- Plan: Function-scoped walker. Track reads per storage expression; flag duplicates unless a write intervenes.

**FLOATING-PRAGMA** — Pragma with `^`/`<`/`>` in non-abstract contracts
- `[S]` · `on-chain`
- Plan: `NarrowRule` on `pragma_directive` text. Simple pattern check.

**CONSTANT-NOT-CAP** — Constants not in SCREAMING_SNAKE_CASE
- `[S, R, C, M, Go, C++, Java]` · `any`
- Plan: `NarrowRule` on constant declarations. Regex `^[A-Z0-9_]+$` on name.

**SHADOW-ARGUMENT** — Function parameter shadows another declaration
- `[*]` · `any`
- Plan: `NarrowRule` on parameter declarations. Check for name collisions with container-scoped variables.

**UNINITIALIZED-LOCAL-VARIABLE** — Local variable used before assignment
- `[S, C++, Go]` · `any`
- Plan: `NarrowRule` or function-scoped walker. Detect reads of locals that haven't been assigned.

**VARIABLE-COULD-BE-CONSTANT** — State variable assigned only at declaration and never modified
- `[S, C, M]` · `on-chain`
- Needs: `writesState` across all functions
- Plan: Post-processing pass. If a state variable appears in zero `writesState` sets (and has an initializer), flag.

**VARIABLE-COULD-BE-IMMUTABLE** — State variable assigned only in constructor
- `[S]` · `on-chain`
- Needs: `writesState` per function, constructor identification
- Plan: Post-processing pass. If only the constructor writes to the variable, flag.

---

## Trait Interface Extension Policy

The `LanguageAdapter` trait interface should only grow when a capability is **shared across 3+ languages AND needed by 2+ rules**. Single-language patterns belong in rules as inline AST walks, not in the interface.

**Three tiers for rule capabilities:**

1. **Trait method (interface)** — Add to `LanguageAdapter` when:
   - At least 3 adapters would meaningfully implement it (not return `false`)
   - At least 2 rules depend on it
   - The concept is *semantically the same* across languages (e.g., "writes state" means the same thing in Solidity, Cairo, and Move)
   - Examples: `isStateWrite`, `isExternalCall`, `isStateRead`

2. **Shared utility (helper in BaseAdapter or `src/static/`)** — Use when:
   - The logic is structural/syntactic and language-agnostic (e.g., "is this node inside a loop?", "reverse caller index from callees")
   - Rules pass a tree-sitter node; the utility walks parent chain or symbolMap
   - No per-language override needed — same algorithm everywhere
   - Examples: `isInsideLoop(node)` (walk parent chain for loop node types), `buildCallerIndex(symbolMap)`

3. **Inline AST walk in the rule** — Use when:
   - The pattern is language-specific or only serves one rule (e.g., `tx.origin`, `abi.encodePacked`, `msg.value`, Chainlink oracle patterns)
   - The detection is a simple node type/text check that doesn't warrant interface pollution
   - The rule already specifies `appliesTo: { languages: [Solidity] }` anyway
   - Examples: all Solidity-only AST-pattern rules (TX-ORIGIN, FLOATING-PRAGMA, UNSAFE-ABI-ENCODING, MISSING-ORACLE-VALIDATION, etc.)

**Current gaps by tier:**

| Capability | Tier | Unlocks | Status |
|---|---|---|---|
| Reverse caller index | Utility | BROAD-VISIBILITY, UNUSED-FUNCTION | Not built, ~10 LOC |
| `isInsideLoop(node)` | Utility | MSG-VALUE-IN-LOOP, DELEGATECALL-IN-LOOP, EVENT-IN-LOOP, DOUBLE-STATE-READ | Not built, parent-chain walk |
| `isEmitStatement` | Trait | STATE-UPDATE-WITHOUT-EVENT, EVENT-IN-LOOP | Not implemented (S, C, M all have emit semantics) |
| State variable declarations list | Trait or SymbolEntry | SHADOW-STATE-VARIABLE, UNUSED-STATE-VARIABLE, VARIABLE-COULD-BE-CONSTANT | Not tracked; currently only function symbols in SymbolMap |
| Unresolved callee emission | Adapter fix | Gap detection for all languages | Fixed for Solidity, 12 adapters remaining |
| `isConstructor` | Inline / SymbolEntry flag | VARIABLE-COULD-BE-IMMUTABLE | Solidity-only → inline, or tag in SymbolEntry |
| Parameter types | Inline | MISSING-ZERO-ADDRESS-CHECK, UNSAFE-CASTING | Language-specific type syntax → inline per rule |
| Cast detection | Inline | UNSAFE-CASTING | Different syntax per language → inline |
| Doc comment access | Inline | MISSING-DOCSTRING, LACK-OF-SECURITY-CONTACT | Comment format varies wildly → inline |

### Style/Compliance — low priority, AST-only

**DUPLICATED-IMPORT** — `[*]` · `any` — Same import path appears twice in a file.

**MISSING-DOCSTRING** — `[S, Py, R, JS]` · `any` — Public functions missing doc comments.

**NO-SPDX-LICENSE** — `[S]` · `on-chain` — Missing SPDX-License-Identifier.

**LACK-OF-SECURITY-CONTACT** — `[S]` · `on-chain` — Missing `@custom:security-contact` NatSpec.

**ADDRESS-CODE-CODEHASH** — `[S]` · `on-chain` — Usage of `.code`/`.codehash`/`extcodehash` (informational).

**MAPPING-NO-KEY-NAME** — `[S]` · `on-chain` — Mapping declarations without explicit key names.

**MAGIC-NUMBERS** — `[*]` · `any` — Literal numbers in logic that should be named constants.

**SIMILAR-NAMES** — `[*]` · `any` — Identifiers differing by 1-2 characters (typo risk).

**MULTIPLE-CONTRACTS-PER-FILE** — `[S]` · `on-chain` — More than one contract in a single file.

**EVENT-EMITTED-IN-LOOP** — `[S, C, M]` · `on-chain` — Event emission inside a loop (gas concern).
