# go — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-go/src/node-types.json` (112 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### _expression
  (leaf)

### _simple_statement
  (leaf)

### _simple_type
  (leaf)

### _statement
  (leaf)

### _type
  (leaf)

### argument_list
  (children): [] _expression | _type | variadic_argument

### array_type
  element:     _type
  length:      _expression

### assignment_statement
  left:         expression_list
  operator:     ("%=" | "&=" | "&^=" | +9 more)
  right:        expression_list

### binary_expression
  left:         _expression
  operator:     ("!=" | "%" | "&" | +16 more)
  right:        _expression

### blank_identifier
  (leaf)

### block
  (children):    statement_list

### break_statement
  (children):    label_name

### call_expression
  arguments:          argument_list
  function:           _expression
  type_arguments?:    type_arguments

### channel_type
  value:     _type

### comment
  (leaf)

### communication_case
  communication:     receive_statement | send_statement
  (children):    statement_list

### composite_literal
  body:     literal_value
  type:     array_type | generic_type | implicit_length_array_type | map_type | qualified_type | slice_type | struct_type | type_identifier

### const_declaration
  (children): [] const_spec

### const_spec
  name:   [] identifier | (",")
  type?:     _type
  value?:    expression_list

### continue_statement
  (children):    label_name

### dec_statement
  (children):    _expression

### default_case
  (children):    statement_list

### defer_statement
  (children):    _expression

### dot
  (leaf)

### empty_statement
  (leaf)

### escape_sequence
  (leaf)

### expression_case
  value:     expression_list
  (children):    statement_list

### expression_list
  (children): [] _expression

### expression_statement
  (children):    _expression

### expression_switch_statement
  initializer?:    _simple_statement
  value?:          _expression
  (children): [] default_case | expression_case

### fallthrough_statement
  (leaf)

### false
  (leaf)

### field_declaration
  name?: [] field_identifier
  tag?:     interpreted_string_literal | raw_string_literal
  type:     _type | generic_type | qualified_type | type_identifier

### field_declaration_list
  (children): [] field_declaration

### field_identifier
  (leaf)

### float_literal
  (leaf)

### for_clause
  condition?:      _expression
  initializer?:    _simple_statement
  update?:         _simple_statement

### for_statement
  body:     block
  (children):    _expression | for_clause | range_clause

### func_literal
  body:           block
  parameters:     parameter_list
  result?:        _simple_type | parameter_list

### function_declaration
  body?:               block
  name:                identifier
  parameters:          parameter_list
  result?:             _simple_type | parameter_list
  type_parameters?:    type_parameter_list

### function_type
  parameters:     parameter_list
  result?:        _simple_type | parameter_list

### generic_type
  type:               negated_type | qualified_type | type_identifier
  type_arguments:     type_arguments

### go_statement
  (children):    _expression

### goto_statement
  (children):    label_name

### identifier
  (leaf)

### if_statement
  alternative?:    block | if_statement
  condition:       _expression
  consequence:     block
  initializer?:    _simple_statement

### imaginary_literal
  (leaf)

### implicit_length_array_type
  element:     _type

### import_declaration
  (children):    import_spec | import_spec_list

### import_spec
  name?:    blank_identifier | dot | package_identifier
  path:     interpreted_string_literal | raw_string_literal

### import_spec_list
  (children): [] import_spec

### inc_statement
  (children):    _expression

### index_expression
  index:       _expression
  operand:     _expression

### int_literal
  (leaf)

### interface_type
  (children): [] method_elem | type_elem

### interpreted_string_literal
  (children): [] escape_sequence | interpreted_string_literal_content

### interpreted_string_literal_content
  (leaf)

### iota
  (leaf)

### keyed_element
  key:       literal_element
  value:     literal_element

### label_name
  (leaf)

### labeled_statement
  label:     label_name
  (children):    _statement

### literal_element
  (children):    _expression | literal_value

### literal_value
  (children): [] keyed_element | literal_element

### map_type
  key:       _type
  value:     _type

### method_declaration
  body?:          block
  name:           field_identifier
  parameters:     parameter_list
  receiver:       parameter_list
  result?:        _simple_type | parameter_list

### method_elem
  name:           field_identifier
  parameters:     parameter_list
  result?:        _simple_type | parameter_list

### negated_type
  (children):    _type

### nil
  (leaf)

### package_clause
  (children):    package_identifier

### package_identifier
  (leaf)

### parameter_declaration
  name?: [] identifier
  type:     _type

### parameter_list
  (children): [] parameter_declaration | variadic_parameter_declaration

### parenthesized_expression
  (children):    _expression

### parenthesized_type
  (children):    _type

### pointer_type
  (children):    _type

### qualified_type
  name:        type_identifier
  package:     package_identifier

### range_clause
  left?:     expression_list
  right:     _expression

### raw_string_literal
  (children):    raw_string_literal_content

### raw_string_literal_content
  (leaf)

### receive_statement
  left?:     expression_list
  right:     _expression

### return_statement
  (children):    expression_list

### rune_literal
  (leaf)

### select_statement
  (children): [] communication_case | default_case

### selector_expression
  field:       field_identifier
  operand:     _expression

### send_statement
  channel:     _expression
  value:       _expression

### short_var_declaration
  left:      expression_list
  right:     expression_list

### slice_expression
  capacity?:    _expression
  end?:         _expression
  operand:      _expression
  start?:       _expression

### slice_type
  element:     _type

### source_file
  (children): [] _statement | function_declaration | import_declaration | method_declaration | package_clause

### statement_list
  (children): [] _statement

### struct_type
  (children):    field_declaration_list

### true
  (leaf)

### type_alias
  name:                type_identifier
  type:                _type
  type_parameters?:    type_parameter_list

### type_arguments
  (children): [] type_elem

### type_assertion_expression
  operand:     _expression
  type:        _type

### type_case
  type:  [] _type | (",")
  (children):    statement_list

### type_constraint
  (children): [] _type

### type_conversion_expression
  operand:     _expression
  type:        _type

### type_declaration
  (children): [] type_alias | type_spec

### type_elem
  (children): [] _type

### type_identifier
  (leaf)

### type_instantiation_expression
  type:     _type
  (children): [] _type

### type_parameter_declaration
  name:  [] identifier
  type:     type_constraint

### type_parameter_list
  (children): [] type_parameter_declaration

### type_spec
  name:                type_identifier
  type:                _type
  type_parameters?:    type_parameter_list

### type_switch_statement
  alias?:          expression_list
  initializer?:    _simple_statement
  value:           _expression
  (children): [] default_case | type_case

### unary_expression
  operand:      _expression
  operator:     ("!" | "&" | "*" | +4 more)

### var_declaration
  (children):    var_spec | var_spec_list

### var_spec
  name:   [] identifier
  type?:     _type
  value?:    expression_list

### var_spec_list
  (children): [] var_spec

### variadic_argument
  (children):    _expression

### variadic_parameter_declaration
  name?:    identifier
  type:     _type

