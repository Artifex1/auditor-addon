rule = {
    id = "SOL-002",
    name = "reentrancy",
    severity = "critical",
    type = "deep",
    max_depth = 5,
    confidence = "smell",
    description = "Detects state changes after external calls (checks-effects-interactions violation)",
    languages = {"solidity"},
}

local seen_external_call = false

function enter(node, ctx)
    -- Reset state when entering a new function scope
    if node.kind == "function_definition" then
        seen_external_call = false
    end

    -- When we see a call_expression, check if it matches an external call ref
    if not seen_external_call and node.kind == "call_expression" then
        local ref = graph.get_ref_at(ctx.current_file, node.start_byte)
        if ref and ref.target_kind == "external" then
            seen_external_call = true
        end
    end

    -- After an external call, any state write is a reentrancy risk
    if seen_external_call then
        if node.kind == "assignment_expression" or node.kind == "augmented_assignment_expression" then
            report.hit({
                file = ctx.current_file,
                line = node.line,
                node_text = ast.text(node.handle) or "",
            })
        end
    end
end
