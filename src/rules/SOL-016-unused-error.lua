rule = {
    id = "SOL-016",
    name = "unused-error",
    severity = "info",
    type = "map",
    confidence = "smell",
    languages = {"solidity"},
    description = "Custom error defined but never referenced. Dead code or missing revert.",
}

function check()
    local findings = {}

    -- Collect all custom error names
    local errors = graph.get_nodes_by_kind("custom_error")
    if #errors == 0 then return findings end

    local error_names = {}
    for _, err in ipairs(errors) do
        error_names[err.name] = err
    end

    -- Scan all callables for revert statements and call expressions using these errors
    for _, fn in ipairs(graph.get_nodes_by_kind("callable")) do
        local fn_h = ast.node(fn.id)
        if not fn_h then goto next_fn end

        -- Check revert statements
        for _, rv_h in ipairs(ast.find(fn_h, "revert_statement")) do
            local err_node = ast.child_by_field(rv_h, "error")
            if err_node then
                local name = ast.text(err_node)
                if name then error_names[name] = nil end
            end
        end

        -- Check call expressions (covers patterns like: if (...) CustomError())
        for _, call_h in ipairs(ast.find(fn_h, "call_expression")) do
            local func = ast.child_by_field(call_h, "function")
            if func then
                local name = ast.text(func)
                if name then error_names[name] = nil end
            end
        end

        ::next_fn::
    end

    -- Report remaining unused errors
    for name, err in pairs(error_names) do
        table.insert(findings, {
            file = err.file,
            line = err.line,
            node_text = name,
        })
    end

    return findings
end
