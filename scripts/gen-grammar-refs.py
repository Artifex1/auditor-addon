#!/usr/bin/env python3
"""
Generate compact grammar references from tree-sitter node-types.json files.

Usage:
    python3 scripts/gen-grammar-refs.py [lang ...]

    With no arguments, regenerates all languages.
    With language names, regenerates only those (e.g. "solidity cairo").

Output: skills/rule-authoring/grammars/<lang>.md

Each file lists every named node type with its fields and/or children,
formatted for quick lookup when writing Lua rules:
  - ast.type(h)             → matches the node type name
  - ast.child_by_field(h, "name")  → uses field names listed here
  - ast.find(h, "type")     → searches by node type name
"""

import json
import sys
from pathlib import Path

def discover_grammars(root: Path) -> dict[str, Path]:
    """
    Walk vendor/grammars/ and find every node-types.json.
    Lang name = parent dir of src/, with 'tree-sitter-' prefix stripped.
    This handles both flat grammars (tree-sitter-solidity/src/)
    and multi-grammar repos (tree-sitter-typescript/tsx/src/).
    """
    grammars = {}
    for json_path in sorted((root / "vendor" / "grammars").rglob("node-types.json")):
        # json_path.parent == .../src, json_path.parent.parent == grammar or sub-grammar dir
        dir_name = json_path.parent.parent.name
        lang = dir_name.removeprefix("tree-sitter-")
        grammars[lang] = json_path
    return grammars


def format_types(type_list: list[dict], limit_anon: int = 3) -> str:
    """
    Render a list of {"type": str, "named": bool} entries as a compact string.
    Named types are shown as-is; anonymous tokens (punctuation/keywords) are
    quoted and capped so they don't swamp the output.
    """
    named = [t["type"] for t in type_list if t.get("named")]
    anon  = [t["type"] for t in type_list if not t.get("named")]

    parts = named[:]
    if anon:
        shown = [f'"{a}"' for a in anon[:limit_anon]]
        if len(anon) > limit_anon:
            shown.append(f"+{len(anon) - limit_anon} more")
        parts.append("(" + " | ".join(shown) + ")")

    return " | ".join(parts) if parts else "—"


def format_node(node: dict) -> str:
    """
    Format a single named node as a markdown block.

    Examples:
        ### function_definition
          name:         identifier
          parameters:   parameter_list
          visibility?:  visibility
          return_type?: return_type_definition
          body:         function_body

        ### comment
          (leaf)

        ### pragma_directive
          (children)[]: pragma_value | solidity_version_comparison_operator
    """
    lines = [f"### {node['type']}"]

    fields   = node.get("fields", {})
    children = node.get("children")

    if fields:
        # Align field name column
        max_len = max(len(k) for k in fields) + 2  # +2 for optional marker
        for fname, fdef in sorted(fields.items()):
            opt   = "" if fdef.get("required") else "?"
            mult  = "[]" if fdef.get("multiple") else "  "
            label = f"{fname}{opt}:"
            types = format_types(fdef["types"])
            lines.append(f"  {label:<{max_len}} {mult} {types}")

    if children:
        mult  = "[]" if children.get("multiple") else "  "
        types = format_types(children["types"])
        lines.append(f"  (children): {mult} {types}")

    if not fields and not children:
        lines.append("  (leaf)")

    return "\n".join(lines)


def process_lang(lang: str, json_path: str, out_dir: Path) -> bool:
    path = Path(json_path)
    if not path.exists():
        print(f"  skip {lang}: {json_path} not found", file=sys.stderr)
        return False

    nodes = json.loads(path.read_text())
    named = sorted(
        [n for n in nodes if n.get("named")],
        key=lambda n: n["type"],
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{lang}.md"

    with open(out_path, "w") as f:
        f.write(f"# {lang} — tree-sitter named node types\n\n")
        f.write(f"> Generated from `{json_path}` ({len(named)} named types).  \n")
        f.write("> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`\n\n")
        f.write("**How to use in rules:**\n")
        f.write("- `ast.type(handle)` → matches the `### name` heading\n")
        f.write("- `ast.child_by_field(handle, \"field\")` → uses field names listed below\n")
        f.write("- `ast.find(handle, \"type\")` → searches descendants by `### name`\n")
        f.write("- `?` = optional field, `[]` = can appear multiple times\n\n")
        f.write("---\n\n")

        for node in named:
            f.write(format_node(node) + "\n\n")

    print(f"  {lang}: {len(named)} named nodes → {out_path}")
    return True


def main():
    root = Path(__file__).parent.parent
    out_dir = root / "skills" / "rule-authoring" / "grammars"

    all_grammars = discover_grammars(root)

    requested = sys.argv[1:]
    if requested:
        unknown = [r for r in requested if r not in all_grammars]
        if unknown:
            print(f"Unknown language(s): {unknown}", file=sys.stderr)
            print(f"Available: {sorted(all_grammars)}", file=sys.stderr)
            sys.exit(1)
        targets = {k: all_grammars[k] for k in requested}
    else:
        targets = all_grammars

    print(f"Generating grammar references ({len(targets)} language(s))...")
    ok = sum(process_lang(lang, str(path.relative_to(root)), out_dir) for lang, path in targets.items())
    print(f"Done. {ok}/{len(targets)} succeeded.")


if __name__ == "__main__":
    main()
