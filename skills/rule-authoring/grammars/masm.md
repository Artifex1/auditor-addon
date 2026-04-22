# masm — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-masm/src/node-types.json` (91 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### absolute_const_path
  (children): [] const_ident | identifier | quoted_ident

### absolute_path
  (children): [] identifier | quoted_ident

### address_space
  (leaf)

### advice_map
  key?:     advice_map_key
  name:     const_ident
  (children): [] felt

### advice_map_key
  value:     word_value

### annotation
  arguments?:    annotation_arguments
  name:          identifier

### annotation_arguments
  (children):    meta_expr_list | meta_key_value_list

### array_type
  element:     type_expr
  length:      decimal

### assert
  err?:  [] const_ident | quoted_ident | string | ("." | "=" | "err")
  kind:     ("assert" | "assert_eq" | "assert_eqw" | +5 more)

### binary
  (leaf)

### bit_size_instruction
  bits:     decimal

### block
  (children): [] op

### comment
  (leaf)

### condition
  (leaf)

### const_arithmetic_expr
  lhs?:    const_arithmetic_expr
  rhs?:    const_arithmetic_expr100
  (children):    numeric_const_term

### const_arithmetic_expr100
  lhs?:    const_arithmetic_expr100
  rhs?:    numeric_const_term
  (children):    numeric_const_term

### const_expr
  lhs?:    const_expr
  rhs?:    const_expr100
  (children):    const_term

### const_expr100
  lhs?:    const_expr100
  rhs?:    const_term
  (children):    const_term

### const_group
  expr:     const_expr

### const_hash_expr
  value:     quoted_ident | string

### const_ident
  (leaf)

### const_path
  (children):    absolute_const_path | relative_const_path

### const_term
  (children):    const_group | const_hash_expr | const_path | integer | quoted_ident | string | word_value

### constant
  name:           const_ident
  value:          const_expr
  visibility?:    visibility

### debug
  count?:    u16_immediate | u8_immediate
  end?:      u16_immediate | u32_immediate
  start?:    u16_immediate | u32_immediate

### decimal
  (leaf)

### doc_comment
  (children): [] doc_comment_line

### doc_comment_line
  (leaf)

### emit
  name?:     const_ident
  value?:    quoted_ident | string

### entrypoint
  body:     block

### enum_declaration
  name:           identifier
  repr:           int_type
  visibility?:    visibility
  (children): [] enum_variant

### enum_variant
  name:      const_ident
  value?:    const_arithmetic_expr

### felt
  (children):    integer

### felt_immediate
  (children):    const_ident | integer

### felt_immediate_instruction
  imm?:    felt_immediate

### form
  (leaf)

### function_param
  name:     identifier
  type:     type_expr

### function_result
  name?:    identifier
  type:     type_expr

### function_result_list
  (children): [] function_result

### function_results
  (children):    function_result_list | type_expr

### function_type
  results?:    function_results
  (children): [] function_param

### hex
  (leaf)

### hex_word
  (leaf)

### identifier
  (leaf)

### if
  condition:     condition
  else_body?:    block
  then_body?:    block

### import
  alias?:         import_alias
  target:         const_path | mast_root | path
  visibility?:    visibility

### import_alias
  name:     identifier | quoted_ident

### int_type
  (leaf)

### integer
  (children):    decimal | hex

### integer_immediate
  (children):    const_ident | integer

### integer_immediate_instruction
  imm?:    integer_immediate

### invoke
  kind:       ("call" | "exec" | "procref" | +1 more)
  path?:      path
  target?:    mast_root

### local_instruction
  local:     u16_immediate

### mast_root
  (children):    hex_word

### meta_expr
  (leaf)

### meta_expr_list
  (children): [] meta_expr

### meta_key_value
  name:      identifier
  value:     meta_expr

### meta_key_value_list
  (children): [] meta_key_value

### numeric_const_term
  (children):    const_arithmetic_expr | const_path | integer

### op
  (leaf)

### opcode
  (leaf)

### path
  (children):    absolute_path | relative_path

### pointer_type
  pointee:     type_expr
  space?:      address_space

### primitive_type
  (leaf)

### procedure
  annotations?: [] annotation
  body:            block
  name:            procedure_name
  signature?:      function_type
  visibility?:     visibility

### procedure_name
  (children):    identifier | quoted_ident

### push
  end?:      decimal
  index?:    decimal
  start?:    decimal
  value:  [] push_value | word_immediate_value | word_value

### push_value
  (children):    const_ident | integer

### quoted_ident
  (leaf)

### relative_const_path
  (children): [] const_ident | identifier | quoted_ident

### relative_path
  (children): [] identifier | quoted_ident

### repeat
  body:      block
  count:     u32_immediate

### source_file
  (children): [] form

### stack_instruction
  index?:    u8_value_immediate

### string
  (leaf)

### struct_field
  name:     identifier
  type:     type_expr

### struct_type
  repr?:    annotation
  (children): [] struct_field

### system_event
  padding?:    u8_value_immediate

### trace
  id:     u32_immediate

### type_alias
  name:           identifier
  value:          type_expr
  visibility?:    visibility

### type_expr
  (leaf)

### u16_immediate
  (children):    const_ident | decimal

### u32_immediate
  (children):    binary | const_ident | decimal | hex

### u32_immediate_instruction
  imm?:    u32_immediate

### u8_immediate
  (children):    const_ident | decimal

### u8_value_immediate
  (children):    decimal

### visibility
  (leaf)

### while
  body:     block

### word
  (children): [] felt

### word_immediate_value
  (children):    const_ident | word_value

### word_value
  (children):    hex_word | word

