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

function enter_function_definition(node, ctx)
    if ctx.depth ~= 0 then return end
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
end

function exit_function_definition(node, ctx)
    if ctx.depth == 0 then
        entry_container_id = nil
    end
end

function enter_call_expression(node, ctx)
    if not entry_container_id or seen_external_call then return end
    local ref = graph.ref_at(node.handle)
    if ref and ref.target_kind == "external" then
        seen_external_call = true
    end
end

local function check_write(node, ctx)
    if not entry_container_id or not seen_external_call then return end
    local name = state_var_name(node.handle, entry_container_id)
    if name then
        report.hit({
            file = ctx.current_file,
            line = node.line,
            node_text = name,
        })
    end
end

function enter_assignment_expression(node, ctx) check_write(node, ctx) end
function enter_augmented_assignment_expression(node, ctx) check_write(node, ctx) end
