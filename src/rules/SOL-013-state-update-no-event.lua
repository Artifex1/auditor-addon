rule = {
    id = "SOL-013",
    name = "state-update-no-event",
    severity = "medium",
    type = "map",
    confidence = "smell",
    languages = {"solidity"},
    description = "External/public functions that modify state without emitting an event. Off-chain indexers cannot track these changes.",
}

function check()
    local findings = {}
    for _, fn in ipairs(graph.get_nodes_by_kind("callable")) do
        -- Only flag external/public entry points
        local vis = graph.get_property(fn.id, "visibility")
        if vis ~= "public" and vis ~= "external" then goto continue end

        -- Skip constructors
        if fn.name == "constructor" then goto continue end

        -- Must have state writes
        local writes = graph.get_outgoing_edges(fn.id, "state_write")
        if #writes == 0 then goto continue end

        -- Flag if no event emits
        local emits = graph.get_outgoing_edges(fn.id, "event_emit")
        if #emits == 0 then
            table.insert(findings, {
                file = fn.file,
                line = fn.line,
                node_text = fn.name,
            })
        end

        ::continue::
    end
    return findings
end
