# Solidity AST Gotchas

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
