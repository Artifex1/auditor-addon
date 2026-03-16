---
name: rule-authoring
description: Writing SAiST static analysis rules — both shipped rules in the auditor-addon repo and custom per-engagement rules in audit workspaces. Use when the user wants to create a new detection rule, add a security check, implement a code smell detector, turn a confirmed finding into a reusable rule, or extend the rule set. Covers rule types (shallow, deep, MapRule), the trait system, language scoping, finding kinds, custom rules, and testing patterns.
argument-hint: "<rule idea or vulnerability pattern>"
---

# Rule Authoring

Rules live in two places:

- **Shipped rules** (`src/static/rules/`): part of auditor-addon, run for every scan. IDs use standard prefixes: `SOL-`, `GEN-`, `MAP-`.
- **Custom rules** (any `.ts` file): per-engagement rules in the audit workspace. IDs **must** use the `CUSTOM-` prefix. Loaded via `customRulePaths` on `sast_run_rules`.

Both use the same interfaces. Each rule is a single `.ts` file that default-exports a `Rule` or `MapRule` object.

## Choosing a Rule Type

### Shallow Rule (`Rule` without `deep`)

Walks every AST node in every file. Use for patterns detectable within a single function or file without following call edges.

```typescript
enter(node: Node, ctx: RuleContext): void   // pre-order DFS
exit(node: Node, ctx: RuleContext): void    // post-order DFS
finalize(ctx: RuleContext): FindingInstance[]
reset(): void
```

**Use when:** The pattern is visible in a single function body — node type checks, operator patterns, modifier presence. Examples: SOL-011 (div before mul), SOL-006 (floating pragma), SOL-023 (malformed modifier).

### Deep Rule (`Rule` with `deep: { maxDepth: N }`)

Same interface but the walker follows call edges across function boundaries. `depth` increments at each function transition, not each AST level.

**Use when:** The pattern spans multiple functions — e.g. external call in callee followed by state write in caller. Example: SOL-002 (reentrancy, `deep: { maxDepth: 6 }`).

### MapRule

Runs once against the completed `SymbolMap` after all files are processed. No AST traversal — operates on `SymbolEntry` metadata.

```typescript
check(symbolMap: SymbolMap, ctx: RuleContext): FindingInstance[]
```

**Use when:** The detection requires cross-function or cross-file reasoning over the symbol table — caller counts, visibility analysis, state variable usage patterns. Examples: MAP-001 (broad visibility), MAP-002 (unused function), SOL-017 (variable could be constant).

## Rule Structure

```typescript
import { SupportedLanguage } from "../../engine/types.js";
import type { Rule, FindingInstance, RuleContext } from "../../engine/types.js";
import type { Node } from "web-tree-sitter";

function createRule(): Rule {
    let findings: FindingInstance[] = [];

    return {
        id: 'SOL-NNN',
        severity: 'medium',              // critical | high | medium | low | info
        title: 'Short label',
        description: 'What it detects and why it matters.',
        kind: 'smell',                   // issue | smell | pointer
        appliesTo: {
            languages: [SupportedLanguage.Solidity],
            domains: ['on-chain'],       // optional: 'on-chain' | 'off-chain'
        },

        enter(node: Node, ctx: RuleContext) {
            // pattern detection logic
        },

        finalize() { return findings; },
        reset() { findings = []; },
    };
}

export default createRule();
```

## The Trait System (`ctx.trait`)

Rules are language-agnostic through `ctx.trait` — the `LanguageAdapter` for the current language. Use trait methods instead of hardcoding node types:

| Trait method | Returns | Use for |
|---|---|---|
| `isFunctionDef(node)` | boolean | Detecting function boundaries |
| `isExternalCall(node)` | boolean | External/cross-contract calls |
| `isStateWrite(node)` | boolean | Storage mutations |
| `isStateRead(node)` | boolean | Storage reads |
| `isPublicFn(node)` | boolean | Public/external visibility |
| `isEmitStatement(node)` | boolean | Event emissions |
| `getFunctionName(node)` | string? | Extracting function name |
| `getCallTarget(node)` | string? | Extracting call target |

**When to use traits vs direct node types:** Use traits for concepts that exist across languages (function def, state write, external call). Use direct `node.type` checks for language-specific syntax (`modifier_definition`, `pragma_directive`).

## Solidity AST Gotchas

The Solidity tree-sitter grammar wraps sub-expressions in `expression` nodes. Key patterns:

- `childForFieldName('left')` returns `expression`, not the inner node — unwrap with helper
- `call_expression` arguments are `call_argument` children, not an `arguments` field
- `if_statement` condition: `childForFieldName('condition')` returns `expression` wrapper
- `receive()` is `fallback_receive_definition`, not `function_definition` (but `isFunctionDef` handles it)
- Assignments inside `statement > expression_statement > expression > assignment_expression`

```typescript
function unwrapExpression(node: Node): Node {
    if (node.type === 'expression' && node.childCount === 1)
        return unwrapExpression(node.child(0)!);
    return node;
}
```

## Language Scoping

### Naming Convention

- **SOL-NNN**: Solidity-specific rules
- **GEN-NNN**: Multi-language rules (no single-language filter)
- **MAP-NNN**: MapRules (post-processing over SymbolMap)

### `appliesTo` — always explicit

```typescript
appliesTo: {
    languages: [SupportedLanguage.Solidity, SupportedLanguage.Cairo],
    domains: ['on-chain'],           // optional
    inheritanceModels: ['classical'], // optional
}
```

Never use empty `appliesTo: {}` — that matches everything. List supported languages explicitly. Only include languages whose grammar you have verified.

## Finding Kinds

| Kind | When to use |
|---|---|
| `issue` | High confidence — confirmed defect pattern |
| `smell` | Medium confidence — likely problem, anti-pattern |
| `pointer` | Low confidence — structural pattern historically linked to bugs |

**Design principle:** All three kinds must have a **syntactic** anchor — a structural AST pattern. If detection requires understanding what a variable *means* (name-matching heuristics like "fee", "onBehalf"), it belongs to the agent, not a rule.

Acceptable vocabulary: well-known library functions (`mulFloor`, `mulDiv`), standards (`TYPEHASH` for EIP-712), language keywords. Not acceptable: arbitrary naming conventions.

## Custom Rules (Per-Engagement)

Custom rules let auditors codify a pattern found during an audit and immediately test it against the codebase. The flywheel:

1. **Find an issue** during manual review or agent analysis
2. **Recognize it's a pattern** — could it appear elsewhere in this codebase, or in future audits?
3. **Write a custom rule** in the audit workspace (e.g. `./rules/CUSTOM-001-unbounded-loop.ts`)
4. **Test against the known instance** — the rule should flag the exact location where you found the issue
5. **Run against the full codebase** — discover other instances of the same pattern
6. **Promote if reusable** — if the pattern is general enough, move it to shipped rules with a standard ID

### Custom Rule Example

```typescript
// ./rules/CUSTOM-001-unbounded-loop.ts
import type { Rule, FindingInstance, RuleContext } from "auditor-addon/engine/types";
import type { Node } from "web-tree-sitter";

function createRule(): Rule {
    let findings: FindingInstance[] = [];
    return {
        id: 'CUSTOM-001',  // MUST use CUSTOM- prefix
        severity: 'high',
        title: 'Unbounded loop over user-controlled array',
        description: 'A for-loop iterates over a storage array with no upper bound. An attacker can grow the array to cause out-of-gas reverts.',
        kind: 'smell',
        appliesTo: { languages: [/* ... */] },
        enter(node: Node, ctx: RuleContext) { /* ... */ },
        finalize() { return findings; },
        reset() { findings = []; },
    };
}
export default createRule();
```

### Running Custom Rules

```
sast_run_rules({
  scanId: "abc123",
  customRulePaths: ["./rules/CUSTOM-001-unbounded-loop.ts"],
})
```

Custom rules run alongside shipped rules. Use `ruleIds` filter to run only custom rules if needed.

## Testing

One test file per rule: `tests/languages/<lang>/rules/<RULE-ID>.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';      // shallow/deep
import { buildContext, runMapRule } from './helpers.js';    // MapRule
import rule from '../../../../src/static/rules/SOL-NNN-name.js';

describe('SOL-NNN: Rule title', () => {
    it('flags the pattern', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    // ... code that triggers the rule
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag the safe variant', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    // ... code that should NOT trigger the rule
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
```

**Helpers:** `buildContext(sources)` → `{ ctx, symbolMap }`, `runRule(ctx, file, rule)`, `runMapRule(ctx, symbolMap, rule)`, `runDeepRuleOnFunction(ctx, symbolMap, funcLabel, rule)`.

Multi-language rules: add a test file in each affected language's `tests/languages/<lang>/rules/` folder.

Run: `npx vitest run tests/languages/<lang>/rules/<RULE-ID>`
