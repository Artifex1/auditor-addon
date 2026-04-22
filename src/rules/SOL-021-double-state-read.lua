rule = {
    id = "SOL-021",
    name = "double-state-read",
    severity = "info",
    type = "map",
    confidence = "pointer",
    languages = {"solidity"},
    description = "Reading the same state variable twice in a function wastes gas (each SLOAD costs ~2100 gas). Cache in a local variable instead.",
}

local function is_bytecode_constant(var_h)
    for _, ch in ipairs(ast.children(var_h)) do
        local t = ast.type(ch)
        if t == "immutable" or t == "constant" then return true end
    end
    return false
end

function check()
    local findings = {}

    for _, fn in ipairs(graph.get_nodes_by_kind("callable")) do
        local fn_h = ast.node(fn.id)
        if not fn_h then goto next_fn end

        local container = graph.get_parent(fn.id)
        if not container then goto next_fn end

        local seen = {}  -- name -> true (first read recorded)

        for _, id_h in ipairs(ast.find(fn_h, "identifier")) do
            local name = ast.text(id_h)
            if name then
                local var_h = graph.find_in_scope(container.id, name, "state_variable_declaration")
                if var_h and not is_bytecode_constant(var_h) then
                    if seen[name] then
                        table.insert(findings, {
                            file = fn.file,
                            line = ast.start_line(id_h) or 0,
                            node_text = name,
                        })
                    else
                        seen[name] = true
                    end
                end
            end
        end

        ::next_fn::
    end

    return findings
end
