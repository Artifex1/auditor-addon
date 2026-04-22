rule = {
    id = "SOL-020",
    name = "unchecked-transfer",
    severity = "high",
    type = "scope",
    confidence = "smell",
    languages = {"solidity"},
    description = "ERC-20 .transfer() and .transferFrom() return a bool. Discarding the return value means failed transfers go unnoticed.",
}

local TRANSFER = { transfer = true, transferFrom = true }

local function unwrap(h)
    if h and ast.type(h) == "expression" then
        local kids = ast.named_children(h)
        return kids[1]
    end
    return h
end

function enter_call_expression(node, ctx)
    local h = node.handle
    local fn_inner = unwrap(ast.child_by_field(h, "function"))
    if fn_inner == nil then return end
    if ast.type(fn_inner) ~= "member_expression" then return end

    local prop = ast.child_by_field(fn_inner, "property")
    if prop == nil then return end
    if not TRANSFER[ast.text(prop)] then return end

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
