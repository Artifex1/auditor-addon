rule = {
    id = "SOL-001",
    name = "unchecked-call",
    severity = "high",
    type = "scope",
    confidence = "smell",
    languages = {"solidity"},
    description = "Low-level .call(), .send(), and .delegatecall() return a bool success flag. Discarding it silently swallows reverts.",
}

local LOW_LEVEL = { call = true, send = true, delegatecall = true }

-- Solidity grammar wraps sub-expressions in `expression` nodes.
local function unwrap(h)
    if h and ast.type(h) == "expression" then
        local kids = ast.named_children(h)
        return kids[1]
    end
    return h
end

function enter(node, ctx)
    if node.kind ~= "call_expression" then return end

    local h = node.handle
    local fn_inner = unwrap(ast.child_by_field(h, "function"))
    if fn_inner == nil then return end
    if ast.type(fn_inner) ~= "member_expression" then return end

    local prop = ast.child_by_field(fn_inner, "property")
    if prop == nil then return end
    if not LOW_LEVEL[ast.text(prop)] then return end

    -- The return value is discarded when the call_expression sits inside
    -- expression > expression_statement (Solidity wraps in expression node).
    local parent = ast.parent(h)
    local grandparent = parent and ast.parent(parent) or nil
    if grandparent == nil then return end
    if ast.type(grandparent) ~= "expression_statement" then return end

    report.hit({
        file = ctx.current_file,
        line = node.line,
        node_text = ast.text(prop),
    })
end

function exit(node, ctx) end
