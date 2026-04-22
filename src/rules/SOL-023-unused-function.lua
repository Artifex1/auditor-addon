rule = {
    id = "SOL-023",
    name = "unused-function",
    severity = "smell",
    type = "map",
    confidence = "pointer",
    description = [[
Flags internal or private callables that have zero callers.
These are dead code candidates — they cost gas to deploy but are never invoked.
Constructors, fallback, and receive functions are exempt.]],
    languages = {"solidity"},
}

local SKIP_NAMES = {
    ["constructor"] = true,
    ["fallback"]    = true,
    ["receive"]     = true,
}

function check()
    local findings = {}
    local callables = graph.get_nodes_by_kind("callable")

    for _, fn in ipairs(callables) do
        local vis = fn.visibility
        if vis ~= "internal" and vis ~= "private" then goto continue end

        if SKIP_NAMES[fn.name] then goto continue end

        local callers = graph.get_callers(fn.id)
        if #callers == 0 then
            -- Check virtual dispatch: if this is an override, an ancestor's
            -- virtual function of the same name may have callers
            local is_override = graph.get_property(fn.id, "override")
            if is_override then
                local container = graph.get_parent(fn.id)
                if container then
                    local reachable = false
                    local parents = graph.get_inheritance_parents(container.id)
                    for _, parent in ipairs(parents) do
                        local siblings = graph.get_children(parent.id)
                        for _, sib in ipairs(siblings) do
                            if sib.kind == "callable" and sib.name == fn.name then
                                if graph.get_property(sib.id, "virtual") then
                                    if #graph.get_callers(sib.id) > 0 then
                                        reachable = true
                                        break
                                    end
                                end
                            end
                        end
                        if reachable then break end
                    end
                    if reachable then goto continue end
                end
            end

            table.insert(findings, {
                file      = fn.file,
                line      = fn.line,
                node_text = fn.name .. ": " .. vis .. " function with zero callers",
            })
        end

        ::continue::
    end

    return findings
end
