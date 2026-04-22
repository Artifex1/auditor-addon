rule = {
    id = "SOL-002",
    name = "reentrancy",
    severity = "critical",
    type = "deep",
    max_depth = 5,
    confidence = "smell",
    description = "State changes after external calls violate checks-effects-interactions.",
    languages = {"solidity"},
}

local state_write_kinds = {
    assignment_expression = true,
    augmented_assignment_expression = true,
    delete_statement = true,
}

local function state_var_name(node_h, container_id)
    local ids = ast.find(node_h, "identifier")
    if #ids == 0 then return nil end
    local name = ast.text(ids[1])
    if not name then return nil end
    if graph.find_in_scope(container_id, name, "state_variable_declaration") then
        return name
    end
    return nil
end

local seen_external_call = false
local entry_container_id = nil

function enter(node, ctx)
    if node.kind == "function_definition" and ctx.depth == 0 then
        seen_external_call = false
        entry_container_id = nil
        local gn = graph.get_node(ctx.current_node)
        if gn then
            local vis = graph.get_property(gn.id, "visibility")
            if vis == "public" or vis == "external" then
                local parent = graph.get_parent(gn.id)
                if parent then entry_container_id = parent.id end
            end
        end
        return
    end

    if not entry_container_id then return end

    if not seen_external_call and node.kind == "call_expression" then
        local ref = graph.ref_at(node.handle)
        if ref and ref.target_kind == "external" then
            seen_external_call = true
        end
        return
    end

    if seen_external_call and state_write_kinds[node.kind] then
        local name = state_var_name(node.handle, entry_container_id)
        if name then
            report.hit({
                file = ctx.current_file,
                line = node.line,
                node_text = name,
            })
        end
    end
end

function exit(node, ctx)
    if node.kind == "function_definition" and ctx.depth == 0 then
        entry_container_id = nil
    end
end
