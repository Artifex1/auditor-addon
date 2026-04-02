rule = {
    id = "SOL-017",
    name = "unused-event",
    severity = "info",
    type = "scope",
    confidence = "smell",
    languages = {"solidity"},
    description = "Event defined but never emitted. Dead code or missing emit statement.",
}

-- { [name] = {file, line} } — event definitions
local events = {}
-- { [name] = true } — events seen in emit statements
local emitted = {}

function enter(node, ctx)
    if node.kind == "event_definition" then
        local name_node = ast.child_by_field(node.handle, "name")
        if name_node then
            local name = ast.text(name_node)
            events[name] = { file = ctx.current_file, line = node.line }
        end
    elseif node.kind == "emit_statement" then
        local name_node = ast.child_by_field(node.handle, "name")
        if name_node then
            emitted[ast.text(name_node)] = true
        end
    end
end

function exit(node, ctx) end

function finalize()
    for name, loc in pairs(events) do
        if not emitted[name] then
            report.hit({
                file = loc.file,
                line = loc.line,
                node_text = name,
            })
        end
    end
end
