rule = {
    id = "SOL-005",
    name = "lack-of-security-contact",
    severity = "info",
    type = "map",
    confidence = "issue",
    description = "Contract is missing a @custom:security-contact NatSpec tag. Add one so vulnerability reporters know who to contact.",
    languages = {"solidity"},
}

function check()
    local findings = {}
    local containers = graph.get_nodes_by_kind("container")

    for _, c in ipairs(containers) do
        -- Get AST handle to confirm node type
        local c_h = ast.node(c.id)
        if not c_h then goto continue end

        -- Only contract_declaration, not interface or library
        if ast.type(c_h) ~= "contract_declaration" then goto continue end

        -- Walk back through preceding named siblings (NatSpec comments)
        local prev = ast.prev_sibling(c_h)
        local has_tag = false

        while prev ~= nil do
            local t = ast.type(prev)
            if t ~= "comment" then break end
            local text = ast.text(prev) or ""
            if text:find("@custom:security-contact", 1, true) then
                has_tag = true
                break
            end
            prev = ast.prev_sibling(prev)
        end

        if not has_tag then
            table.insert(findings, {
                file = c.file,
                line = c.line,
                node_text = c.name,
            })
        end

        ::continue::
    end

    return findings
end
