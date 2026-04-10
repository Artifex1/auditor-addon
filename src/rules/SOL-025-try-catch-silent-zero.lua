rule = {
    id = "SOL-025",
    name = "try-catch-silent-zero-return",
    severity = "medium",
    confidence = "pointer",
    type = "scope",
    description = "try/catch returns literal zero on failure — external call errors silently degrade functionality",
    languages = {"solidity"},
}

function enter(node, ctx)
    if node.kind ~= "try_statement" then return end

    local catches = ast.find(node.handle, "catch_clause")
    for _, catch_node in ipairs(catches) do
        local returns = ast.find(catch_node, "return_statement")
        for _, ret in ipairs(returns) do
            -- Check whether the returned expression is a literal zero.
            local exprs = ast.find(ret, "number_literal")
            for _, num in ipairs(exprs) do
                if ast.text(num) == "0" then
                    report.hit({
                        file = ctx.current_file,
                        line = ast.start_line(ret),
                        node_text = ast.text(node.handle) or "",
                    })
                    return  -- one hit per try_statement is enough
                end
            end
        end
    end
end
