rule = {
    id = "SOL-017",
    name = "unused-event",
    severity = "info",
    type = "map",
    confidence = "smell",
    languages = {"solidity"},
    description = "Event defined but never emitted. Dead code or missing emit statement.",
}

function check()
    local findings = {}

    local events = ast.find_all("event_definition")
    if #events == 0 then return findings end

    -- Collect defined events by name. Duplicates (same name in multiple scopes)
    -- keep the first locator — any emit anywhere clears the flag.
    local unused = {}
    for _, ev_h in ipairs(events) do
        local name_h = ast.child_by_field(ev_h, "name")
        if name_h then
            local name = ast.text(name_h)
            if name and unused[name] == nil then
                unused[name] = {
                    file = ast.file(ev_h) or "",
                    line = ast.start_line(ev_h) or 0,
                }
            end
        end
    end

    if next(unused) == nil then return findings end

    -- Clear any event that is emitted somewhere (across all files).
    for _, em_h in ipairs(ast.find_all("emit_statement")) do
        local name_h = ast.child_by_field(em_h, "name")
        if name_h then
            local name = ast.text(name_h)
            if name then unused[name] = nil end
        end
    end

    for name, loc in pairs(unused) do
        table.insert(findings, {
            file = loc.file,
            line = loc.line,
            node_text = name,
        })
    end

    return findings
end
