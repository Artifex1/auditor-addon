rule = {
    id = "SOL-016",
    name = "unused-error",
    severity = "info",
    type = "scope",
    languages = {"solidity"},
    description = "Custom error defined but never referenced. Dead code or missing revert.",
}

-- { [name] = {file, line} } — error definitions
local errors = {}
-- { [name] = true } — errors seen in revert/require
local used = {}

function enter(node, ctx)
    if node.kind == "error_declaration" then
        local name_node = ast.child_by_field(node.handle, "name")
        if name_node then
            local name = ast.text(name_node)
            errors[name] = { file = ctx.current_file, line = node.line }
        end
    elseif node.kind == "revert_statement" then
        local err_node = ast.child_by_field(node.handle, "error")
        if err_node then
            used[ast.text(err_node)] = true
        end
    end
end

function exit(node, ctx) end

function finalize()
    for name, loc in pairs(errors) do
        if not used[name] then
            report.hit({
                file = loc.file,
                line = loc.line,
                node_text = name,
            })
        end
    end
end
