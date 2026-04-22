rule = {
    id = "SOL-019",
    name = "variable-could-be-constant-or-immutable",
    severity = "info",
    type = "map",
    confidence = "smell",
    languages = {"solidity"},
    description = "State variable never written could be constant; state variable only written in constructor could be immutable.",
}

local write_exprs = {
    "assignment_expression",
    "augmented_assignment_expression",
    "delete_statement",
}
local write_calls = { push = true, pop = true }

local function is_already_immutable(var_h)
    for _, ch in ipairs(ast.children(var_h)) do
        if ast.type(ch) == "immutable" then return true end
    end
    return false
end

local function var_key(var_h)
    local name_h = ast.child_by_field(var_h, "name")
    local name = name_h and ast.text(name_h) or ""
    return (ast.file(var_h) or "") .. ":" .. (ast.start_line(var_h) or 0) .. ":" .. name
end

-- Pre-pass: classify each state var as { any_write, non_ctor_write }.
local function build_write_index()
    local writers = {}

    for _, fn in ipairs(graph.get_nodes_by_kind("callable")) do
        local fn_h = ast.node(fn.id)
        if not fn_h then goto next_fn end

        local container = graph.get_parent(fn.id)
        if not container then goto next_fn end

        local is_ctor = fn.name == "constructor_definition"

        local function record(var_h)
            local key = var_key(var_h)
            local e = writers[key] or { any = false, non_ctor = false }
            e.any = true
            if not is_ctor then e.non_ctor = true end
            writers[key] = e
        end

        for _, t in ipairs(write_exprs) do
            for _, w_h in ipairs(ast.find(fn_h, t)) do
                local lhs = nil
                if t == "delete_statement" then
                    lhs = ast.child_by_field(w_h, "expression")
                else
                    lhs = ast.child_by_field(w_h, "left")
                end
                if lhs then
                    local name = ast.unwrap(lhs, "receiver")
                    if name then
                        local var_h = graph.find_in_scope(container.id, name, "state_variable_declaration")
                        if var_h then record(var_h) end
                    end
                end
            end
        end

        for _, call_h in ipairs(ast.find(fn_h, "call_expression")) do
            local callee = ast.child_by_field(call_h, "function")
            if callee then
                local cname = ast.unwrap(callee, "callee")
                if cname and write_calls[cname] then
                    local receiver = ast.unwrap(callee, "receiver")
                    if receiver then
                        local var_h = graph.find_in_scope(container.id, receiver, "state_variable_declaration")
                        if var_h then record(var_h) end
                    end
                end
            end
        end

        ::next_fn::
    end

    return writers
end

function check()
    local findings = {}
    local writers = build_write_index()

    for _, c in ipairs(graph.get_nodes_by_kind("container")) do
        for _, var_h in ipairs(ast.find_in_container(c.id, "state_variable_declaration")) do
            if is_already_immutable(var_h) then goto next_var end

            local name_h = ast.child_by_field(var_h, "name")
            if not name_h then goto next_var end
            local name = ast.text(name_h)
            if not name then goto next_var end

            local file = ast.file(var_h) or ""
            local line = ast.start_line(var_h) or 0
            local entry = writers[var_key(var_h)]

            if not entry or not entry.any then
                if ast.child_by_field(var_h, "value") ~= nil then
                    table.insert(findings, {
                        file = file,
                        line = line,
                        node_text = name .. ": could be constant",
                    })
                end
            elseif not entry.non_ctor then
                table.insert(findings, {
                    file = file,
                    line = line,
                    node_text = name .. ": could be immutable",
                })
            end

            ::next_var::
        end
    end

    return findings
end
