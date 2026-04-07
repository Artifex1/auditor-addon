rule = {
    id = "SOL-021",
    name = "double-state-read",
    severity = "info",
    type = "map",
    confidence = "pointer",
    languages = {"solidity"},
    description = "Reading the same state variable twice in a function wastes gas (each SLOAD costs ~2100 gas). Cache in a local variable instead.",
}

function check()
    local findings = {}

    for _, fn in ipairs(graph.get_nodes_by_kind("callable")) do
        local reads = graph.get_outgoing_edges(fn.id, "state_read")
        local seen = {}  -- { [target_id] = first_edge }

        for _, edge in ipairs(reads) do
            if edge.to then
                -- Skip immutable/constant (bytecode constants, no SLOAD)
                local mut = graph.get_property(edge.to, "mutability")
                local con = graph.get_property(edge.to, "constant")
                if mut or con then goto continue_edge end

                if seen[edge.to] then
                    local var = graph.get_node(edge.to)
                    if var then
                        table.insert(findings, {
                            file = fn.file,
                            line = edge.call_site_line,
                            node_text = var.name,
                        })
                    end
                else
                    seen[edge.to] = edge
                end
            end
            ::continue_edge::
        end
    end

    return findings
end
