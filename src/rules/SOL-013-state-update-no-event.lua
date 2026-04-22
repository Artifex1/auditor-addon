rule = {
    id = "SOL-013",
    name = "state-update-no-event",
    severity = "medium",
    type = "deep",
    max_depth = 3,
    confidence = "smell",
    languages = {"solidity"},
    description = "External/public functions that modify state without emitting an event in their call flow.",
}

local write_call_methods = { push = true, pop = true }

local function function_body_writes_state(fn_h)
    -- assignment_expression / augmented_assignment_expression / delete_statement
    for _, t in ipairs({"assignment_expression", "augmented_assignment_expression", "delete_statement"}) do
        if #ast.find(fn_h, t) > 0 then return true end
    end
    -- .push / .pop calls on any receiver
    for _, call_h in ipairs(ast.find(fn_h, "call_expression")) do
        local callee = ast.child_by_field(call_h, "function")
        if callee then
            local name = ast.unwrap(callee, "callee")
            if name and write_call_methods[name] then return true end
        end
    end
    return false
end

local has_emit = false
local entry_fn = nil
local entry_has_writes = false

function enter(node, ctx)
    if ctx.depth == 0 and node.kind == "function_definition" then
        has_emit = false
        entry_fn = nil
        entry_has_writes = false

        local gn = graph.get_node(ctx.current_node)
        if gn then
            local vis = graph.get_property(gn.id, "visibility")
            if (vis == "public" or vis == "external") and gn.name ~= "constructor" then
                entry_fn = gn
                entry_has_writes = function_body_writes_state(node.handle)
            end
        end
    end

    if not entry_fn then return end

    if node.kind == "emit_statement" then
        has_emit = true
    end
end

function exit(node, ctx)
    if ctx.depth == 0 and node.kind == "function_definition" then
        if entry_fn and entry_has_writes and not has_emit then
            report.hit({
                file = entry_fn.file,
                line = entry_fn.line,
                node_text = entry_fn.name,
            })
        end
        entry_fn = nil
    end
end
