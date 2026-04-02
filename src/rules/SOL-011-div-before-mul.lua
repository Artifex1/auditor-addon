rule = {
    id = "SOL-011",
    name = "div-before-mul",
    severity = "medium",
    type = "scope",
    confidence = "smell",
    description = [[
Detects integer division whose result feeds into a multiplication, causing
precision loss due to truncation of the intermediate value.

Two patterns are caught:
  1. Inline:   (a / b) * c  — division result used directly in the same expression
  2. Variable: x = a / b; ... x * c  — division result stored and later multiplied

The fix is to reorder: (a * c) / b.]],
    languages = {"solidity"},
}

-- Per-function set of local variables that hold a division result.
-- Reset at every function boundary.
local div_vars = {}

--- Returns true if the AST subtree rooted at `h` contains a `/` binary_expression.
local function contains_division(h)
    if not h then return false end
    if ast.type(h) == "binary_expression" then
        local op = ast.child_by_field(h, "operator")
        if op and ast.text(op) == "/" then return true end
    end
    for _, desc in ipairs(ast.find(h, "binary_expression")) do
        local op = ast.child_by_field(desc, "operator")
        if op and ast.text(op) == "/" then return true end
    end
    return false
end

--- Returns the bare variable name if `h` is a simple identifier expression,
--- otherwise nil. Used to avoid matching complex l-values like arr[i].
local function simple_name(h)
    if not h then return nil end
    local text = ast.text(h) or ""
    if text:match("^[%a_][%a%d_]*$") then return text end
    return nil
end

function enter(node, ctx)
    -- Reset taint set at every function boundary
    if node.kind == "function_definition" then
        div_vars = {}
        return
    end

    -- Track: local variable declaration whose value contains division
    --   uint256 x = a / b;
    if node.kind == "variable_declaration_statement" then
        local val_h = ast.child_by_field(node.handle, "value")
        if val_h and contains_division(val_h) then
            for _, vd_h in ipairs(ast.find(node.handle, "variable_declaration")) do
                local name_h = ast.child_by_field(vd_h, "name")
                if name_h then div_vars[ast.text(name_h)] = true end
            end
        end
        return
    end

    -- Track: assignment whose RHS contains division; clear taint on reassignment
    --   x = a / b;   →  taint x
    --   x = other;   →  clear x (no longer a division result)
    if node.kind == "assignment_expression" then
        local left_h  = ast.child_by_field(node.handle, "left")
        local right_h = ast.child_by_field(node.handle, "right")
        local var = simple_name(left_h)
        if var then
            if right_h and contains_division(right_h) then
                div_vars[var] = true
            else
                div_vars[var] = nil
            end
        end
        return
    end

    -- Detect: multiplication where either operand is a division result
    if node.kind ~= "binary_expression" then return end
    local op_h = ast.child_by_field(node.handle, "operator")
    if not op_h or ast.text(op_h) ~= "*" then return end

    local left_h  = ast.child_by_field(node.handle, "left")
    local right_h = ast.child_by_field(node.handle, "right")

    -- Pattern 1: inline division in either operand  →  (a/b)*c  or  c*(a/b)
    if contains_division(left_h) or contains_division(right_h) then
        report.hit({
            file      = ctx.current_file,
            line      = node.line,
            node_text = ast.text(node.handle) or "",
        })
        return
    end

    -- Pattern 2: tainted variable used as an operand  →  x*c  or  c*x
    local left_name  = simple_name(left_h)
    local right_name = simple_name(right_h)
    if (left_name and div_vars[left_name]) or (right_name and div_vars[right_name]) then
        report.hit({
            file      = ctx.current_file,
            line      = node.line,
            node_text = ast.text(node.handle) or "",
        })
    end
end
