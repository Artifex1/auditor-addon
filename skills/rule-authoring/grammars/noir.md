# noir — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-noir/src/node-types.json` (103 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### access_expression
  name:      identifier | int_literal
  scope:     access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### arguments
  (children): [] access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### array_expression
  length?:    binary_expression | identifier | int_literal | parenthesized_expression | path | unary_expression
  (children): [] access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### array_type
  length?:    binary_expression | identifier | int_literal | parenthesized_expression | path | unary_expression
  (children):    array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type

### assign_statement
  left:      access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe
  right:     access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### associated_type
  name:     identifier
  type:     array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type

### attribute_item
  (children):    content

### binary_expression
  left:         access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe
  operator:     ("!=" | "%" | "&" | +13 more)
  right:        access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### block
  (children): [] access_expression | array_expression | assign_statement | binary_expression | block | bool_literal | break_statement | call_expression | cast_expression | comptime | constrain_statement | continue_statement | expression_statement | fmt_str_literal | for_statement | generic_function | identifier | if_expression | index_expression | int_literal | lambda | let_statement | parenthesized_expression | path | quote_expression | raw_str_literal | return_statement | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### block_comment
  content?:    doc_comment
  style?:      inner_doc_style | outer_doc_style

### bool_literal
  (leaf)

### break_statement
  (leaf)

### call_expression
  arguments:  [] arguments | ("!")
  function:      access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### capture_environment
  (children):    array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type

### cast_expression
  type:      array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type
  value:     access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### comptime
  (children):    block | for_statement | let_statement

### constrain_statement
  arguments:     arguments

### constrained_type
  name:     identifier
  type:     array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type

### content
  (leaf)

### continue_statement
  (leaf)

### crate
  (leaf)

### declaration_list
  (children): [] function_item | function_signature_item | trait_constant | trait_type

### dep
  (leaf)

### doc_comment
  (leaf)

### escape_sequence
  (leaf)

### expression_statement
  (children):    access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### field_initializer
  field?:    identifier
  value?:    access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe
  (children):    identifier

### fmt_str_literal
  (children): [] str_content

### for_statement
  body:      block
  range:     access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | range_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe
  value:     identifier

### function_item
  body:                block
  name:                identifier
  parameters:          parameters
  return_type?:        return_type
  type_parameters?:    type_parameters
  (children): [] modifiers | visibility_modifier | where_clause

### function_signature_item
  name:                identifier
  parameters:          parameters
  return_type?:        return_type
  type_parameters?:    type_parameters
  (children): [] modifiers | visibility_modifier | where_clause

### function_type
  environment?:    capture_environment
  parameters:      parameters
  return_type:     return_type
  (children):    modifiers

### generic
  trait:               identifier | path
  type_parameters:     type_parameters

### generic_function
  function:           access_expression | identifier
  type_arguments:     type_parameters

### global_item
  name:     identifier
  type?: [] array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type | (":")
  (children): [] access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | modifiers | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe | visibility_modifier

### identifier
  (leaf)

### if_expression
  alternative?:    block | if_expression
  condition:       access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe
  consequence:     block

### impl_item
  body:                trait_impl_body
  trait?:              generic | identifier | path
  type:                array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type
  type_parameters?:    type_parameters
  (children):    where_clause

### index_expression
  collection:     access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe
  index:          access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### initializer_list
  (children): [] field_initializer

### inner_doc_style
  (leaf)

### int_literal
  (leaf)

### item_list
  (children): [] attribute_item | function_item | global_item | impl_item | module_or_contract_item | struct_item | trait_item | type_item | use_item

### lambda
  body:            access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe
  parameters:      lambda_parameters
  return_type?:    lambda_return_type

### lambda_parameters
  (children): [] identifier | mut_pattern | parameter | struct_pattern | tuple_pattern

### lambda_return_type
  type:     array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type

### let_statement
  name?:       identifier
  pattern?:    identifier | mut_pattern | struct_pattern | tuple_pattern
  type?:    [] array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type | (":")
  value:       access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe
  (children):    mutable_modifier

### line_comment
  content?:    doc_comment
  style?:      inner_doc_style | outer_doc_style

### modifiers
  (leaf)

### module_or_contract_item
  body?:    item_list
  name:     identifier
  (children):    visibility_modifier

### mut_pattern
  (children): [] identifier | mutable_modifier | struct_pattern | tuple_pattern

### mutable_modifier
  (leaf)

### outer_doc_style
  (leaf)

### parameter
  pattern:     identifier | mut_pattern | self | struct_pattern | tuple_pattern
  type:     [] array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type | visible_type | (":")

### parameters
  (children): [] array_type | function_type | generic | identifier | parameter | path | primitive_type | reference_type | self_pattern | tuple_type | unit_type

### parenthesized_expression
  (children):    access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### path
  alias?:              generic | identifier | path
  list?:               use_list
  name?:               identifier
  scope?:              crate | dep | identifier | path | super | use_list
  type?:               array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type
  type_parameters?:    type_parameters

### primitive_type
  type_arguments?:    type_arguments
  (children):    binary_expression | identifier | int_literal | parenthesized_expression | path | unary_expression

### quote_expr_unquote
  (leaf)

### quote_expression
  tokens?:    token_stream | unquote_expression

### range_expression
  (children): [] access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### raw_str_literal
  (children):    str_content

### reference_type
  (children): [] array_type | function_type | generic | identifier | mutable_modifier | path | primitive_type | reference_type | tuple_type | unit_type

### return_statement
  (children):    access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### return_type
  type:     array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type
  (children):    visibility

### self
  (leaf)

### self_pattern
  (children): [] mutable_modifier | self

### slice_expression
  (children):    array_expression

### source_file
  (children): [] attribute_item | function_item | global_item | impl_item | module_or_contract_item | struct_item | trait_item | type_item | use_item

### str_content
  (leaf)

### str_literal
  (children): [] escape_sequence | str_content

### struct_expression
  body:     initializer_list
  name:     identifier | path

### struct_field_item
  name:     identifier
  type:     array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type
  (children):    visibility_modifier

### struct_field_list
  (children): [] struct_field_item

### struct_item
  body?:               struct_field_list
  name:                identifier
  type_parameters?:    type_parameters
  (children):    visibility_modifier

### struct_pattern
  type:     identifier | path
  (children): [] struct_pattern_field

### struct_pattern_field
  (children): [] identifier | mut_pattern | struct_pattern | tuple_pattern

### super
  (leaf)

### token_stream
  (leaf)

### trait_bounds
  (children): [] generic | identifier | path

### trait_constant
  name:     identifier
  type:     array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type

### trait_impl_body
  (children): [] attribute_item | function_item | let_statement | trait_impl_type

### trait_impl_type
  alias:     array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type
  name:      identifier

### trait_item
  body?:               declaration_list
  bounds?:          [] trait_bounds | (":" | "=")
  name:                identifier
  type_parameters?:    type_parameters
  (children): [] visibility_modifier | where_clause

### trait_type
  bounds?: [] trait_bounds | (":")
  name:       identifier

### tuple_expression
  (children): [] access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### tuple_pattern
  (children): [] identifier | mut_pattern | struct_pattern | tuple_pattern

### tuple_type
  (children): [] array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type

### type_arguments
  (children): [] array_type | binary_expression | function_type | generic | identifier | int_literal | parenthesized_expression | path | primitive_type | reference_type | tuple_type | unary_expression | unit_type

### type_item
  name:                identifier
  type:                array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type
  type_parameters?:    type_parameters
  (children):    visibility_modifier

### type_parameters
  (children): [] array_type | associated_type | binary_expression | constrained_type | function_type | generic | identifier | int_literal | parenthesized_expression | path | primitive_type | reference_type | tuple_type | unary_expression | unit_type

### unary_expression
  (children):    access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### unit_expression
  (leaf)

### unit_type
  (leaf)

### unquote_expression
  (children): [] access_expression | array_expression | binary_expression | block | bool_literal | call_expression | cast_expression | comptime | fmt_str_literal | generic_function | identifier | if_expression | index_expression | int_literal | lambda | parenthesized_expression | path | quote_expr_unquote | quote_expression | raw_str_literal | slice_expression | str_literal | struct_expression | tuple_expression | unary_expression | unit_expression | unsafe

### unsafe
  (children):    block

### use_item
  decl:     identifier | path | use_list
  (children):    visibility_modifier

### use_list
  (children): [] identifier | path | use_list

### visibility
  (children):    int_literal

### visibility_modifier
  (leaf)

### visible_type
  (children): [] array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type | visibility

### where_clause
  (children): [] where_constraint

### where_constraint
  bounds:  [] trait_bounds | (":")
  type:       array_type | function_type | generic | identifier | path | primitive_type | reference_type | tuple_type | unit_type

