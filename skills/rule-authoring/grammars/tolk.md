# tolk — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-tolk/src/node-types.json` (90 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### annotation
  arguments?:    annotation_arguments
  name?:         identifier

### annotation_arguments
  (children): [] assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### annotation_list
  (children): [] annotation

### argument_list
  (children): [] call_argument

### asm_body
  rearrange?:    asm_body_rearrange
  (children): [] string_literal

### asm_body_rearrange
  params?:    asm_body_rearrange_params
  return?:    asm_body_rearrange_return

### asm_body_rearrange_params
  (children): [] identifier

### asm_body_rearrange_return
  (children): [] number_literal

### assert_statement
  condition:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  excNo:         assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### assignment
  left:      assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  right:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### binary_operator
  operator_name:     ("!=" | "%" | "&" | +20 more)
  (children): [] assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### block_statement
  (children): [] assert_statement | block_statement | break_statement | continue_statement | do_while_statement | empty_statement | expression_statement | if_statement | local_vars_declaration | match_statement | repeat_statement | return_statement | throw_statement | try_catch_statement | while_statement

### boolean_literal
  (leaf)

### break_statement
  (leaf)

### builtin_specifier
  (leaf)

### call_argument
  expr:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### cast_as_operator
  casted_to:     fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type
  expr:          assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### catch_clause
  catch_body:     block_statement
  catch_var1?:    identifier
  catch_var2?:    identifier

### comment
  (leaf)

### constant_declaration
  annotations?:    annotation_list
  name:            identifier
  type?:           fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type
  value:           assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### continue_statement
  (leaf)

### do_while_statement
  body:          block_statement
  condition:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### dot_access
  field:     identifier | numeric_index
  obj:       assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### empty_statement
  (leaf)

### enum_body
  (children): [] enum_member_declaration

### enum_declaration
  annotations?:    annotation_list
  backed_type?:    fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type
  body?:           enum_body
  name:            identifier

### enum_member_declaration
  default?:    assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  name:        identifier

### expression_statement
  (children):    assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### fun_callable_type
  param_types:     fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type
  return_type:     fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### function_call
  arguments:     argument_list
  callee:        assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### function_declaration
  annotations?:          annotation_list
  asm_body?:             asm_body
  body?:                 block_statement
  builtin_specifier?:    builtin_specifier
  name:                  identifier
  parameters?:           parameter_list
  return_type?:          fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type
  type_parameters?:      type_parameters

### generic_instantiation
  expr:                assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  instantiationTs:     instantiationT_list

### get_method_declaration
  annotations?:          annotation_list
  asm_body?:             asm_body
  body?:              [] asm_body | block_statement | builtin_specifier
  builtin_specifier?:    builtin_specifier
  name:                  identifier
  parameters?:           parameter_list
  return_type?:          fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### global_var_declaration
  annotations?:    annotation_list
  name:            identifier
  type:            fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### identifier
  (leaf)

### if_statement
  alternative?:    block_statement | if_statement
  body?:           block_statement
  condition:       assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### import_directive
  path:     string_literal

### instance_argument
  name:      identifier
  value?:    assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### instantiationT_list
  types:  [] fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type | (",")

### is_type_operator
  expr:         assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  operator:     ("!is" | "is")
  rhs_type:     fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### lambda_expression
  asm_body?:             asm_body
  body?:              [] asm_body | block_statement | builtin_specifier
  builtin_specifier?:    builtin_specifier
  parameters:            parameter_list
  return_type?:          fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### lazy_expression
  argument:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### local_vars_declaration
  assigned_val?:    assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  kind:             ("val" | "var")
  lhs:              tensor_vars_declaration | tuple_vars_declaration | var_declaration

### match_arm
  block?:           block_statement
  expr?:            assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  pattern_else?:    ("else")
  pattern_expr?:    assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  pattern_type?:    fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type
  return?:          return_statement
  throw?:           throw_statement

### match_body
  (children): [] match_arm

### match_expression
  body?:    match_body
  expr:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | local_vars_declaration | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### match_statement
  (children):    match_expression

### method_declaration
  annotations?:          annotation_list
  asm_body?:             asm_body
  body?:                 block_statement
  builtin_specifier?:    builtin_specifier
  name:                  identifier
  parameters?:           parameter_list
  receiver:              method_receiver
  return_type?:          fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type
  type_parameters?:      type_parameters

### method_receiver
  receiver_type:     fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### not_null_operator
  inner:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### null_literal
  (leaf)

### nullable_type
  inner:     fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### number_literal
  (leaf)

### numeric_index
  (leaf)

### object_literal
  arguments:     object_literal_body
  type?:         fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### object_literal_body
  (children): [] instance_argument

### parameter_declaration
  default?:    assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  mutate?:     ("mutate")
  name:        identifier
  type?:       fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### parameter_list
  (children): [] parameter_declaration

### parenthesized_expression
  inner:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### parenthesized_type
  inner:     fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### repeat_statement
  body:      block_statement
  count:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### return_statement
  body?:    assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### set_assignment
  left:              assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  operator_name:     ("%=" | "&=" | "*=" | +7 more)
  right:             assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### source_file
  (children): [] constant_declaration | empty_statement | enum_declaration | function_declaration | get_method_declaration | global_var_declaration | import_directive | method_declaration | struct_declaration | tolk_required_version | type_alias_declaration

### string_literal
  (leaf)

### struct_body
  (children): [] struct_field_declaration

### struct_declaration
  annotations?:        annotation_list
  body?:               struct_body
  name:                identifier
  pack_prefix?:        number_literal
  type_parameters?:    type_parameters

### struct_field_declaration
  default?:      assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  modifiers?:    struct_field_modifiers
  name:          identifier
  type:          fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### struct_field_modifiers
  (leaf)

### tensor_expression
  (children): [] assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### tensor_type
  (children): [] fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### tensor_vars_declaration
  vars:  [] tensor_vars_declaration | tuple_vars_declaration | var_declaration | (",")

### ternary_operator
  alternative:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  condition:       assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  consequence:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### throw_statement
  excNo:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### tolk_required_version
  value:     version_value

### try_catch_statement
  catch:        catch_clause
  try_body:     block_statement

### tuple_type
  (children): [] fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### tuple_vars_declaration
  vars:  [] tensor_vars_declaration | tuple_vars_declaration | var_declaration | (",")

### type_alias_declaration
  annotations?:        annotation_list
  name:                identifier
  type_parameters?:    type_parameters
  underlying_type:     builtin_specifier | fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### type_identifier
  (leaf)

### type_instantiatedTs
  arguments:     instantiationT_list
  name:          type_identifier

### type_parameter
  default?:    fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type
  name:        identifier

### type_parameters
  (children): [] type_parameter

### typed_tuple
  (children): [] assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

### unary_operator
  argument:          assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore
  operator_name:     ("!" | "+" | "-" | +1 more)

### underscore
  (leaf)

### union_type
  lhs:     fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type
  rhs:     fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### var_declaration
  name:      identifier
  redef?:    ("redef")
  type?:     fun_callable_type | null_literal | nullable_type | parenthesized_type | tensor_type | tuple_type | type_identifier | type_instantiatedTs | union_type

### version_value
  (leaf)

### while_statement
  body:          block_statement
  condition:     assignment | binary_operator | boolean_literal | cast_as_operator | dot_access | function_call | generic_instantiation | identifier | is_type_operator | lambda_expression | lazy_expression | match_expression | not_null_operator | null_literal | number_literal | object_literal | parenthesized_expression | set_assignment | string_literal | tensor_expression | ternary_operator | typed_tuple | unary_operator | underscore

