# cairo — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-cairo/src/node-types.json` (121 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### _declaration_statement
  (leaf)

### _literal
  (leaf)

### _literal_pattern
  (leaf)

### _pattern
  (leaf)

### _type
  (leaf)

### arguments
  (children): [] attribute_item | expression | named_argument | ref_specifier

### array_expression
  length?:    expression
  (children): [] attribute_item | expression

### array_type
  element:     _type
  length?:     expression

### assignment_expression
  left:      expression
  right:     expression

### associated_impl
  name:     identifier
  (children):    _type

### associated_type
  name:                type_identifier
  type_parameters?:    type_parameters

### attribute
  arguments?:    token_tree
  value?:        expression
  (children):    identifier | scoped_identifier | super

### attribute_item
  (children):    attribute

### base_field_initializer
  (children):    expression

### binary_expression
  left:         expression
  operator:     ("!=" | "%" | "&" | +15 more)
  right:        expression

### block
  (children): [] _declaration_statement | expression | expression_statement

### boolean_literal
  (leaf)

### break_expression
  (children):    expression

### call_expression
  arguments:     arguments
  function:      expression_except_range

### closure_expression
  body:            block | expression | ("_")
  parameters:      closure_parameters
  return_type?:    _type

### closure_parameters
  (children): [] _pattern | parameter

### compound_assignment_expr
  left:         expression
  operator:     ("%=" | "*=" | "+=" | +2 more)
  right:        expression

### const_item
  name:      identifier
  type:      _type
  value?:    expression
  (children):    visibility_modifier

### const_parameter
  name:     identifier
  type:     _type

### constrained_type_parameter
  bound?:    _type
  left?:  [] type_identifier | (":" | "impl")
  (children): [] _type

### continue_expression
  (leaf)

### crate
  (leaf)

### declaration_list
  (children): [] _declaration_statement

### else_clause
  (children):    block | if_expression

### empty_statement
  (leaf)

### enum_item
  body:                enum_variant_list
  name:                type_identifier
  type_parameters?:    type_parameters
  (children):    visibility_modifier

### enum_variant
  variant:     field_declaration | identifier
  (children):    visibility_modifier

### enum_variant_list
  (children): [] attribute_item | enum_variant

### expression
  (leaf)

### expression_except_range
  (leaf)

### expression_statement
  (children):    block | expression | for_expression | if_expression | loop_expression | match_expression | while_expression

### extern
  (leaf)

### extern_type
  name:                type_identifier
  type_parameters?:    type_parameters
  (children): [] extern | visibility_modifier

### external_function_item
  (children): [] extern | function | visibility_modifier

### field_declaration
  name:     field_identifier
  type:     _type
  (children):    visibility_modifier

### field_declaration_list
  (children): [] attribute_item | field_declaration

### field_expression
  field:     field_identifier | numeric_literal
  value:     expression

### field_identifier
  (children):    primitive_type

### field_initializer
  field:     field_identifier | numeric_literal
  value:     expression
  (children): [] attribute_item

### field_initializer_list
  (children): [] base_field_initializer | field_initializer | shorthand_field_initializer

### field_pattern
  name:        field_identifier | shorthand_field_identifier
  pattern?:    _pattern
  (children):    mutable_specifier

### for_expression
  body:        block
  pattern:     _pattern
  value:       expression

### function
  implicit_arguments?: [] _type | ("," | "implicits")
  name:                   identifier
  parameters:             parameters
  return_type?:           _type
  type_parameters?:       type_parameters
  (children):    nopanic

### function_item
  body:     block
  (children): [] function | visibility_modifier

### function_signature_item
  (children): [] function | visibility_modifier

### generic_function
  function:           field_expression | identifier | scoped_identifier
  type_arguments:     type_arguments

### generic_type
  type:               identifier | scoped_identifier | scoped_type_identifier | type_identifier
  type_arguments:     type_arguments

### generic_type_with_turbofish
  type:               identifier | scoped_identifier | type_identifier
  type_arguments:     type_arguments

### identifier
  (children):    primitive_type

### if_expression
  alternative?:    else_clause
  condition:       expression | let_condition
  consequence:     block

### impl_item
  body?:               declaration_list
  type_parameters?:    type_parameters
  (children): [] _type | identifier | visibility_modifier

### index_expression
  (children): [] expression

### inner_attribute_item
  (children):    attribute

### let_condition
  pattern:     _pattern
  value:       expression

### let_declaration
  else_block?:    block
  pattern:        _pattern
  type?:          _type
  value:          expression
  (children):    mutable_specifier

### line_comment
  (leaf)

### loop_expression
  body:     block

### macro_body
  (children): [] macro_rule

### macro_declaration
  body:     macro_body
  name:     identifier
  (children):    visibility_modifier

### macro_invocation
  macro:     identifier | scoped_identifier
  (children):    token_tree

### macro_rule
  expansion?:    token_tree
  pattern:       token_tree

### match_arm
  (children):    match_arm_content

### match_arm_content
  pattern:     match_pattern
  value:       expression
  (children): [] attribute_item | inner_attribute_item

### match_block
  (children): [] match_arm

### match_expression
  body:      match_block
  value:     expression

### match_pattern
  condition?:    expression | let_condition
  (children):    _pattern

### mod_item
  body?:    declaration_list
  name:     identifier
  (children):    visibility_modifier

### mut_pattern
  (children): [] _pattern | mutable_specifier

### mutable_specifier
  (leaf)

### named_argument
  (children): [] expression | identifier

### negative_literal
  (children):    numeric_literal

### nopanic
  (leaf)

### numeric_literal
  (leaf)

### or_pattern
  (children): [] _pattern

### parameter
  pattern:     _pattern
  type:        _type
  (children):    mutable_specifier | ref_specifier

### parameters
  (children): [] _type | attribute_item | parameter

### parenthesized_expression
  (children):    expression

### primitive_type
  (leaf)

### range_expression
  (children): [] expression

### range_pattern
  (children): [] _literal_pattern | identifier | scoped_identifier | super

### ref_specifier
  (leaf)

### return_expression
  (children):    expression

### scoped_identifier
  name:     identifier | super
  path?:    generic_type | identifier | scoped_identifier | super

### scoped_type_identifier
  name:     type_identifier
  path?:    generic_type | identifier | scoped_identifier | super

### scoped_use_list
  list:     use_list
  path?:    identifier | scoped_identifier | super

### shorthand_field_identifier
  (children):    primitive_type

### shorthand_field_initializer
  (children): [] attribute_item | identifier

### shortstring_literal
  (leaf)

### slice_pattern
  (children): [] _pattern

### snapshot_type
  type:     _type

### source_file
  (children): [] _declaration_statement | expression_statement

### string_literal
  (leaf)

### struct_expression
  body:     field_initializer_list
  name:     generic_type_with_turbofish | scoped_type_identifier | type_identifier

### struct_item
  body?:               field_declaration_list
  name:                type_identifier
  type_parameters?:    type_parameters
  (children):    visibility_modifier

### struct_pattern
  type:     scoped_type_identifier | type_identifier
  (children): [] field_pattern

### super
  (leaf)

### token_tree
  (children): [] _literal | identifier | mutable_specifier | super | token_tree

### trait_item
  body?:               declaration_list
  name:                type_identifier
  type_parameters?:    type_parameters
  (children):    visibility_modifier

### try_expression
  (children):    expression

### tuple_enum_pattern
  type:     generic_type | identifier | scoped_identifier
  (children): [] _pattern

### tuple_expression
  (children): [] attribute_item | expression

### tuple_pattern
  (children): [] _pattern | closure_expression

### tuple_type
  (children): [] _type

### type_arguments
  (children): [] _literal | _type | block | identifier

### type_identifier
  (children):    primitive_type

### type_item
  name?:               type_identifier
  type?:               _type
  type_parameters?:    type_parameters
  (children):    extern_type | visibility_modifier

### type_parameters
  (children): [] attribute_item | const_parameter | constrained_type_parameter | generic_type | generic_type_with_turbofish | type_identifier

### unary_expression
  (children):    expression

### unit_expression
  (leaf)

### unit_type
  (leaf)

### use_as_clause
  alias:     identifier
  path:      identifier | scoped_identifier | super

### use_declaration
  argument:     identifier | scoped_identifier | scoped_use_list | super | use_as_clause | use_list | use_wildcard
  (children):    visibility_modifier

### use_list
  (children): [] identifier | scoped_identifier | scoped_use_list | super | use_as_clause | use_list | use_wildcard

### use_wildcard
  (children):    identifier | scoped_identifier | super

### visibility_modifier
  (children):    crate | identifier | scoped_identifier | super

### while_expression
  body:          block
  condition:     expression | let_condition

