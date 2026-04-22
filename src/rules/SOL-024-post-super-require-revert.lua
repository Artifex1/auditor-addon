rule = {
    id = "SOL-024",
    name = "post-super-require-revert",
    severity = "high",
    confidence = "pointer",
    type = "scope",
    description = "require() after super.<fn>() in same function — revert silently undoes base contract state transitions",
    languages = {"solidity"},
}

-- Per-function tracking: whether we have passed a super.X() call.
local seen_super_call = false

-- The `function` field of a call_expression is wrapped in an `expression` node.
-- Unwrap it to reach the actual identifier / member_expression.
local function unwrap_fn(call_handle)
    local fn = ast.child_by_field(call_handle, "function")
    if not fn then return nil end
    -- If the node is an expression wrapper, descend to its first named child.
    if ast.type(fn) == "expression" then
        local children = ast.named_children(fn)
        if #children > 0 then return children[1] end
    end
    return fn
end

function enter_function_definition(node, ctx)
    seen_super_call = false
end

function exit_function_definition(node, ctx)
    seen_super_call = false
end

function enter_call_expression(node, ctx)
    local inner = unwrap_fn(node.handle)
    if not inner then return end

    local inner_type = ast.type(inner)

    -- Detect super.someFunction(...) calls.
    if not seen_super_call and inner_type == "member_expression" then
        local obj = ast.child_by_field(inner, "object")
        if obj and ast.text(obj) == "super" then
            seen_super_call = true
        end
        return
    end

    -- After a super call, flag any require().
    if seen_super_call and inner_type == "identifier" and ast.text(inner) == "require" then
        report.hit({
            file = ctx.current_file,
            line = node.line,
            node_text = ast.text(node.handle) or "",
        })
    end
end
