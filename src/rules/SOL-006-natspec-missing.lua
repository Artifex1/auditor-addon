rule = {
    id = "SOL-006",
    name = "natspec-missing",
    severity = "info",
    type = "map",
    description = "Public/external function is missing NatSpec documentation, or its NatSpec is missing @param/@return tags.",
    languages = {"solidity"},
}

function check()
    local findings = {}
    local callables = graph.get_nodes_by_kind("callable")

    for _, fn in ipairs(callables) do
        local fn_h = ast.node(fn.id)
        if not fn_h then goto continue end

        -- Only function_definition, not constructor/modifier/fallback
        if ast.type(fn_h) ~= "function_definition" then goto continue end

        -- Collect preceding NatSpec comments (/// or /**)
        local natspec = {}
        local prev = ast.prev_sibling(fn_h)
        while prev ~= nil do
            local t = ast.type(prev)
            if t ~= "comment" then break end
            local text = ast.text(prev) or ""
            if text:sub(1, 3) == "///" or text:sub(1, 3) == "/**" then
                table.insert(natspec, text)
            end
            prev = ast.prev_sibling(prev)
        end

        -- Missing NatSpec entirely: only flag public/external (too noisy otherwise)
        if #natspec == 0 then
            local vis = fn.visibility
            if vis == "public" or vis == "external" then
                table.insert(findings, {
                    file = fn.file,
                    line = fn.line,
                    node_text = fn.name .. ": missing NatSpec",
                })
            end
            goto continue
        end

        -- Incomplete NatSpec: flag regardless of visibility
        local combined = table.concat(natspec, "\n")
        local has_param_tag = combined:find("@param", 1, true) ~= nil
        local has_return_tag = combined:find("@return", 1, true) ~= nil

        -- Check for named input parameters
        local params = ast.find(fn_h, "parameter")
        local has_named_inputs = false
        for _, p_h in ipairs(params) do
            local parent_h = ast.parent(p_h)
            if parent_h and ast.type(parent_h) == "return_type_definition" then
                goto cont_param
            end
            if ast.child_by_field(p_h, "name") then
                has_named_inputs = true
            end
            ::cont_param::
        end

        -- Check for return type
        local has_return_type = ast.child_by_field(fn_h, "return_type") ~= nil

        if has_named_inputs and not has_param_tag then
            table.insert(findings, {
                file = fn.file,
                line = fn.line,
                node_text = fn.name .. ": NatSpec missing @param",
            })
        elseif has_return_type and not has_return_tag then
            table.insert(findings, {
                file = fn.file,
                line = fn.line,
                node_text = fn.name .. ": NatSpec missing @return",
            })
        end

        ::continue::
    end

    return findings
end
