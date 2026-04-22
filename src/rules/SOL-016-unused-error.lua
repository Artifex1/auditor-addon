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

    local errors = ast.find_all("error_declaration")
    if #errors == 0 then return findings end

    -- Collect defined errors by name (first locator wins on name collisions).
    local unused = {}
    for _, err_h in ipairs(errors) do
        local name_h = ast.child_by_field(err_h, "name")
        if name_h then
            local name = ast.text(name_h)
            if name and unused[name] == nil then
                unused[name] = {
                    file = ast.file(err_h) or "",
                    line = ast.start_line(err_h) or 0,
                }
            end
        end
    end

    if next(unused) == nil then return findings end

    -- Clear errors referenced via `revert ErrName(...);`
    for _, rv_h in ipairs(ast.find_all("revert_statement")) do
        local err_node = ast.child_by_field(rv_h, "error")
        if err_node then
            local name = ast.text(err_node)
            if name then unused[name] = nil end
        end
    end

    -- Clear errors referenced via call expression (e.g., `if (x) CustomError();`).
    for _, call_h in ipairs(ast.find_all("call_expression")) do
        local func = ast.child_by_field(call_h, "function")
        if func then
            local name = ast.text(func)
            if name then unused[name] = nil end
        end
    end

    for name, loc in pairs(unused) do
        table.insert(findings, {
            file = loc.file,
            line = loc.line,
            node_text = name,
        })
    end

    return findings
end
