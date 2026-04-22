rule = {
    id = "GEN-002",
    name = "duplicated-import",
    severity = "info",
    type = "map",
    confidence = "issue",
    description = "Flags import paths that appear more than once in the same file. The symbol graph already normalises import paths for every language, so no language-specific handling is needed.",
}

function check()
    local findings = {}
    for _, file in ipairs(graph.get_nodes_by_kind("file")) do
        local seen = {}
        for _, edge in ipairs(graph.get_refs(file.id, "import")) do
            local path = edge.target_name
            if seen[path] then
                table.insert(findings, {
                    file      = file.file,
                    line      = edge.call_site_line,
                    node_text = "duplicate import: " .. path,
                })
            else
                seen[path] = true
            end
        end
    end
    return findings
end
