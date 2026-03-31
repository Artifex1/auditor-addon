rule = {
    id = "MAP-002",
    name = "unused-function",
    severity = "smell",
    type = "map",
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
