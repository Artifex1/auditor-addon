rule = {
    id = "SOL-019",
    name = "variable-could-be-constant-or-immutable",
    severity = "info",
    type = "map",
    confidence = "smell",
    languages = {"solidity"},
    description = "State variable never written could be constant; state variable only written in constructor could be immutable.",
}

function check()
    local findings = {}

    for _, var in ipairs(graph.get_nodes_by_kind("variable")) do
        -- Skip if already immutable (check AST for immutable child)
        local h = ast.node(var.id)
        if h == nil then goto continue end

        local already_immutable = false
        for _, ch in ipairs(ast.named_children(h)) do
            if ast.type(ch) == "immutable" then
                already_immutable = true
                break
            end
        end
        if already_immutable then goto continue end

        -- Check for initializer value
        local has_value = ast.child_by_field(h, "value") ~= nil

        -- Get all state_write edges targeting this variable
        local write_edges = graph.get_incoming_edges(var.id, "state_write")

        if #write_edges == 0 then
            -- No writes: could be constant if it has an initializer
            if has_value then
                table.insert(findings, {
                    file = var.file,
                    line = var.line,
                    node_text = var.name .. ": could be constant",
                })
            end
        else
            -- Check if ALL writes are from constructors
            local all_in_constructor = true
            for _, edge in ipairs(write_edges) do
                local writer = graph.get_node(edge.from)
                if writer == nil or writer.name ~= "constructor_definition" then
                    all_in_constructor = false
                    break
                end
            end
            if all_in_constructor then
                table.insert(findings, {
                    file = var.file,
                    line = var.line,
                    node_text = var.name .. ": could be immutable",
                })
            end
        end

        ::continue::
    end

    return findings
end
