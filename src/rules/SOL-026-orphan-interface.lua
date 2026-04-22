rule = {
    id = "SOL-026",
    name = "orphan-interface",
    severity = "low",
    confidence = "pointer",
    type = "map",
    description = "Interface has no in-scope implementor — functions are only reachable via type casts and may be absent on the actual target",
    languages = {"solidity"},
}

function check()
    local findings = {}

    -- Build set of interface IDs that are inherited by at least one contract.
    local inherited = {}
    local containers = graph.get_nodes_by_kind("container")
    for _, c in ipairs(containers) do
        local edges = graph.get_outgoing_edges(c.id, "inherit")
        for _, e in ipairs(edges) do
            if e.to then inherited[e.to] = true end
        end
    end

    -- Flag interfaces with callable children that no contract inherits from.
    for _, c in ipairs(containers) do
        local n = ast.node(c.id)
        if n and ast.type(n) == "interface_declaration" and not inherited[c.id] then
            local children = graph.get_children(c.id)
            local fn_names = {}
            for _, ch in ipairs(children) do
                if ch.kind == "callable" then
                    table.insert(fn_names, ch.name)
                end
            end
            if #fn_names > 0 then
                table.insert(findings, {
                    file = c.file,
                    line = c.line or 1,
                    node_text = c.name .. ": " .. table.concat(fn_names, ", "),
                })
            end
        end
    end

    return findings
end
