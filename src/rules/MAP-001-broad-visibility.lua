rule = {
    id = "MAP-001",
    name = "broad-visibility",
    severity = "info",
    type = "map",
    description = [[
Flags functions whose declared visibility is broader than their actual usage requires:
  - public with no callers from within the same contract → consider external
  - internal with all callers inside the same contract → consider private
Virtual and override functions are exempt: they participate in inheritance and
cannot have their visibility tightened unilaterally.
Functions with zero callers are skipped (MAP-002 covers dead code).]],
    languages = {"solidity"},
}

local function has_child_type(fn_h, node_type)
    for _, ch in ipairs(ast.named_children(fn_h)) do
        if ast.type(ch) == node_type then return true end
    end
    return false
end

function check()
    local findings = {}
    local callables = graph.get_nodes_by_kind("callable")

    for _, fn in ipairs(callables) do
        local fn_h = ast.node(fn.id)
        if not fn_h then goto continue end
        if ast.type(fn_h) ~= "function_definition" then goto continue end

        -- Virtual and override exempt: inheritance may require this visibility
        if has_child_type(fn_h, "virtual") then goto continue end
        if has_child_type(fn_h, "override_specifier") then goto continue end

        local container = graph.get_parent(fn.id)
        local callers   = graph.get_callers(fn.id)
        local vis       = fn.visibility

        if vis == "public" then
            -- Flag if no caller is from within the same container.
            -- Callers from other contracts (or no callers) mean the function
            -- never needs to be called internally — external is sufficient.
            local has_internal_caller = false
            for _, caller in ipairs(callers) do
                local cc = graph.get_parent(caller.id)
                if container and cc and container.id == cc.id then
                    has_internal_caller = true
                    break
                end
            end
            if not has_internal_caller then
                table.insert(findings, {
                    file     = fn.file,
                    line     = fn.line,
                    node_text = fn.name .. ": public but never called internally — consider external",
                })
            end

        elseif vis == "internal" then
            -- Only flag when there are callers (zero callers = MAP-002).
            if #callers == 0 then goto continue end

            -- Flag if every caller lives in the same container.
            -- If any caller is from a child contract the function must stay
            -- internal (private would break the child's access).
            if not container then goto continue end
            local all_same = true
            for _, caller in ipairs(callers) do
                local cc = graph.get_parent(caller.id)
                if not cc or cc.id ~= container.id then
                    all_same = false
                    break
                end
            end
            if all_same then
                table.insert(findings, {
                    file     = fn.file,
                    line     = fn.line,
                    node_text = fn.name .. ": internal but only called within same contract — consider private",
                })
            end
        end

        ::continue::
    end

    return findings
end
