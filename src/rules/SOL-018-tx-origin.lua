rule = {
    id = "SOL-018",
    name = "tx-origin",
    severity = "medium",
    type = "scope",
    confidence = "smell",
    description = "tx.origin used for authorization is vulnerable to phishing attacks. Use msg.sender instead.",
    languages = {"solidity"},
}

function enter_member_expression(node, ctx)
    local h = node.handle
    local obj = ast.child_by_field(h, "object")
    local prop = ast.child_by_field(h, "property")
    if obj == nil or prop == nil then return end
    if ast.text(prop) ~= "origin" then return end
    if ast.text(obj) ~= "tx" then return end

    -- Walk up parents to check if inside an auth context
    local current = h
    for i = 1, 30 do
        current = ast.parent(current)
        if current == nil then break end
        local t = ast.type(current)
        if t == "call_expression" then
            -- Check if require() or assert()
            local fn = ast.child_by_field(current, "function")
            if fn ~= nil then
                local fn_text = ast.text(fn)
                if fn_text == "require" or fn_text == "assert" then
                    report.hit({
                        file = ctx.current_file,
                        line = node.line,
                        node_text = "tx.origin",
                    })
                    return
                end
            end
        elseif t == "if_statement" then
            report.hit({
                file = ctx.current_file,
                line = node.line,
                node_text = "tx.origin",
            })
            return
        elseif t == "function_definition" then
            break
        end
    end
end
