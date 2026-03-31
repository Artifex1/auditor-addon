# cpp — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-cpp/src/node-types.json` (230 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### _abstract_declarator
  (leaf)

### _declarator
  (leaf)

### _field_declarator
  (leaf)

### _type_declarator
  (leaf)

### abstract_array_declarator
  declarator?:    _abstract_declarator
  size?:          expression | ("*")
  (children): [] type_qualifier

### abstract_function_declarator
  declarator?:    _abstract_declarator
  parameters:     parameter_list
  (children): [] attribute_declaration | attribute_specifier | gnu_asm_expression | noexcept | ref_qualifier | requires_clause | throw_specifier | trailing_return_type | type_qualifier | virtual_specifier

### abstract_parenthesized_declarator
  (children): [] _abstract_declarator | ms_call_modifier

### abstract_pointer_declarator
  declarator?:    _abstract_declarator
  (children): [] ms_pointer_modifier | type_qualifier

### abstract_reference_declarator
  (children):    _abstract_declarator

### access_specifier
  (leaf)

### alias_declaration
  name:     type_identifier
  type:     type_descriptor
  (children): [] attribute_declaration

### alignas_qualifier
  (children):    expression | type_descriptor

### alignof_expression
  type:     type_descriptor

### annotation
  (children):    expression

### argument_list
  (children): [] compound_statement | expression | initializer_list | preproc_defined

### array_declarator
  declarator:     _declarator | _field_declarator | _type_declarator
  size?:          expression | ("*")
  (children): [] type_qualifier

### assignment_expression
  left:         expression
  operator:     ("%=" | "&=" | "*=" | +11 more)
  right:        expression | initializer_list

### attribute
  name:          identifier
  namespace?:    identifier
  prefix?:       identifier
  (children):    argument_list

### attribute_declaration
  (children): [] annotation | attribute

### attribute_specifier
  (children):    argument_list

### attributed_declarator
  (children): [] _declarator | _field_declarator | _type_declarator | attribute_declaration

### attributed_statement
  (children): [] attribute_declaration | statement

### auto
  (leaf)

### base_class_clause
  (children): [] access_specifier | attribute_declaration | qualified_identifier | splice_type_specifier | template_type | type_identifier

### binary_expression
  left:         expression | preproc_defined
  operator:     ("!=" | "%" | "&" | +22 more)
  right:        expression | preproc_defined

### bitfield_clause
  (children):    expression

### break_statement
  (leaf)

### call_expression
  arguments:     argument_list
  function:   [] expression | primitive_type | splice_type_specifier | ("typename")

### case_statement
  value?:    expression
  (children): [] attributed_statement | break_statement | co_return_statement | co_yield_statement | compound_statement | continue_statement | declaration | do_statement | expansion_statement | expression_statement | for_range_loop | for_statement | goto_statement | if_statement | labeled_statement | return_statement | seh_leave_statement | seh_try_statement | switch_statement | throw_statement | try_statement | type_definition | while_statement

### cast_expression
  type:      type_descriptor
  value:     expression

### catch_clause
  body:           compound_statement
  parameters:     parameter_list

### char_literal
  (children): [] character | escape_sequence

### character
  (leaf)

### class_specifier
  body?:    field_declaration_list
  name?:    qualified_identifier | splice_type_specifier | template_type | type_identifier
  (children): [] alignas_qualifier | attribute_declaration | attribute_specifier | base_class_clause | ms_declspec_modifier | virtual_specifier

### co_await_expression
  argument:     expression
  operator:     ("co_await")

### co_return_statement
  (children):    expression

### co_yield_statement
  (children):    expression

### comma_expression
  left:      expression
  right:     comma_expression | expression

### comment
  (leaf)

### compound_literal_expression
  type:   [] primitive_type | qualified_identifier | splice_type_specifier | template_type | type_descriptor | type_identifier | ("typename")
  value:     initializer_list

### compound_requirement
  (children): [] expression | trailing_return_type

### compound_statement
  (children): [] alias_declaration | concept_definition | consteval_block_declaration | declaration | export_declaration | function_definition | import_declaration | linkage_specification | namespace_alias_definition | namespace_definition | preproc_call | preproc_def | preproc_function_def | preproc_if | preproc_ifdef | preproc_include | statement | static_assert_declaration | template_declaration | template_instantiation | type_definition | type_specifier | using_declaration

### concatenated_string
  (children): [] identifier | raw_string_literal | string_literal

### concept_definition
  name:     identifier
  (children):    expression

### condition_clause
  initializer?:    init_statement
  value:           comma_expression | declaration | expression

### conditional_expression
  alternative:     expression
  condition:       expression
  consequence?:    comma_expression | expression

### consteval_block_declaration
  body:     compound_statement

### constraint_conjunction
  left:      [] constraint_conjunction | constraint_disjunction | expression | splice_type_specifier | template_type | type_identifier | ("(" | ")")
  operator:     ("&&" | "and")
  right:     [] constraint_conjunction | constraint_disjunction | expression | splice_type_specifier | template_type | type_identifier | ("(" | ")")

### constraint_disjunction
  left:      [] constraint_conjunction | constraint_disjunction | expression | splice_type_specifier | template_type | type_identifier | ("(" | ")")
  operator:     ("or" | "||")
  right:     [] constraint_conjunction | constraint_disjunction | expression | splice_type_specifier | template_type | type_identifier | ("(" | ")")

### continue_statement
  (leaf)

### declaration
  declarator:     [] _declarator | gnu_asm_expression | init_declarator | ms_call_modifier | operator_cast
  default_value?:    expression
  type?:             type_specifier
  value?:            expression | initializer_list
  (children): [] attribute_declaration | attribute_specifier | explicit_function_specifier | ms_declspec_modifier | storage_class_specifier | type_qualifier

### declaration_list
  (children): [] alias_declaration | concept_definition | consteval_block_declaration | declaration | export_declaration | function_definition | import_declaration | linkage_specification | namespace_alias_definition | namespace_definition | preproc_call | preproc_def | preproc_function_def | preproc_if | preproc_ifdef | preproc_include | statement | static_assert_declaration | template_declaration | template_instantiation | type_definition | type_specifier | using_declaration

### decltype
  (children):    auto | expression

### default_method_clause
  (leaf)

### delete_expression
  (children):    expression

### delete_method_clause
  (leaf)

### dependent_name
  (children):    template_function | template_method | template_type

### dependent_type
  (children):    type_specifier

### destructor_name
  (children):    identifier

### do_statement
  body:          statement
  condition:     parenthesized_expression

### else_clause
  (children):    statement

### enum_specifier
  base?:    primitive_type | qualified_identifier | sized_type_specifier | type_identifier
  body?:    enumerator_list
  name?:    qualified_identifier | splice_type_specifier | template_type | type_identifier
  (children):    attribute_specifier

### enumerator
  name:      identifier
  value?:    expression

### enumerator_list
  (children): [] enumerator | preproc_call | preproc_if | preproc_ifdef

### escape_sequence
  (leaf)

### expansion_statement
  body:            statement
  declarator:      _declarator
  initializer?:    init_statement
  right:           expression | initializer_list
  type:            type_specifier
  (children): [] attribute_declaration | attribute_specifier | ms_declspec_modifier | storage_class_specifier | type_qualifier

### explicit_function_specifier
  (children):    expression

### explicit_object_parameter_declaration
  (children): [] parameter_declaration | this

### export_declaration
  (children):    alias_declaration | concept_definition | consteval_block_declaration | declaration | declaration_list | export_declaration | function_definition | import_declaration | linkage_specification | namespace_alias_definition | namespace_definition | preproc_call | preproc_def | preproc_function_def | preproc_if | preproc_ifdef | preproc_include | statement | static_assert_declaration | template_declaration | template_instantiation | type_definition | type_specifier | using_declaration

### expression
  (leaf)

### expression_statement
  (children):    comma_expression | expression

### extension_expression
  (children):    expression

### false
  (leaf)

### field_declaration
  declarator?:    [] _field_declarator
  default_value?: [] expression | initializer_list
  type:              type_specifier
  (children): [] attribute_declaration | attribute_specifier | bitfield_clause | ms_declspec_modifier | storage_class_specifier | type_qualifier

### field_declaration_list
  (children): [] access_specifier | alias_declaration | consteval_block_declaration | declaration | field_declaration | friend_declaration | function_definition | preproc_call | preproc_def | preproc_function_def | preproc_if | preproc_ifdef | static_assert_declaration | template_declaration | type_definition | using_declaration

### field_designator
  (children):    field_identifier

### field_expression
  argument:     expression
  field:        dependent_name | destructor_name | field_identifier | operator_name | qualified_identifier | splice_expression | template_method
  operator:     ("->" | "." | ".*")

### field_identifier
  (leaf)

### field_initializer
  (children): [] argument_list | field_identifier | initializer_list | qualified_identifier | template_method

### field_initializer_list
  (children): [] field_initializer

### fold_expression
  left:         expression | ("...")
  operator:     ("!=" | "%" | "%=" | +35 more)
  right:        expression | ("...")

### for_range_loop
  body:            statement
  declarator:      _declarator
  initializer?:    init_statement
  right:           expression | initializer_list
  type:            type_specifier
  (children): [] attribute_declaration | attribute_specifier | ms_declspec_modifier | storage_class_specifier | type_qualifier

### for_statement
  body:            statement
  condition?:      comma_expression | expression
  initializer?:    comma_expression | declaration | expression
  update?:         comma_expression | expression

### friend_declaration
  (children):    declaration | function_definition | qualified_identifier | splice_type_specifier | template_type | type_identifier

### function_declarator
  declarator:     _declarator | _field_declarator | _type_declarator
  parameters:     parameter_list
  (children): [] attribute_declaration | attribute_specifier | gnu_asm_expression | noexcept | ref_qualifier | requires_clause | throw_specifier | trailing_return_type | type_qualifier | virtual_specifier

### function_definition
  body?:          compound_statement | try_statement
  declarator:     _declarator | _field_declarator | operator_cast
  type?:          type_specifier
  (children): [] attribute_declaration | attribute_specifier | default_method_clause | delete_method_clause | explicit_function_specifier | field_initializer_list | ms_call_modifier | ms_declspec_modifier | pure_virtual_clause | storage_class_specifier | try_statement | type_qualifier

### generic_expression
  (children): [] expression | type_descriptor

### global_module_fragment_declaration
  (leaf)

### gnu_asm_clobber_list
  register?: [] concatenated_string | raw_string_literal | string_literal

### gnu_asm_expression
  assembly_code:       concatenated_string | raw_string_literal | string_literal
  clobbers?:           gnu_asm_clobber_list
  goto_labels?:        gnu_asm_goto_list
  input_operands?:     gnu_asm_input_operand_list
  output_operands?:    gnu_asm_output_operand_list
  (children): [] gnu_asm_qualifier

### gnu_asm_goto_list
  label?: [] identifier

### gnu_asm_input_operand
  constraint:     string_literal
  symbol?:        identifier
  value:          expression

### gnu_asm_input_operand_list
  operand?: [] gnu_asm_input_operand

### gnu_asm_output_operand
  constraint:     string_literal
  symbol?:        identifier
  value:          expression

### gnu_asm_output_operand_list
  operand?: [] gnu_asm_output_operand

### gnu_asm_qualifier
  (leaf)

### goto_statement
  label:     statement_identifier

### identifier
  (leaf)

### if_statement
  alternative?:    else_clause
  condition:       condition_clause
  consequence:     statement

### import_declaration
  header?:       string_literal | system_lib_string
  name?:         module_name
  partition?:    module_partition
  (children):    attribute_declaration

### init_declarator
  declarator:     _declarator
  value:          argument_list | expression | initializer_list

### init_statement
  (children):    alias_declaration | declaration | expression_statement | type_definition

### initializer_list
  (children): [] expression | initializer_list | initializer_pair

### initializer_pair
  designator:  [] field_designator | field_identifier | subscript_designator | subscript_range_designator
  value:          expression | initializer_list

### labeled_statement
  label:     statement_identifier
  (children):    declaration | statement

### lambda_capture_initializer
  left:      identifier
  right:     expression

### lambda_capture_specifier
  (children): [] identifier | lambda_capture_initializer | lambda_default_capture | parameter_pack_expansion | qualified_identifier | this

### lambda_declarator
  parameters?:    parameter_list
  (children): [] attribute_declaration | lambda_specifier | noexcept | requires_clause | throw_specifier | trailing_return_type

### lambda_default_capture
  (leaf)

### lambda_expression
  body:                    compound_statement
  captures:                lambda_capture_specifier
  constraint?:             requires_clause
  declarator?:             lambda_declarator
  template_parameters?:    template_parameter_list

### lambda_specifier
  (leaf)

### linkage_specification
  body:      declaration | declaration_list | function_definition
  value:     string_literal

### literal_suffix
  (leaf)

### module_declaration
  name:          module_name
  partition?:    module_partition
  (children):    attribute_declaration

### module_name
  (children): [] identifier

### module_partition
  (children):    module_name

### ms_based_modifier
  (children):    argument_list

### ms_call_modifier
  (leaf)

### ms_declspec_modifier
  (children):    identifier

### ms_pointer_modifier
  (children):    ms_restrict_modifier | ms_signed_ptr_modifier | ms_unaligned_ptr_modifier | ms_unsigned_ptr_modifier

### ms_restrict_modifier
  (leaf)

### ms_signed_ptr_modifier
  (leaf)

### ms_unaligned_ptr_modifier
  (leaf)

### ms_unsigned_ptr_modifier
  (leaf)

### namespace_alias_definition
  name:     namespace_identifier
  (children):    namespace_identifier | nested_namespace_specifier | splice_specifier

### namespace_definition
  body:     declaration_list
  name?:    namespace_identifier | nested_namespace_specifier
  (children):    attribute_declaration

### namespace_identifier
  (leaf)

### nested_namespace_specifier
  (children): [] namespace_identifier | nested_namespace_specifier

### new_declarator
  length:     expression
  (children):    new_declarator

### new_expression
  arguments?:     argument_list | initializer_list
  declarator?:    new_declarator
  placement?:     argument_list
  type:           type_specifier

### noexcept
  (children):    expression

### null
  (leaf)

### number_literal
  (leaf)

### offsetof_expression
  member:     field_identifier
  type:       type_descriptor

### operator_cast
  declarator:     _abstract_declarator
  type:           type_specifier
  (children): [] attribute_declaration | attribute_specifier | ms_declspec_modifier | storage_class_specifier | type_qualifier

### operator_name
  (children):    identifier

### optional_parameter_declaration
  declarator?:       _declarator | abstract_reference_declarator
  default_value:     expression
  type:              type_specifier
  (children): [] attribute_declaration | attribute_specifier | ms_declspec_modifier | storage_class_specifier | type_qualifier

### optional_type_parameter_declaration
  default_type:     type_specifier
  name?:            type_identifier

### parameter_declaration
  declarator?:    _abstract_declarator | _declarator
  type:           type_specifier
  (children): [] attribute_declaration | attribute_specifier | ms_declspec_modifier | storage_class_specifier | type_qualifier

### parameter_list
  (children): [] explicit_object_parameter_declaration | optional_parameter_declaration | parameter_declaration | variadic_parameter_declaration

### parameter_pack_expansion
  pattern:     expression | type_descriptor

### parenthesized_declarator
  (children): [] _declarator | _field_declarator | _type_declarator | ms_call_modifier

### parenthesized_expression
  (children):    comma_expression | compound_statement | expression | preproc_defined

### placeholder_type_specifier
  constraint?:    qualified_identifier | template_type | type_identifier
  (children):    auto | decltype

### pointer_declarator
  declarator:     _declarator | _field_declarator | _type_declarator
  (children): [] ms_based_modifier | ms_pointer_modifier | type_qualifier

### pointer_expression
  argument:     expression
  operator:     ("&" | "*")

### pointer_type_declarator
  declarator:     _type_declarator
  (children): [] ms_based_modifier | ms_pointer_modifier | type_qualifier

### preproc_arg
  (leaf)

### preproc_call
  argument?:     preproc_arg
  directive:     preproc_directive

### preproc_def
  name:      identifier
  value?:    preproc_arg

### preproc_defined
  (children):    identifier

### preproc_directive
  (leaf)

### preproc_elif
  alternative?:    preproc_elif | preproc_elifdef | preproc_else
  condition:       binary_expression | call_expression | char_literal | identifier | number_literal | parenthesized_expression | preproc_defined | unary_expression
  (children): [] access_specifier | alias_declaration | concept_definition | consteval_block_declaration | declaration | enumerator | export_declaration | field_declaration | friend_declaration | function_definition | global_module_fragment_declaration | import_declaration | linkage_specification | module_declaration | namespace_alias_definition | namespace_definition | preproc_call | preproc_def | preproc_function_def | preproc_if | preproc_ifdef | preproc_include | private_module_fragment_declaration | statement | static_assert_declaration | template_declaration | template_instantiation | type_definition | type_specifier | using_declaration

### preproc_elifdef
  alternative?:    preproc_elif | preproc_elifdef | preproc_else
  name:            identifier
  (children): [] access_specifier | alias_declaration | concept_definition | consteval_block_declaration | declaration | enumerator | export_declaration | field_declaration | friend_declaration | function_definition | global_module_fragment_declaration | import_declaration | linkage_specification | module_declaration | namespace_alias_definition | namespace_definition | preproc_call | preproc_def | preproc_function_def | preproc_if | preproc_ifdef | preproc_include | private_module_fragment_declaration | statement | static_assert_declaration | template_declaration | template_instantiation | type_definition | type_specifier | using_declaration

### preproc_else
  (children): [] access_specifier | alias_declaration | concept_definition | consteval_block_declaration | declaration | enumerator | export_declaration | field_declaration | friend_declaration | function_definition | global_module_fragment_declaration | import_declaration | linkage_specification | module_declaration | namespace_alias_definition | namespace_definition | preproc_call | preproc_def | preproc_function_def | preproc_if | preproc_ifdef | preproc_include | private_module_fragment_declaration | statement | static_assert_declaration | template_declaration | template_instantiation | type_definition | type_specifier | using_declaration

### preproc_function_def
  name:           identifier
  parameters:     preproc_params
  value?:         preproc_arg

### preproc_if
  alternative?:    preproc_elif | preproc_elifdef | preproc_else
  condition:       binary_expression | call_expression | char_literal | identifier | number_literal | parenthesized_expression | preproc_defined | unary_expression
  (children): [] access_specifier | alias_declaration | concept_definition | consteval_block_declaration | declaration | enumerator | export_declaration | field_declaration | friend_declaration | function_definition | global_module_fragment_declaration | import_declaration | linkage_specification | module_declaration | namespace_alias_definition | namespace_definition | preproc_call | preproc_def | preproc_function_def | preproc_if | preproc_ifdef | preproc_include | private_module_fragment_declaration | statement | static_assert_declaration | template_declaration | template_instantiation | type_definition | type_specifier | using_declaration

### preproc_ifdef
  alternative?:    preproc_elif | preproc_elifdef | preproc_else
  name:            identifier
  (children): [] access_specifier | alias_declaration | concept_definition | consteval_block_declaration | declaration | enumerator | export_declaration | field_declaration | friend_declaration | function_definition | global_module_fragment_declaration | import_declaration | linkage_specification | module_declaration | namespace_alias_definition | namespace_definition | preproc_call | preproc_def | preproc_function_def | preproc_if | preproc_ifdef | preproc_include | private_module_fragment_declaration | statement | static_assert_declaration | template_declaration | template_instantiation | type_definition | type_specifier | using_declaration

### preproc_include
  path:     call_expression | identifier | string_literal | system_lib_string

### preproc_params
  (children): [] identifier

### primitive_type
  (leaf)

### private_module_fragment_declaration
  (leaf)

### pure_virtual_clause
  (leaf)

### qualified_identifier
  name:   [] dependent_name | destructor_name | field_identifier | identifier | operator_cast | operator_name | pointer_type_declarator | qualified_identifier | template_function | template_method | template_type | type_identifier | ("template")
  scope?:    decltype | dependent_name | namespace_identifier | splice_expression | splice_type_specifier | template_type

### raw_string_content
  (leaf)

### raw_string_delimiter
  (leaf)

### raw_string_literal
  delimiter?:    raw_string_delimiter
  (children): [] raw_string_content | raw_string_delimiter

### ref_qualifier
  (leaf)

### reference_declarator
  (children):    _declarator | _field_declarator | _type_declarator | variadic_declarator

### reflect_expression
  (children):    expression | type_descriptor

### requirement_seq
  (children): [] compound_requirement | simple_requirement | type_requirement

### requires_clause
  constraint:  [] constraint_conjunction | constraint_disjunction | expression | splice_type_specifier | template_type | type_identifier | ("(" | ")")

### requires_expression
  parameters?:      parameter_list
  requirements:     requirement_seq

### return_statement
  (children):    comma_expression | expression | initializer_list

### seh_except_clause
  body:       compound_statement
  filter:     parenthesized_expression

### seh_finally_clause
  body:     compound_statement

### seh_leave_statement
  (leaf)

### seh_try_statement
  body:     compound_statement
  (children):    seh_except_clause | seh_finally_clause

### simple_requirement
  (children):    comma_expression | expression

### sized_type_specifier
  type?:    primitive_type | type_identifier
  (children): [] type_qualifier

### sizeof_expression
  type?:     type_descriptor
  value?:    expression

### splice_expression
  (children): [] splice_specifier | template_argument_list

### splice_specifier
  (children):    expression

### splice_type_specifier
  (children): [] splice_specifier | template_argument_list

### statement
  (leaf)

### statement_identifier
  (leaf)

### static_assert_declaration
  condition:     expression
  message?:      concatenated_string | raw_string_literal | string_literal

### storage_class_specifier
  (leaf)

### string_content
  (leaf)

### string_literal
  (children): [] escape_sequence | string_content

### struct_specifier
  body?:    field_declaration_list
  name?:    qualified_identifier | splice_type_specifier | template_type | type_identifier
  (children): [] alignas_qualifier | attribute_declaration | attribute_specifier | base_class_clause | ms_declspec_modifier | virtual_specifier

### structured_binding_declarator
  (children): [] identifier

### subscript_argument_list
  (children): [] expression | initializer_list

### subscript_designator
  (children):    expression

### subscript_expression
  argument:     expression
  indices:      subscript_argument_list

### subscript_range_designator
  end:       expression
  start:     expression

### switch_statement
  body:          compound_statement
  condition:     condition_clause

### system_lib_string
  (leaf)

### template_argument_list
  (children): [] expression | type_descriptor

### template_declaration
  parameters:     template_parameter_list
  (children): [] alias_declaration | concept_definition | declaration | friend_declaration | function_definition | requires_clause | template_declaration | type_specifier

### template_function
  arguments:     template_argument_list
  name:          identifier

### template_instantiation
  declarator:     _declarator
  type?:          type_specifier
  (children): [] attribute_declaration | attribute_specifier | ms_declspec_modifier | storage_class_specifier | type_qualifier

### template_method
  arguments:     template_argument_list
  name:          field_identifier | operator_name

### template_parameter_list
  (children): [] optional_parameter_declaration | optional_type_parameter_declaration | parameter_declaration | template_template_parameter_declaration | type_parameter_declaration | variadic_parameter_declaration | variadic_type_parameter_declaration

### template_template_parameter_declaration
  parameters:     template_parameter_list
  (children):    optional_type_parameter_declaration | type_parameter_declaration | variadic_type_parameter_declaration

### template_type
  arguments:     template_argument_list
  name:          type_identifier

### this
  (leaf)

### throw_specifier
  (children): [] type_descriptor

### throw_statement
  (children):    expression

### trailing_return_type
  (children):    type_descriptor

### translation_unit
  (children): [] alias_declaration | attributed_statement | break_statement | case_statement | co_return_statement | co_yield_statement | compound_statement | concept_definition | consteval_block_declaration | continue_statement | declaration | do_statement | expansion_statement | export_declaration | expression_statement | for_range_loop | for_statement | function_definition | global_module_fragment_declaration | goto_statement | if_statement | import_declaration | labeled_statement | linkage_specification | module_declaration | namespace_alias_definition | namespace_definition | preproc_call | preproc_def | preproc_function_def | preproc_if | preproc_ifdef | preproc_include | private_module_fragment_declaration | return_statement | static_assert_declaration | switch_statement | template_declaration | template_instantiation | throw_statement | try_statement | type_definition | type_specifier | using_declaration | while_statement

### true
  (leaf)

### try_statement
  body:     compound_statement
  (children): [] catch_clause | field_initializer_list

### type_definition
  declarator:  [] _type_declarator
  type:           type_specifier
  (children): [] attribute_specifier | type_qualifier

### type_descriptor
  declarator?:    _abstract_declarator
  type:           type_specifier
  (children): [] type_qualifier

### type_identifier
  (leaf)

### type_parameter_declaration
  (children):    type_identifier

### type_qualifier
  (children):    alignas_qualifier

### type_requirement
  (children):    qualified_identifier | splice_type_specifier | template_type | type_identifier

### type_specifier
  (leaf)

### unary_expression
  argument:     expression | preproc_defined
  operator:     ("!" | "+" | "-" | +3 more)

### union_specifier
  body?:    field_declaration_list
  name?:    qualified_identifier | splice_type_specifier | template_type | type_identifier
  (children): [] alignas_qualifier | attribute_declaration | attribute_specifier | base_class_clause | ms_declspec_modifier | virtual_specifier

### update_expression
  argument:     expression
  operator:     ("++" | "--")

### user_defined_literal
  (children): [] char_literal | concatenated_string | literal_suffix | number_literal | raw_string_literal | string_literal

### using_declaration
  (children): [] attribute_declaration | identifier | qualified_identifier | splice_type_specifier

### variadic_declarator
  (children):    identifier

### variadic_parameter_declaration
  declarator:     reference_declarator | variadic_declarator
  type:           type_specifier
  (children): [] attribute_declaration | attribute_specifier | ms_declspec_modifier | storage_class_specifier | type_qualifier

### variadic_type_parameter_declaration
  (children):    type_identifier

### virtual_specifier
  (leaf)

### while_statement
  body:          statement
  condition:     condition_clause

