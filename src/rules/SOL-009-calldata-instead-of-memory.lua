rule = {
    id = "SOL-009",
    name = "calldata-instead-of-memory",
    severity = "info",
    type = "map",
    description = "External function input parameter uses `memory` instead of `calldata`. Use calldata to avoid copying and save gas.",
    languages = {"solidity"},
}

function check()
    local findings = {}
    local callables = graph.get_nodes_by_kind("callable")

    for _, fn in ipairs(callables) do
        if fn.visibility ~= "external" then goto continue end

        local fn_h = ast.node(fn.id)
        if not fn_h then goto continue end

        local params = ast.find(fn_h, "parameter")
        for _, p_h in ipairs(params) do
            -- Skip return-type parameters
            local parent_h = ast.parent(p_h)
            if parent_h and ast.type(parent_h) == "return_type_definition" then
                goto cont_param
            end

            -- Flag parameters with explicit 'memory' location
            local loc_h = ast.child_by_field(p_h, "location")
            if loc_h and ast.text(loc_h) == "memory" then
                table.insert(findings, {
                    file = fn.file,
                    line = ast.start_line(p_h) or fn.line,
                    node_text = ast.text(p_h) or "",
                })
            end

            ::cont_param::
        end

        ::continue::
    end

    return findings
end
