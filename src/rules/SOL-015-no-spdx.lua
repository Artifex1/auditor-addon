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

function enter_source_file(node, ctx)
    has_spdx = false
end

function enter_comment(node, ctx)
    if ast.text(node.handle):find("SPDX-License-Identifier", 1, true) then
        has_spdx = true
    end
end

function exit_source_file(node, ctx)
    if not has_spdx then
        report.hit({
            file = ctx.current_file,
            line = 1,
            node_text = "missing SPDX-License-Identifier",
        })
    end
end
