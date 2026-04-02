rule = {
    id = "SOL-003",
    name = "floating-pragma",
    severity = "info",
    type = "scope",
    confidence = "issue",
    description = "Pragma directive uses a floating version constraint (^, >=). Pin to a specific version to ensure deterministic builds.",
    languages = {"solidity"},
}

function enter(node, ctx)
    if node.kind ~= "pragma_directive" then return end
    local text = ast.text(node.handle) or node.name
    -- Only Solidity version pragmas, not e.g. "pragma abicoder v2"
    if not text:find("pragma%s+solidity") then return end
    -- Floating constraints: ^ or >= allow a range of compiler versions
    if text:find("%^") or text:find(">=") then
        report.hit({
            file = ctx.current_file,
            line = node.line,
            node_text = text,
        })
    end
end

function exit(node, ctx) end
