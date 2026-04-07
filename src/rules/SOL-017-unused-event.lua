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

    local events = graph.get_nodes_by_kind("event")
    if #events == 0 then return findings end

    -- First pass: check resolved graph edges (cross-file)
    local unused = {}
    for _, ev in ipairs(events) do
        local incoming = graph.get_incoming_edges(ev.id, "event_emit")
        if #incoming == 0 then
            unused[ev.name] = ev
        end
    end

    if next(unused) == nil then return findings end

    -- Second pass: scan AST for emit statements (catches unresolved cases)
    for _, fn in ipairs(graph.get_nodes_by_kind("callable")) do
        local fn_h = ast.node(fn.id)
        if not fn_h then goto next_fn end

        for _, em_h in ipairs(ast.find(fn_h, "emit_statement")) do
            local name_node = ast.child_by_field(em_h, "name")
            if name_node then
                local name = ast.text(name_node)
                if name then unused[name] = nil end
            end
        end

        ::next_fn::
    end

    for name, ev in pairs(unused) do
        table.insert(findings, {
            file = ev.file,
            line = ev.line,
            node_text = name,
        })
    end

    return findings
end
