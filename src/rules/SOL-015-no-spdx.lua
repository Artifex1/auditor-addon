rule = {
    id = "SOL-015",
    name = "no-spdx",
    severity = "info",
    type = "scope",
    confidence = "issue",
    languages = {"solidity"},
    description = "Solidity source files should begin with an SPDX-License-Identifier comment. Flags files where no such comment is present anywhere in the file.",
}

local has_spdx = false

function enter(node, ctx)
    if node.kind == "source_file" then
        has_spdx = false
    elseif node.kind == "comment" then
        if ast.text(node.handle):find("SPDX-License-Identifier", 1, true) then
            has_spdx = true
        end
    end
end

function exit(node, ctx)
    if node.kind == "source_file" then
        if not has_spdx then
            report.hit({
                file = ctx.current_file,
                line = 1,
                node_text = "missing SPDX-License-Identifier",
            })
        end
    end
end
