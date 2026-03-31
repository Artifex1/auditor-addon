rule = {
    id = "SOL-021",
    name = "double-state-read",
    severity = "info",
    type = "scope",
    languages = {"solidity"},
    description = "Reading the same state variable twice in a function wastes gas (each SLOAD costs ~2100 gas). Cache in a local variable instead.",
}

local state_vars = {}   -- { [name] = true }
local locals = {}       -- { [name] = true } per function
local reads = {}        -- { [name] = true } per function
local in_function = false

local function unwrap(h)
    if h and ast.type(h) == "expression" then
        local kids = ast.named_children(h)
        return kids[1]
    end
    return h
end

function enter(node, ctx)
    -- Collect state variable names at contract level
    if node.kind == "state_variable_declaration" then
        local n = ast.child_by_field(node.handle, "name")
        if n then state_vars[ast.text(n)] = true end
        return
    end

    -- Reset per-function state
    if node.kind == "function_definition"
        or node.kind == "constructor_definition"
        or node.kind == "modifier_definition" then
        locals = {}
        reads = {}
        in_function = true
        -- Collect parameter names as locals
        for _, ch in ipairs(ast.named_children(node.handle)) do
            if ast.type(ch) == "parameter" then
                local pn = ast.child_by_field(ch, "name")
                if pn then locals[ast.text(pn)] = true end
            end
        end
        return
    end

    if not in_function then return end

    -- Track local variable declarations (shadowing)
    if node.kind == "variable_declaration" then
        local n = ast.child_by_field(node.handle, "name")
        if n then locals[ast.text(n)] = true end
        return
    end

    -- Skip write targets — left side of assignments
    if node.kind == "assignment_expression"
        or node.kind == "augmented_assignment_expression" then
        local left = unwrap(ast.child_by_field(node.handle, "left"))
        if left and ast.type(left) == "identifier" then
            locals[ast.text(left)] = true
        end
        return
    end

    -- Track identifier reads
    if node.kind == "identifier" then
        local name = ast.text(node.handle)
        if state_vars[name] and not locals[name] then
            if reads[name] then
                report.hit({
                    file = ctx.current_file,
                    line = node.line,
                    node_text = name,
                })
            else
                reads[name] = true
            end
        end
    end
end

function exit(node, ctx)
    if node.kind == "function_definition"
        or node.kind == "constructor_definition"
        or node.kind == "modifier_definition" then
        in_function = false
    end
end
