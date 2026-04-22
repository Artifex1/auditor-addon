rule = {
    id = "SOL-004",
    name = "use-custom-errors",
    severity = "info",
    type = "scope",
    confidence = "issue",
    description = "require/revert uses a string message or no error at all. Use custom errors for better gas efficiency and clearer reverts.",
    languages = {"solidity"},
}

function enter_revert_statement(node, ctx)
    local text = ast.text(node.handle) or ""
    text = text:gsub("[%s;]+$", "")
    local after = text:match("^revert%s*(.*)")
    if not after then return end

    -- bare revert() — no error type
    if after == "" or after:match("^%(%)%s*$") then
        report.hit({file = ctx.current_file, line = node.line, node_text = "bare revert()"})
    -- revert("string") — string literal as error
    elseif after:match('^%("') or after:match("^%('") then
        report.hit({file = ctx.current_file, line = node.line, node_text = text:sub(1, 80)})
    end
end

function enter_call_expression(node, ctx)
    -- flag require(cond) and require(cond, "string")
    local text = node.name
    if text:sub(1, 8) ~= "require(" then return end

    -- named children: [expression(require_id), call_argument1, call_argument2, ...]
    local nc = ast.named_children(node.handle)
    if #nc < 2 then return end

    if #nc == 2 then
        -- require(cond) with no error message
        report.hit({file = ctx.current_file, line = node.line, node_text = text:sub(1, 80)})
        return
    end

    -- Check if second argument is a string literal
    local msg_text = ast.text(nc[3]) or ""
    if msg_text:sub(1, 1) == '"' or msg_text:sub(1, 1) == "'" then
        report.hit({file = ctx.current_file, line = node.line, node_text = text:sub(1, 80)})
    end
end
