rule = {
    id = "SOL-027",
    name = "sibling-override",
    severity = "info",
    confidence = "pointer",
    type = "map",
    description = [[
Base contract defines virtual functions overridden by two or more children.
Shared logic may embed implicit assumptions about direction, sign, or ordering
that hold for one child but not another — trace the mechanism through each
child independently.]],
    languages = {"solidity"},
}

function check()
    local findings = {}
    local containers = graph.get_nodes_by_kind("container")

    -- Build reverse inheritance: parent_id -> {child1, child2, ...}
    local children_of = {}
    for _, c in ipairs(containers) do
        local parents = graph.get_inheritance_parents(c.id)
        for _, p in ipairs(parents) do
            if not children_of[p.id] then children_of[p.id] = {} end
            table.insert(children_of[p.id], c)
        end
    end

    -- For each base with N>=2 children, check virtual functions
    for parent_id, kids in pairs(children_of) do
        if #kids < 2 then goto next_parent end

        local parent_children = graph.get_children(parent_id)

        for _, fn in ipairs(parent_children) do
            if fn.kind ~= "callable" then goto next_fn end
            if not graph.get_property(fn.id, "virtual") then goto next_fn end

            -- Count children that override this function
            local overriders = {}
            for _, kid in ipairs(kids) do
                local kid_children = graph.get_children(kid.id)
                for _, kfn in ipairs(kid_children) do
                    if kfn.kind == "callable" and kfn.name == fn.name then
                        if graph.get_property(kfn.id, "override") then
                            table.insert(overriders, kid.name)
                            break
                        end
                    end
                end
            end

            if #overriders >= 2 then
                table.insert(findings, {
                    file = fn.file,
                    line = fn.line or 1,
                    node_text = fn.name .. ": overridden in " .. table.concat(overriders, ", "),
                })
            end

            ::next_fn::
        end

        ::next_parent::
    end

    return findings
end
