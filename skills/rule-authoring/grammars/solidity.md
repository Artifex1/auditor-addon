# solidity — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-solidity/src/node-types.json` (124 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### any_pragma_token
  (children): [] identifier | pragma_value

### any_source_type
  (leaf)

### array_access
  base:      expression
  index?:    expression

### assembly_flags
  (children): [] string

### assembly_statement
  (children): [] assembly_flags | yul_assignment | yul_block | yul_boolean | yul_break | yul_continue | yul_decimal_number | yul_for_statement | yul_function_call | yul_function_definition | yul_hex_number | yul_hex_string_literal | yul_if_statement | yul_label | yul_leave | yul_string_literal | yul_switch_statement | yul_variable_declaration

### assignment_expression
  left:      expression
  right:     expression

### augmented_assignment_expression
  left:      expression
  right:     expression

### binary_expression
  left:         expression
  operator:     ("!=" | "%" | "&" | +16 more)
  right:        expression

### block_statement
  (children): [] statement | unchecked

### boolean_literal
  (children):    false | true

### break_statement
  (leaf)

### call_argument
  (children): [] call_struct_argument | expression

### call_expression
  function:     expression
  (children): [] call_argument

### call_struct_argument
  name:      identifier
  value:     expression

### catch_clause
  body:     block_statement
  (children): [] identifier | parameter

### comment
  (leaf)

### constant_variable_declaration
  name:      identifier
  type:      type_name
  value:     expression

### constructor_definition
  body:     function_body
  (children): [] modifier_invocation | parameter

### continue_statement
  (leaf)

### contract_body
  (children): [] constructor_definition | enum_declaration | error_declaration | event_definition | fallback_receive_definition | function_definition | modifier_definition | state_variable_declaration | struct_declaration | user_defined_type_definition | using_directive

### contract_declaration
  body:     contract_body
  name:     identifier
  (children): [] inheritance_specifier | layout_specifier

### do_while_statement
  body:          statement
  condition:     expression

### emit_statement
  name:     expression
  (children): [] call_argument

### enum_body
  (children): [] enum_value

### enum_declaration
  body:     enum_body
  name:     identifier

### enum_value
  (leaf)

### error_declaration
  name:     identifier
  (children): [] error_parameter

### error_parameter
  name?:    identifier
  type:     type_name

### event_definition
  name:     identifier
  (children): [] event_parameter

### event_parameter
  name?:    identifier
  type:     type_name

### expression
  (children):    array_access | assignment_expression | augmented_assignment_expression | binary_expression | boolean_literal | call_expression | hex_string_literal | identifier | inline_array_expression | member_expression | meta_type_expression | new_expression | number_literal | parenthesized_expression | payable_conversion_expression | primitive_type | slice_access | string_literal | struct_expression | ternary_expression | tuple_expression | type_cast_expression | unary_expression | unicode_string_literal | update_expression | user_defined_type

### expression_statement
  (children):    expression

### fallback_receive_definition
  body?:    function_body
  (children): [] modifier_invocation | override_specifier | parameter | state_mutability | virtual | visibility

### false
  (leaf)

### for_statement
  body:          statement
  condition:     expression_statement | (";")
  initial:       expression_statement | variable_declaration_statement | (";")
  update?:       expression

### function_body
  (children): [] statement

### function_definition
  body?:           function_body
  name:            identifier
  return_type?:    return_type_definition
  (children): [] modifier_invocation | override_specifier | parameter | state_mutability | virtual | visibility

### hex_string_literal
  (leaf)

### identifier
  (leaf)

### if_statement
  body:       [] statement
  condition:     expression
  else?:         ("else")

### immutable
  (leaf)

### import_directive
  alias?:       [] identifier
  import_name?: [] identifier
  source:          string

### inheritance_specifier
  ancestor:               user_defined_type
  ancestor_arguments?: [] call_argument | ("(" | ")" | ",")

### inline_array_expression
  (children): [] expression

### interface_declaration
  body:     contract_body
  name:     identifier
  (children): [] inheritance_specifier

### layout_specifier
  (children):    expression

### library_declaration
  body:     contract_body
  name:     identifier

### member_expression
  object:       expression | identifier
  property:     identifier

### meta_type_expression
  (children):    type_name

### modifier_definition
  body?:    function_body
  name:     identifier
  (children): [] override_specifier | parameter | virtual

### modifier_invocation
  (children): [] call_argument | identifier

### new_expression
  name:     type_name
  (children): [] call_argument

### number_literal
  (children):    number_unit

### number_unit
  (leaf)

### override_specifier
  (children): [] user_defined_type

### parameter
  location?:    ("calldata" | "memory" | "storage")
  name?:        identifier
  type:         type_name

### parenthesized_expression
  (children):    expression

### payable_conversion_expression
  (children): [] call_argument

### pragma_directive
  (children):    any_pragma_token | solidity_pragma_token

### pragma_value
  (leaf)

### primitive_type
  (leaf)

### return_parameter
  location?:    ("calldata" | "memory" | "storage")
  type:         type_name

### return_statement
  (children):    expression

### return_type_definition
  (children): [] parameter

### revert_arguments
  (children): [] call_argument

### revert_statement
  error?:    expression
  (children):    revert_arguments

### slice_access
  base:     expression
  from?:    expression
  to?:      expression

### solidity_pragma_token
  version_constraint?: [] solidity_version | solidity_version_comparison_operator

### solidity_version
  (leaf)

### solidity_version_comparison_operator
  (leaf)

### source_file
  (children): [] constant_variable_declaration | contract_declaration | enum_declaration | error_declaration | event_definition | function_definition | import_directive | interface_declaration | library_declaration | pragma_directive | struct_declaration | user_defined_type_definition | using_directive

### state_location
  (leaf)

### state_mutability
  (leaf)

### state_variable_declaration
  location?:   [] state_location
  name:           identifier
  type:           type_name
  value?:         expression
  visibility?: [] visibility
  (children): [] immutable | override_specifier

### statement
  (children):    assembly_statement | block_statement | break_statement | continue_statement | do_while_statement | emit_statement | expression_statement | for_statement | if_statement | return_statement | revert_statement | try_statement | variable_declaration_statement | while_statement

### string
  (leaf)

### string_literal
  (children): [] string

### struct_body
  (children): [] struct_member

### struct_declaration
  body:     struct_body
  name:     identifier

### struct_expression
  type:     expression
  (children): [] struct_field_assignment

### struct_field_assignment
  name:      identifier
  value:     expression

### struct_member
  name:     identifier
  type:     type_name

### ternary_expression
  (children): [] expression

### true
  (leaf)

### try_statement
  attempt:     expression
  body:        block_statement
  (children): [] catch_clause | parameter

### tuple_expression
  (children): [] expression

### type_alias
  (children): [] identifier

### type_cast_expression
  (children): [] call_argument | primitive_type

### type_name
  key_identifier?:      identifier
  key_type?:            primitive_type | user_defined_type
  parameters?:       [] parameter | ("(" | ")" | ",")
  value_identifier?:    identifier
  value_type?:          type_name
  (children): [] expression | primitive_type | return_parameter | state_mutability | type_name | user_defined_type | visibility

### unary_expression
  argument:     expression
  operator:     ("!" | "-" | "delete" | +1 more)

### unchecked
  (leaf)

### unicode_string_literal
  (leaf)

### update_expression
  argument:     expression
  operator:     ("++" | "--")

### user_definable_operator
  (leaf)

### user_defined_type
  (children): [] identifier

### user_defined_type_definition
  name:     identifier
  (children):    primitive_type

### using_alias
  (children): [] user_definable_operator | user_defined_type

### using_directive
  source:     any_source_type | type_name
  (children): [] type_alias | using_alias

### variable_declaration
  location?:    ("calldata" | "memory" | "storage")
  name:         identifier
  type:         type_name

### variable_declaration_statement
  value?:    expression
  (children):    variable_declaration | variable_declaration_tuple

### variable_declaration_tuple
  (children): [] identifier | variable_declaration

### virtual
  (leaf)

### visibility
  (leaf)

### while_statement
  body:          statement
  condition:     expression

### yul_assignment
  (children): [] yul_boolean | yul_decimal_number | yul_function_call | yul_hex_number | yul_hex_string_literal | yul_path | yul_string_literal

### yul_block
  (children): [] yul_assignment | yul_block | yul_boolean | yul_break | yul_continue | yul_decimal_number | yul_for_statement | yul_function_call | yul_function_definition | yul_hex_number | yul_hex_string_literal | yul_if_statement | yul_label | yul_leave | yul_string_literal | yul_switch_statement | yul_variable_declaration

### yul_boolean
  (leaf)

### yul_break
  (leaf)

### yul_continue
  (leaf)

### yul_decimal_number
  (leaf)

### yul_evm_builtin
  (leaf)

### yul_for_statement
  (children): [] yul_block | yul_boolean | yul_decimal_number | yul_function_call | yul_hex_number | yul_hex_string_literal | yul_path | yul_string_literal

### yul_function_call
  function:     yul_evm_builtin | yul_identifier
  (children): [] yul_boolean | yul_decimal_number | yul_function_call | yul_hex_number | yul_hex_string_literal | yul_path | yul_string_literal

### yul_function_definition
  (children): [] yul_block | yul_identifier

### yul_hex_number
  (leaf)

### yul_hex_string_literal
  (leaf)

### yul_identifier
  (children):    identifier

### yul_if_statement
  (children): [] yul_block | yul_boolean | yul_decimal_number | yul_function_call | yul_hex_number | yul_hex_string_literal | yul_path | yul_string_literal

### yul_label
  (children):    identifier

### yul_leave
  (leaf)

### yul_path
  (children): [] yul_identifier

### yul_string_literal
  (children):    string

### yul_switch_statement
  (children): [] yul_block | yul_boolean | yul_decimal_number | yul_function_call | yul_hex_number | yul_hex_string_literal | yul_path | yul_string_literal

### yul_variable_declaration
  left:   [] yul_identifier | ("(" | ")" | ",")
  right?:    yul_boolean | yul_decimal_number | yul_function_call | yul_hex_number | yul_hex_string_literal | yul_path | yul_string_literal

