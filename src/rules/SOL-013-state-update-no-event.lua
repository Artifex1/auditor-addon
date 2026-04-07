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

local has_emit = false
local entry_fn = nil
local entry_has_writes = false

function enter(node, ctx)
    -- At depth 0: entering a new top-level function scope
    if ctx.depth == 0 and node.kind == "function_definition" then
        has_emit = false
        entry_fn = nil
        entry_has_writes = false

        -- Only flag public/external entry points
        local gn = graph.get_node(ctx.current_node)
        if gn then
            local vis = graph.get_property(gn.id, "visibility")
            if (vis == "public" or vis == "external") and gn.name ~= "constructor" then
                entry_fn = gn
                -- Use graph-tracked state writes (resolved against actual state variables)
                local writes = graph.get_outgoing_edges(gn.id, "state_write")
                entry_has_writes = #writes > 0
            end
        end
    end

    if not entry_fn then return end

    -- Track event emissions at any depth (including inside callees via deep walk)
    if node.kind == "emit_statement" then
        has_emit = true
    end
end

function exit(node, ctx)
    -- Flush when exiting the top-level function scope
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
