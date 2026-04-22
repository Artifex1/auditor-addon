rule = {
    id = "GEN-003",
    name = "unused-import",
    severity = "info",
    type = "scope",
    confidence = "smell",
    languages = {"solidity"},
    description = "Named import symbol never referenced in the file. Checks named imports and resolved glob imports.",
}

-- { name = { file, line } } -- imported symbols to track
local imported = {}
-- { name = true } -- identifiers seen in file
local seen = {}
local in_import = false

function enter_import_directive(node, ctx)
    in_import = true
    local h = node.handle

    -- Extract named import symbols from AST children (import_name field)
    local has_named = false
    for _, ch in ipairs(ast.named_children(h)) do
        local t = ast.type(ch)
        if t == "identifier" then
            -- Could be import_name or alias; collect all identifiers
            -- within the import directive as potential imported names
            local name = ast.text(ch)
            imported[name] = { file = ctx.current_file, line = node.line }
            has_named = true
        end
    end

    -- For glob imports with resolved targets, get all exported children
    if not has_named then
        for _, file_node in ipairs(graph.get_nodes_by_kind("file")) do
            if file_node.file == ctx.current_file then
                local refs = graph.get_refs(file_node.id, "import")
                for _, ref in ipairs(refs) do
                    if ref.call_site_line == node.line and ref.to then
                        local children = graph.get_children(ref.to)
                        for _, child in ipairs(children) do
                            imported[child.name] = { file = ctx.current_file, line = node.line }
                        end
                    end
                end
            end
        end
    end
end

function exit_import_directive(node, ctx)
    in_import = false
end

function enter_identifier(node, ctx)
    if not in_import then
        seen[ast.text(node.handle)] = true
    end
end

function finalize()
    for name, info in pairs(imported) do
        if not seen[name] then
            report.hit({
                file = info.file,
                line = info.line,
                node_text = name,
            })
        end
    end
end
