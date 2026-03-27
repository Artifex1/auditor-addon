-- Rule: detect function_definition nodes without a visibility child.
-- Scope rule — walks AST nodes within each callable.

rule = {
    id = "TEST-001",
    name = "missing-visibility",
    severity = "warning",
    type = "scope",
    description = "Detects functions without explicit visibility modifier",
}

function reset()
end

function enter(node, ctx)
    if node.kind == "function_definition" then
        -- Check for visibility child using ast.find
        local handle = node.handle
        local children = ast.children(handle)
        local has_visibility = false
        for _, child_handle in ipairs(children) do
            if ast.type(child_handle) == "visibility" then
                has_visibility = true
                break
            end
        end
        if not has_visibility then
            report.hit({
                file = ctx.current_file,
                line = node.line,
                node_text = ast.text(handle),
            })
        end
    end
end

function exit(node, ctx)
end
