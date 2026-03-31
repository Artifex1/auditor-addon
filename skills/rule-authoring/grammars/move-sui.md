# move-sui — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-move-sui/src/node-types.json` (123 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### abilities
  (children): [] ability

### ability
  (leaf)

### abort_expr
  condition:  [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")

### aborts_if
  condition:  [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  with?:      [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  (children):    condition_props

### aborts_with_or_modifies
  kind:     ("aborts_with" | "modifies")
  (children): [] access_field | assignment | bin_op_expr | condition_props | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr

### access_field
  field:      anon_field_index | identifier
  object:     access_field | mem_access | receiver_call | ("expr_term")

### access_specifier
  arg?:                identifier
  func?:               name_access_chain
  literal_address?:    numerical_addr
  (children): [] name_access_chain_wildcard | type_args

### access_specifier_list
  (children): [] access_specifier

### address_block
  (children): [] attributes | identifier | module | numerical_addr

### alias
  (leaf)

### anon_field_index
  (leaf)

### anon_fields
  (children): [] type

### asserts
  condition:  [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  kind:          ("assert" | "assume" | "ensures" | +1 more)
  (children):    condition_props

### assignment
  target:     access_field | copy_expr | deref_expr | mem_access | move_expr | not_expr | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  value:   [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")

### attribute
  attr_path:  [] identifier
  attribute:  [] identifier | ("::")
  value?:        name_access_chain | value
  (children): [] attribute

### attributes
  (children): [] attribute

### bin_op_expr
  lhs:     access_field | bin_op_expr | copy_expr | deref_expr | mem_access | move_expr | not_expr | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  rhs:     access_field | bin_op_expr | copy_expr | deref_expr | mem_access | move_expr | not_expr | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  (children):    binary_operator

### binary_operator
  (leaf)

### bind_field
  bind?:     [] fields | name_access_chain | tuple | type_args | var_name
  field:        shorthand_field_identifier | var_name
  struct?:      name_access_chain
  variable?:    var_name

### bind_list
  struct?:   [] name_access_chain
  variable?: [] var_name
  (children): [] fields | tuple | type_args

### block
  (children): [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | let_expr | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | use_decl

### block_comment
  (children):    doc_comment

### body
  (children): [] field_annot

### bool_literal
  (leaf)

### break_expr
  (leaf)

### byte_string
  (leaf)

### call_args
  (children): [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr

### call_expr
  arguments:          call_args
  func_name:          name_access_chain
  type_arguments?:    type_args

### cast_expr
  (children): [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | type

### closure_type
  param_types?: [] type | (",")
  return_type?:    type

### condition
  (children): [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr

### condition_props
  prop_name?: [] var_name
  property?:  [] name_access_chain | value | var_name | ("," | "=")
  value?:     [] name_access_chain | value

### constant_decl
  name:      identifier
  type:      type
  value:  [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")

### constraints
  (children): [] ability

### continue_expr
  (leaf)

### copy_expr
  variable:     identifier

### declaration
  (children): [] attributes | constant_decl | enum_decl | friend_decl | function_decl | module_member_modifier | spec_block | spec_func | spec_invariant | struct_decl | use_decl

### deref_expr
  (children):    access_field | copy_expr | deref_expr | mem_access | move_expr | not_expr | receiver_call | ref_expr | ref_mut_expr

### discouraged_name
  (children):    primitive_type

### doc_comment
  (leaf)

### emits
  condition?: [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  emission:   [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  target:     [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  (children):    condition_props

### enum_body
  (children): [] enum_variant | enum_variant_posit | enum_variant_struct

### enum_decl
  name:     identifier
  (children): [] abilities | enum_body | type_params

### enum_variant
  (children):    identifier

### enum_variant_posit
  variant:     identifier
  (children):    anon_fields

### enum_variant_struct
  variant:     identifier
  (children):    struct_body

### expr_field
  field:     identifier | shorthand_field_identifier
  value?: [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")

### field_annot
  field:     identifier
  (children):    type

### fields
  (children): [] bind_field

### for_loop_expr
  begin:     access_field | copy_expr | deref_expr | mem_access | move_expr | not_expr | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  body:      block
  end:       access_field | copy_expr | deref_expr | mem_access | move_expr | not_expr | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  var:       var_name
  (children):    spec_loop_invariant

### friend_decl
  name:     name_access_chain

### function_decl
  body?:               block
  name:                identifier
  negated?:         [] ("!")
  parameters:          parameters
  pure?:               pure
  return_type?:        type
  specifier?:       [] access_specifier_list | pure | ("!" | "acquires" | "reads" | +1 more)
  type_parameters?:    type_params

### identifier
  (leaf)

### if_expr
  condition:     parenthesized_expr
  else?:      [] access_field | assignment | bin_op_expr | block | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  then:       [] access_field | assignment | bin_op_expr | block | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")

### lambda
  struct?:   [] name_access_chain
  variable?: [] var_name
  (children): [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | fields | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | tuple | type_args

### let_expr
  bind:      bind_list
  type?:     type
  value?: [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")

### line_comment
  (children):    doc_comment

### loop_expr
  body:  [] access_field | assignment | bin_op_expr | block | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")

### macro_call_expr
  arguments:      call_args
  macro_name:     name_access_chain

### match_arm
  (children): [] condition | pattern | result

### match_expr
  value:  [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  (children): [] match_arm

### mem_access
  index:  [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  (children):    access_field | mem_access | receiver_call

### member
  (children): [] alias | identifier

### module
  name:     identifier
  path?:    identifier | numerical_addr
  (children): [] declaration

### module_ident
  module_name:     identifier
  (children):    identifier | numerical_addr

### module_member_modifier
  (children):    visibility

### move_expr
  variable:     identifier

### name_access_chain
  access_four?:     identifier
  access_three?:    identifier
  access_two?:      identifier
  name?:            discouraged_name | identifier
  (children):    discouraged_name | identifier | numerical_addr

### name_access_chain_wildcard
  access_four?:     identifier | ("*")
  access_three?:    identifier | ("*")
  access_two?:      identifier | ("*")
  name?:            discouraged_name | identifier | ("*")
  (children):    discouraged_name | identifier | numerical_addr

### not_expr
  (children):    access_field | copy_expr | deref_expr | mem_access | move_expr | not_expr | receiver_call | ref_expr | ref_mut_expr

### number
  (leaf)

### number_type
  (leaf)

### numerical_addr
  (children):    number

### pack_expr
  struct_name:        name_access_chain
  type_arguments?:    type_args
  (children): [] expr_field

### parameter
  variable:     identifier
  (children):    type

### parameters
  (children): [] parameter

### parenthesized_expr
  (children): [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr

### pattern
  struct?:   [] name_access_chain
  variable?: [] var_name
  (children): [] fields | tuple | type_args

### phantom
  (leaf)

### primitive_type
  (children):    number_type

### pure
  (leaf)

### quantifier
  assertion?: [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  condition?: [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  scope?:        ("exists" | "forall")
  triggers?:     triggers
  where?:     [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  (children): [] quantifier_bind

### quantifier_bind
  scope?:      [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  type_bind?:  [] type | (":")
  value_bind?:    ("in")
  var:            identifier

### receiver_call
  arguments:         call_args
  func:              anon_field_index | identifier
  receiver:          access_field | mem_access | receiver_call | ("expr_term")
  type_generics?: [] type_args | ("::")

### ref_expr
  (children):    access_field | copy_expr | deref_expr | mem_access | move_expr | not_expr | receiver_call | ref_expr | ref_mut_expr

### ref_mut_expr
  (children):    access_field | copy_expr | deref_expr | mem_access | move_expr | not_expr | receiver_call | ref_expr | ref_mut_expr

### result
  (children): [] access_field | assignment | bin_op_expr | block | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr

### return_expr
  value?: [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")

### script
  (children): [] declaration

### shorthand_field_identifier
  (children):    discouraged_name | identifier

### source_file
  (children): [] address_block | attributes | module | script

### spec_apply
  exclusions?:   [] identifier | type_params | ("*" | "," | "internal" | +1 more)
  expression:    [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  name_pattern?: [] identifier | ("*")
  targets?:      [] identifier | type_params | ("*" | "," | "internal" | +1 more)
  type_params?:  [] type_params
  visibility?:   [] ("internal" | "public")

### spec_axiom
  expression:  [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  kind?:          type_params
  (children):    condition_props

### spec_block
  body?:   [] use_decl | ("{" | "}")
  member?: [] spec_apply | spec_axiom | spec_condition | spec_func | spec_include | spec_invariant | spec_let | spec_pragma | spec_update | spec_variable
  (children):    spec_block_target | spec_func

### spec_block_target
  func_name?:      identifier
  parameters?:     parameters
  return_type?:    type
  schema?:      [] type_params | ("schema")
  schema_name?:    identifier
  signature?:   [] parameters | type | type_params | (":")

### spec_condition
  (children):    aborts_if | aborts_with_or_modifies | asserts | emits

### spec_func
  body?:              block
  parameters:         parameters
  return_type:        type
  signature:       [] identifier | parameters | type | type_params | (":")
  spec_func_name:     identifier

### spec_include
  (children): [] access_field | assignment | bin_op_expr | condition_props | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr

### spec_invariant
  type_params?:    type_params
  update?:         ("update")
  (children): [] access_field | assignment | bin_op_expr | condition_props | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr

### spec_let
  post_state?:    ("post")
  value:       [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  variable:       var_name

### spec_loop_invariant
  body?:   [] use_decl | ("{" | "}")
  member?: [] spec_apply | spec_axiom | spec_condition | spec_func | spec_include | spec_invariant | spec_let | spec_pragma | spec_update | spec_variable
  (children):    spec_block_target | spec_func | spec_loop_invariant

### spec_pragma
  prop_name?:  [] var_name
  properties?: [] name_access_chain | value | var_name | ("," | "=")
  value?:      [] name_access_chain | value

### spec_update
  (children):    assignment

### spec_variable
  scope?:       ("global" | "local")
  value?:    [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  variable:     identifier
  (children): [] type | type_params

### struct_body
  (children): [] field_annot

### struct_decl
  name:     identifier
  (children): [] abilities | anon_fields | body | struct_body | type_params

### triggers
  trigger?: [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")

### tuple
  struct?:   [] name_access_chain
  variable?: [] var_name
  (children): [] fields | tuple | type_args

### tuple_expr
  (children): [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr

### tuple_type
  (children): [] type

### type
  ref?:     [] closure_type | name_access_chain | primitive_type | tuple_type | type_args
  ref_mut?: [] closure_type | name_access_chain | primitive_type | tuple_type | type_args
  (children): [] closure_type | name_access_chain | primitive_type | tuple_type | type_args

### type_args
  (children): [] type

### type_hint_expr
  (children): [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | type

### type_param
  type?:    identifier
  (children): [] constraints | phantom | type_param

### type_params
  (children): [] type_param

### typed_number
  (children): [] number | number_type

### use_decl
  member?: [] member | (",")
  path:       module_ident
  (children):    alias

### value
  (children):    bool_literal | byte_string | identifier | number | numerical_addr | typed_number

### var
  type_arguments?:    type_args
  (children):    name_access_chain

### var_name
  (children):    discouraged_name | identifier

### vector_value_expr
  (children): [] access_field | assignment | bin_op_expr | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | type_args

### visibility
  (leaf)

### while_expr
  body:       [] access_field | assignment | bin_op_expr | block | copy_expr | deref_expr | lambda | mem_access | move_expr | not_expr | quantifier | receiver_call | ref_expr | ref_mut_expr | ("expr_term")
  condition:     parenthesized_expr
  (children):    spec_loop_invariant

