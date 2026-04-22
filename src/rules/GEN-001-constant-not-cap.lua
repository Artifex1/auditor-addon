rule = {
    id = "GEN-001",
    name = "constant-not-cap",
    severity = "info",
    type = "scope",
    confidence = "issue",
    languages = {"solidity", "rust", "cairo", "move"},
    description = "Constants and immutables should use UPPER_CASE (SCREAMING_SNAKE_CASE). Flags any constant whose name contains a lowercase letter.",
}

-- Returns true if the name is already ALL_CAPS (no lowercase letters, not blank).
local function is_upper(name)
    if name == "" or name == "_" then return true end
    return not name:find("[a-z]")
end

-- Returns the text of the name field child, or nil.
local function name_text(h)
    local n = ast.child_by_field(h, "name")
    if n == nil then return nil end
    return ast.text(n)
end

local function check(node, ctx)
    local name = name_text(node.handle)
    if name == nil then return end
    if not is_upper(name) then
        report.hit({
            file = ctx.current_file,
            line = node.line,
            node_text = name,
        })
    end
end

-- Solidity: `uint256 constant FOO = 1;`
function enter_constant_variable_declaration(node, ctx) check(node, ctx) end

-- Rust / Cairo: `const FOO: u32 = 1;`
function enter_const_item(node, ctx) check(node, ctx) end

-- Move: `const FOO: u64 = 0;`
function enter_constant_decl(node, ctx) check(node, ctx) end
