rule = {
    id = "SOL-007",
    name = "missing-mapping-named-parameters",
    severity = "info",
    type = "scope",
    confidence = "issue",
    description = "Mapping declaration is missing named key/value parameters. Add names for readability (Solidity 0.8.18+).",
    languages = {"solidity"},
}

function enter(node, ctx)
    -- type_name nodes represent mapping types when their first child is the "mapping" keyword
    if node.kind ~= "type_name" then return end

    local children = ast.children(node.handle)
    if #children == 0 then return end

    -- First anonymous child is the "mapping" keyword token
    if ast.type(children[1]) ~= "mapping" then return end

    -- Check for named key and value parameters
    local key_id = ast.child_by_field(node.handle, "key_identifier")
    local val_id = ast.child_by_field(node.handle, "value_identifier")

    if not key_id or not val_id then
        report.hit({
            file = ctx.current_file,
            line = node.line,
            node_text = ast.text(node.handle) or "",
        })
    end
end

function exit(node, ctx) end
