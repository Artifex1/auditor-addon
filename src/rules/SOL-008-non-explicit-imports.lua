rule = {
    id = "SOL-008",
    name = "non-explicit-imports",
    severity = "info",
    type = "scope",
    description = "Import does not use explicit named symbols. Use `import {Symbol} from 'file.sol'` to avoid polluting the namespace.",
    languages = {"solidity"},
}

function enter(node, ctx)
    if node.kind ~= "import_directive" then return end
    local text = ast.text(node.handle) or node.name
    -- Explicit imports always contain the 'from' keyword:
    --   import {Foo} from "file.sol"
    --   import * as NS from "file.sol"
    -- Non-explicit imports do not:
    --   import "file.sol"
    --   import "file.sol" as Alias
    if not text:find("%sfrom%s") then
        report.hit({
            file = ctx.current_file,
            line = node.line,
            node_text = text:sub(1, 120),
        })
    end
end

function exit(node, ctx) end
