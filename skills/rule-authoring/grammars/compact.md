# compact — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-compact/src/node-types.json` (94 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### and
  (leaf)

### and_expr
  left:      and_expr | bin_mul_expr | bin_sum_expr | cast_expr | comparison_expr | index_access_expr | member_access_expr | not_expr | rel_comparison_expr | term
  right:     bin_mul_expr | bin_sum_expr | cast_expr | comparison_expr | index_access_expr | member_access_expr | not_expr | rel_comparison_expr | term
  (children):    and

### arg
  id:       id
  type:     type

### assert_stmt
  condition:     expr
  message:       str

### assign_stmt
  operator:     ("+=" | "-=" | "=")
  target:       expr
  value:        expr

### bin_mul_expr
  left:         bin_mul_expr | index_access_expr | member_access_expr | not_expr | term
  operator:     ("*")
  right:        index_access_expr | member_access_expr | not_expr | term

### bin_sum_expr
  left:         bin_mul_expr | bin_sum_expr | index_access_expr | member_access_expr | not_expr | term
  operator:     ("+" | "-")
  right:        bin_mul_expr | index_access_expr | member_access_expr | not_expr | term

### block
  stmt?: [] stmt

### block_comment
  (leaf)

### bytes_type
  tsize:     tsize

### cast_expr
  expr:     bin_mul_expr | bin_sum_expr | cast_expr | index_access_expr | member_access_expr | not_expr | term
  type:     type

### cdefn
  body:        block
  export?:     export
  gparams?:    gparams
  id:          function_name
  parg?:    [] parg
  pure?:       pure
  type:        type

### comment
  (leaf)

### comparison_expr
  left:         bin_mul_expr | bin_sum_expr | cast_expr | comparison_expr | index_access_expr | member_access_expr | not_expr | rel_comparison_expr | term
  operator:     equals | not_equals
  right:        bin_mul_expr | bin_sum_expr | cast_expr | index_access_expr | member_access_expr | not_expr | rel_comparison_expr | term

### conditional_expr
  condition:       and_expr | bin_mul_expr | bin_sum_expr | cast_expr | comparison_expr | index_access_expr | member_access_expr | not_expr | or_expr | rel_comparison_expr | term
  else_branch:     expr
  then_branch:     expr

### const_stmt
  pattern:     pattern
  type?:       type
  value:       expr

### contract_name
  (leaf)

### default_term
  type:     type

### disclose_term
  expr:     expr

### ecdecl
  contract_circuit?: [] ecdecl_circuit
  export?:              export
  name:                 contract_name

### ecdecl_circuit
  arg?:  [] arg
  id:       id
  pure?:    pure
  type:     type

### edecl
  arg?:     [] arg
  args?:    [] arg | (",")
  export?:     export
  gparams?:    gparams
  id:          function_name
  type:        type

### enum_name
  (leaf)

### enumdef
  export?:    export
  id:      [] id
  name:       enum_name

### equals
  (leaf)

### export
  (leaf)

### expr
  (children):    and_expr | bin_mul_expr | bin_sum_expr | cast_expr | comparison_expr | conditional_expr | index_access_expr | member_access_expr | not_expr | or_expr | rel_comparison_expr | term

### expr_seq
  expr:  [] expr

### expr_seq_term
  (children):    expr_seq

### expression_sequence_stmt
  (children):    expr_seq

### file
  (leaf)

### fold_term
  expr:        [] expr
  fun:            fun
  init_value:     expr

### for_stmt
  body:            stmt
  counter:         id
  limit?:          expr_seq
  range_end?:      nat
  range_start?:    nat

### fun
  block?:      block
  expr?:       expr
  gargs?:      gargs
  id?:         id
  parg?:    [] parg
  pattern?: [] pattern
  return?:  [] type | (":")
  (children):    fun

### function_call_term
  expr?: [] expr
  fun:      fun

### function_name
  (leaf)

### garg
  (children):    nat | type

### gargs
  garg:  [] garg

### generic_param
  (children):    tvar_name

### gparams
  gparam:  [] generic_param

### greater_than
  (leaf)

### greater_than_or_equal
  (leaf)

### id
  (leaf)

### idecl
  gargs?:     gargs
  id:         import_name
  prefix?:    prefix

### if_stmt
  condition:       expr_seq
  else_branch?:    stmt
  then_branch:     stmt

### import_name
  (children):    file | id

### incld
  file:     file

### index_access_expr
  base:      index_access_expr | member_access_expr | term
  index:     nat

### lconstructor
  body:     block
  parg?: [] parg

### ldecl
  export?:    export
  name:       id
  sealed?:    sealed
  type:       type

### less_than
  (leaf)

### less_than_or_equal
  (leaf)

### lit
  (children):    nat | pad | str

### map_term
  expr:  [] expr
  fun:      fun

### mdefn
  export?:            export
  gparams?:           gparams
  module_element?: [] cdefn | ecdecl | edecl | enumdef | idecl | incld | lconstructor | ldecl | mdefn | pragma | struct | wdecl | xdecl
  name:               module_name

### member_access_expr
  arguments?: [] expr | ("(" | ")" | ",")
  base:          index_access_expr | member_access_expr | term
  expr?:      [] expr
  member:        id

### module_name
  (leaf)

### nat
  (leaf)

### not
  (leaf)

### not_equals
  (leaf)

### not_expr
  expr:     index_access_expr | member_access_expr | not_expr | term
  (children):    not

### opaque_type
  (children):    str

### or
  (leaf)

### or_expr
  left:      and_expr | bin_mul_expr | bin_sum_expr | cast_expr | comparison_expr | index_access_expr | member_access_expr | not_expr | or_expr | rel_comparison_expr | term
  right:     and_expr | bin_mul_expr | bin_sum_expr | cast_expr | comparison_expr | index_access_expr | member_access_expr | not_expr | rel_comparison_expr | term
  (children):    or

### pad
  nat:     nat
  str:     str

### parg
  pattern:     pattern
  type:        type

### pattern
  id?:                    id
  pattern_struct?:     [] pattern_struct_elt | ("," | "{" | "}")
  pattern_struct_elt?: [] pattern_struct_elt
  pattern_tuple?:      [] pattern_tuple_elt | ("," | "[" | "]")
  pattern_tuple_elt?:  [] pattern_tuple_elt

### pattern_struct_elt
  id:          id
  pattern?:    pattern

### pattern_tuple_elt
  (children):    pattern

### pragma
  id:                     id
  version_expression?: [] greater_than | greater_than_or_equal | less_than | less_than_or_equal | nat | not | version
  (children): [] and | nat | or | version

### prefix
  id:     id

### pure
  (leaf)

### rel_comparison_expr
  left:         bin_mul_expr | bin_sum_expr | cast_expr | index_access_expr | member_access_expr | not_expr | rel_comparison_expr | term
  operator:     greater_than | greater_than_or_equal | less_than | less_than_or_equal
  right:        bin_mul_expr | bin_sum_expr | cast_expr | index_access_expr | member_access_expr | not_expr | term

### return_stmt
  value?:    expr_seq

### sealed
  (leaf)

### source_file
  (children): [] cdefn | ecdecl | edecl | enumdef | idecl | incld | lconstructor | ldecl | mdefn | pragma | struct | wdecl | xdecl

### stmt
  (children):    assert_stmt | assign_stmt | block | const_stmt | expression_sequence_stmt | for_stmt | if_stmt | return_stmt

### str
  (leaf)

### struct
  arg?:     [] arg
  export?:     export
  gparams?:    gparams
  name:        struct_name

### struct_arg
  (children):    expr | struct_named_filed_initializer | struct_update_field

### struct_name
  (leaf)

### struct_named_filed_initializer
  expr:     expr
  id:       id

### struct_term
  tref:     tref
  (children): [] struct_arg

### struct_update_field
  expr:     expr

### term
  expr?: [] expr
  (children):    default_term | disclose_term | expr_seq_term | fold_term | function_call_term | id | lit | map_term | struct_term

### tref
  gargs?:    gargs
  id:        id

### tsize
  (children):    id | nat

### tvar_name
  (leaf)

### type
  (children): [] bytes_type | opaque_type | tref | type | uint_type | vector_type

### uint_type
  tsize:  [] tsize

### vector_type
  tsize:     tsize
  type:      type

### version
  (leaf)

### wdecl
  arg?:     [] arg
  args?:    [] arg | (",")
  export?:     export
  gparams?:    gparams
  id:          function_name
  type:        type

### xdecl
  id:  [] id

