rule = {
    id = "SOL-010",
    name = "state-var-visibility-not-explicit",
    severity = "info",
    type = "map",
    description = "State variable has no explicit visibility specifier. Add `public`, `private`, or `internal` to make intent clear.",
    languages = {"solidity"},
}

function check()
    local findings = {}
    local variables = graph.get_nodes_by_kind("variable")

    for _, v in ipairs(variables) do
        -- visibility is nil when no visibility child was found in the declaration
        if not v.visibility then
            table.insert(findings, {
                file = v.file,
                line = v.line,
                node_text = v.name,
            })
        end
    end

    return findings
end
