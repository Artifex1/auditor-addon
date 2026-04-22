rule = {
    id = "SOL-007",
    name = "missing-mapping-named-parameters",
    severity = "info",
    type = "scope",
    confidence = "issue",
    description = "Mapping declaration is missing named key/value parameters. Add names for readability (Solidity 0.8.18+).",
    languages = {"solidity"},
}

function enter_type_name(node, ctx)
    local children = ast.children(node.handle)
    if #children == 0 then return end

    -- First anonymous child is the "mapping" keyword token for mapping types
    if ast.type(children[1]) ~= "mapping" then return end

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
