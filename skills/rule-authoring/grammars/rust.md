# rust — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-rust/src/node-types.json` (169 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### _declaration_statement
  (leaf)

### _expression
  (leaf)

### _literal
  (leaf)

### _literal_pattern
  (leaf)

### _pattern
  (leaf)

### _type
  (leaf)

### abstract_type
  trait:     bounded_type | function_type | generic_type | removed_trait_bound | scoped_type_identifier | tuple_type | type_identifier
  (children):    type_parameters

### arguments
  (children): [] _expression | attribute_item

### array_expression
  length?:    _expression
  (children): [] _expression | attribute_item

### array_type
  element:     _type
  length?:     _expression

### assignment_expression
  left:      _expression
  right:     _expression

### associated_type
  bounds?:             trait_bounds
  name:                type_identifier
  type_parameters?:    type_parameters
  (children):    where_clause

### async_block
  (children):    block

### attribute
  arguments?:    token_tree
  value?:        _expression
  (children):    crate | identifier | metavariable | scoped_identifier | self | super

### attribute_item
  (children):    attribute

### await_expression
  (children):    _expression

### base_field_initializer
  (children):    _expression

### binary_expression
  left:         _expression
  operator:     ("!=" | "%" | "&" | +15 more)
  right:        _expression

### block
  (children): [] _declaration_statement | _expression | expression_statement | label

### block_comment
  doc?:      doc_comment
  inner?:    inner_doc_comment_marker
  outer?:    outer_doc_comment_marker

### boolean_literal
  (leaf)

### bounded_type
  (children): [] _type | lifetime | use_bounds

### bracketed_type
  (children):    _type | qualified_type

### break_expression
  (children): [] _expression | label

### call_expression
  arguments:     arguments
  function:      _literal | array_expression | assignment_expression | async_block | await_expression | binary_expression | block | break_expression | call_expression | closure_expression | compound_assignment_expr | const_block | continue_expression | field_expression | for_expression | gen_block | generic_function | identifier | if_expression | index_expression | loop_expression | macro_invocation | match_expression | metavariable | parenthesized_expression | reference_expression | return_expression | scoped_identifier | self | struct_expression | try_block | try_expression | tuple_expression | type_cast_expression | unary_expression | unit_expression | unsafe_block | while_expression | yield_expression

### captured_pattern
  (children): [] _pattern

### char_literal
  (leaf)

### closure_expression
  body:            _expression | ("_")
  parameters:      closure_parameters
  return_type?:    _type

### closure_parameters
  (children): [] _pattern | parameter

### compound_assignment_expr
  left:         _expression
  operator:     ("%=" | "&=" | "*=" | +7 more)
  right:        _expression

### const_block
  body:     block

### const_item
  name:      identifier
  type:      _type
  value?:    _expression
  (children):    visibility_modifier

### const_parameter
  name:      identifier
  type:      _type
  value?:    _literal | block | identifier | negative_literal

### continue_expression
  (children):    label

### crate
  (leaf)

### declaration_list
  (children): [] _declaration_statement

### doc_comment
  (leaf)

### dynamic_type
  trait:     function_type | generic_type | higher_ranked_trait_bound | scoped_type_identifier | tuple_type | type_identifier

### else_clause
  (children):    block | if_expression

### empty_statement
  (leaf)

### enum_item
  body:                enum_variant_list
  name:                type_identifier
  type_parameters?:    type_parameters
  (children): [] visibility_modifier | where_clause

### enum_variant
  body?:     field_declaration_list | ordered_field_declaration_list
  name:      identifier
  value?:    _expression
  (children):    visibility_modifier

### enum_variant_list
  (children): [] attribute_item | enum_variant

### escape_sequence
  (leaf)

### expression_statement
  (children):    _expression

### extern_crate_declaration
  alias?:    identifier
  name:      identifier
  (children): [] crate | visibility_modifier

### extern_modifier
  (children):    string_literal

### field_declaration
  name:     field_identifier
  type:     _type
  (children):    visibility_modifier

### field_declaration_list
  (children): [] attribute_item | field_declaration

### field_expression
  field:     field_identifier | integer_literal
  value:     _expression

### field_identifier
  (leaf)

### field_initializer
  field:     field_identifier | integer_literal
  value:     _expression
  (children): [] attribute_item

### field_initializer_list
  (children): [] base_field_initializer | field_initializer | shorthand_field_initializer

### field_pattern
  name:        field_identifier | shorthand_field_identifier
  pattern?:    _pattern
  (children):    mutable_specifier

### float_literal
  (leaf)

### for_expression
  body:        block
  pattern:     _pattern
  value:       _expression
  (children):    label

### for_lifetimes
  (children): [] lifetime

### foreign_mod_item
  body?:    declaration_list
  (children):    extern_modifier

### fragment_specifier
  (leaf)

### function_item
  body:                block
  name:                identifier | metavariable
  parameters:          parameters
  return_type?:        _type
  type_parameters?:    type_parameters
  (children): [] function_modifiers | visibility_modifier | where_clause

### function_modifiers
  (children): [] extern_modifier

### function_signature_item
  name:                identifier | metavariable
  parameters:          parameters
  return_type?:        _type
  type_parameters?:    type_parameters
  (children): [] function_modifiers | visibility_modifier | where_clause

### function_type
  parameters:      parameters
  return_type?:    _type
  trait?:          scoped_type_identifier | type_identifier
  (children): [] for_lifetimes | function_modifiers

### gen_block
  (children):    block

### generic_function
  function:           field_expression | identifier | scoped_identifier
  type_arguments:     type_arguments

### generic_pattern
  type_arguments:     type_arguments
  (children):    identifier | scoped_identifier

### generic_type
  type:               identifier | scoped_identifier | scoped_type_identifier | type_identifier
  type_arguments:     type_arguments

### generic_type_with_turbofish
  type:               scoped_identifier | type_identifier
  type_arguments:     type_arguments

### higher_ranked_trait_bound
  type:                _type
  type_parameters:     type_parameters

### identifier
  (leaf)

### if_expression
  alternative?:    else_clause
  condition:       _expression | let_chain | let_condition
  consequence:     block

### impl_item
  body?:               declaration_list
  trait?:              generic_type | scoped_type_identifier | type_identifier
  type:                _type
  type_parameters?:    type_parameters
  (children):    where_clause

### index_expression
  (children): [] _expression

### inner_attribute_item
  (children):    attribute

### inner_doc_comment_marker
  (leaf)

### integer_literal
  (leaf)

### label
  (children):    identifier

### let_chain
  (children): [] _expression | let_condition

### let_condition
  pattern:     _pattern
  value:       _expression

### let_declaration
  alternative?:    block
  pattern:         _pattern
  type?:           _type
  value?:          _expression
  (children):    mutable_specifier

### lifetime
  (children):    identifier

### lifetime_parameter
  bounds?:    trait_bounds
  name:       lifetime

### line_comment
  doc?:      doc_comment
  inner?:    inner_doc_comment_marker
  outer?:    outer_doc_comment_marker

### loop_expression
  body:     block
  (children):    label

### macro_definition
  name:     identifier
  (children): [] macro_rule

### macro_invocation
  macro:     identifier | scoped_identifier
  (children):    token_tree

### macro_rule
  left:      token_tree_pattern
  right:     token_tree

### match_arm
  pattern:     match_pattern
  value:       _expression
  (children): [] attribute_item | inner_attribute_item

### match_block
  (children): [] match_arm

### match_expression
  body:      match_block
  value:     _expression

### match_pattern
  condition?:    _expression | let_chain | let_condition
  (children):    _pattern

### metavariable
  (leaf)

### mod_item
  body?:    declaration_list
  name:     identifier
  (children):    visibility_modifier

### mut_pattern
  (children): [] _pattern | mutable_specifier

### mutable_specifier
  (leaf)

### negative_literal
  (children):    float_literal | integer_literal

### never_type
  (leaf)

### or_pattern
  (children): [] _pattern

### ordered_field_declaration_list
  type?: [] _type
  (children): [] attribute_item | visibility_modifier

### outer_doc_comment_marker
  (leaf)

### parameter
  pattern:     _pattern | self
  type:        _type
  (children):    mutable_specifier

### parameters
  (children): [] _type | attribute_item | parameter | self_parameter | variadic_parameter

### parenthesized_expression
  (children):    _expression

### pointer_type
  type:     _type
  (children):    mutable_specifier

### primitive_type
  (leaf)

### qualified_type
  alias:     _type
  type:      _type

### range_expression
  (children): [] _expression

### range_pattern
  left?:     _literal_pattern | crate | identifier | metavariable | scoped_identifier | self | super
  right?:    _literal_pattern | crate | identifier | metavariable | scoped_identifier | self | super

### raw_string_literal
  (children):    string_content

### ref_pattern
  (children):    _pattern

### reference_expression
  value:     _expression
  (children):    mutable_specifier

### reference_pattern
  (children): [] _pattern | mutable_specifier

### reference_type
  type:     _type
  (children): [] lifetime | mutable_specifier

### remaining_field_pattern
  (leaf)

### removed_trait_bound
  (children):    _type

### return_expression
  (children):    _expression

### scoped_identifier
  name:     identifier | super
  path?:    bracketed_type | crate | generic_type | identifier | metavariable | scoped_identifier | self | super

### scoped_type_identifier
  name:     type_identifier
  path?:    bracketed_type | crate | generic_type | identifier | metavariable | scoped_identifier | self | super

### scoped_use_list
  list:     use_list
  path?:    crate | identifier | metavariable | scoped_identifier | self | super

### self
  (leaf)

### self_parameter
  (children): [] lifetime | mutable_specifier | self

### shebang
  (leaf)

### shorthand_field_identifier
  (leaf)

### shorthand_field_initializer
  (children): [] attribute_item | identifier

### slice_pattern
  (children): [] _pattern

### source_file
  (children): [] _declaration_statement | expression_statement | shebang

### static_item
  name:      identifier
  type:      _type
  value?:    _expression
  (children): [] mutable_specifier | visibility_modifier

### string_content
  (leaf)

### string_literal
  (children): [] escape_sequence | string_content

### struct_expression
  body:     field_initializer_list
  name:     generic_type_with_turbofish | scoped_type_identifier | type_identifier

### struct_item
  body?:               field_declaration_list | ordered_field_declaration_list
  name:                type_identifier
  type_parameters?:    type_parameters
  (children): [] visibility_modifier | where_clause

### struct_pattern
  type:     scoped_type_identifier | type_identifier
  (children): [] field_pattern | remaining_field_pattern

### super
  (leaf)

### token_binding_pattern
  name:     metavariable
  type:     fragment_specifier

### token_repetition
  (children): [] _literal | crate | identifier | metavariable | mutable_specifier | primitive_type | self | super | token_repetition | token_tree

### token_repetition_pattern
  (children): [] _literal | crate | identifier | metavariable | mutable_specifier | primitive_type | self | super | token_binding_pattern | token_repetition_pattern | token_tree_pattern

### token_tree
  (children): [] _literal | crate | identifier | metavariable | mutable_specifier | primitive_type | self | super | token_repetition | token_tree

### token_tree_pattern
  (children): [] _literal | crate | identifier | metavariable | mutable_specifier | primitive_type | self | super | token_binding_pattern | token_repetition_pattern | token_tree_pattern

### trait_bounds
  (children): [] _type | higher_ranked_trait_bound | lifetime

### trait_item
  body:                declaration_list
  bounds?:             trait_bounds
  name:                type_identifier
  type_parameters?:    type_parameters
  (children): [] visibility_modifier | where_clause

### try_block
  (children):    block

### try_expression
  (children):    _expression

### tuple_expression
  (children): [] _expression | attribute_item

### tuple_pattern
  (children): [] _pattern | closure_expression

### tuple_struct_pattern
  type:     generic_type | identifier | scoped_identifier
  (children): [] _pattern

### tuple_type
  (children): [] _type

### type_arguments
  (children): [] _literal | _type | block | lifetime | trait_bounds | type_binding

### type_binding
  name:               type_identifier
  type:               _type
  type_arguments?:    type_arguments

### type_cast_expression
  type:      _type
  value:     _expression

### type_identifier
  (leaf)

### type_item
  name:                type_identifier
  type:                _type
  type_parameters?:    type_parameters
  (children): [] visibility_modifier | where_clause

### type_parameter
  bounds?:          trait_bounds
  default_type?:    _type
  name:             type_identifier

### type_parameters
  (children): [] attribute_item | const_parameter | lifetime_parameter | metavariable | type_parameter

### unary_expression
  (children):    _expression

### union_item
  body:                field_declaration_list
  name:                type_identifier
  type_parameters?:    type_parameters
  (children): [] visibility_modifier | where_clause

### unit_expression
  (leaf)

### unit_type
  (leaf)

### unsafe_block
  (children):    block

### use_as_clause
  alias:     identifier
  path:      crate | identifier | metavariable | scoped_identifier | self | super

### use_bounds
  (children): [] lifetime | type_identifier

### use_declaration
  argument:     crate | identifier | metavariable | scoped_identifier | scoped_use_list | self | super | use_as_clause | use_list | use_wildcard
  (children):    visibility_modifier

### use_list
  (children): [] crate | identifier | metavariable | scoped_identifier | scoped_use_list | self | super | use_as_clause | use_list | use_wildcard

### use_wildcard
  (children):    crate | identifier | metavariable | scoped_identifier | self | super

### variadic_parameter
  pattern?:    _pattern
  (children):    mutable_specifier

### visibility_modifier
  (children):    crate | identifier | metavariable | scoped_identifier | self | super

### where_clause
  (children): [] where_predicate

### where_predicate
  bounds:     trait_bounds
  left:       array_type | generic_type | higher_ranked_trait_bound | lifetime | pointer_type | primitive_type | reference_type | scoped_type_identifier | tuple_type | type_identifier

### while_expression
  body:          block
  condition:     _expression | let_chain | let_condition
  (children):    label

### yield_expression
  (children):    _expression

