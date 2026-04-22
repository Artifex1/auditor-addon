rule = {
    id = "SOL-010",
    name = "state-var-visibility-not-explicit",
    severity = "info",
    type = "map",
    confidence = "issue",
    description = "State variable has no explicit visibility specifier. Add `public`, `private`, or `internal` to make intent clear.",
    languages = {"solidity"},
}

function check()
    local findings = {}

    for _, c in ipairs(graph.get_nodes_by_kind("container")) do
        for _, var_h in ipairs(ast.find_in_container(c.id, "state_variable_declaration")) do
            local has_visibility = false
            for _, ch in ipairs(ast.named_children(var_h)) do
                if ast.type(ch) == "visibility" then
                    has_visibility = true
                    break
                end
            end

            if not has_visibility then
                local name_h = ast.child_by_field(var_h, "name")
                local name = name_h and ast.text(name_h) or ""
                table.insert(findings, {
                    file = ast.file(var_h) or "",
                    line = ast.start_line(var_h) or 0,
                    node_text = name,
                })
            end
        end
    end

    return findings
end
