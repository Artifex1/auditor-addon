# tsx — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-typescript/tsx/src/node-types.json` (191 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### abstract_class_declaration
  body:                class_body
  decorator?:       [] decorator
  name:                type_identifier
  type_parameters?:    type_parameters
  (children):    class_heritage

### abstract_method_signature
  name:                computed_property_name | number | private_property_identifier | property_identifier | string
  parameters:          formal_parameters
  return_type?:        asserts_annotation | type_annotation | type_predicate_annotation
  type_parameters?:    type_parameters
  (children): [] accessibility_modifier | override_modifier

### accessibility_modifier
  (leaf)

### adding_type_annotation
  (children):    type

### ambient_declaration
  (children): [] declaration | property_identifier | statement_block | type

### arguments
  (children): [] expression | spread_element

### array
  (children): [] expression | spread_element

### array_pattern
  (children): [] assignment_pattern | pattern

### array_type
  (children):    primary_type

### arrow_function
  body:                expression | statement_block
  parameter?:          identifier
  parameters?:         formal_parameters
  return_type?:        asserts_annotation | type_annotation | type_predicate_annotation
  type_parameters?:    type_parameters

### as_expression
  (children): [] expression | type

### asserts
  (children):    identifier | this | type_predicate

### asserts_annotation
  (children):    asserts

### assignment_expression
  left:      array_pattern | identifier | member_expression | non_null_expression | object_pattern | parenthesized_expression | subscript_expression | undefined
  right:     expression

### assignment_pattern
  left:      pattern
  right:     expression

### augmented_assignment_expression
  left:         identifier | member_expression | non_null_expression | parenthesized_expression | subscript_expression
  operator:     ("%=" | "&&=" | "&=" | +12 more)
  right:        expression

### await_expression
  (children):    expression

### binary_expression
  left:         expression | private_property_identifier
  operator:     ("!=" | "!==" | "%" | +22 more)
  right:        expression

### break_statement
  label?:    statement_identifier

### call_expression
  arguments:          arguments | template_string
  function:           expression | import
  type_arguments?:    type_arguments

### call_signature
  parameters:          formal_parameters
  return_type?:        asserts_annotation | type_annotation | type_predicate_annotation
  type_parameters?:    type_parameters

### catch_clause
  body:          statement_block
  parameter?:    array_pattern | identifier | object_pattern
  type?:         type_annotation

### class
  body:                class_body
  decorator?:       [] decorator
  name?:               type_identifier
  type_parameters?:    type_parameters
  (children):    class_heritage

### class_body
  decorator?: [] decorator
  (children): [] abstract_method_signature | class_static_block | index_signature | method_definition | method_signature | public_field_definition

### class_declaration
  body:                class_body
  decorator?:       [] decorator
  name:                type_identifier
  type_parameters?:    type_parameters
  (children):    class_heritage

### class_heritage
  (children): [] extends_clause | implements_clause

### class_static_block
  body:     statement_block

### comment
  (leaf)

### computed_property_name
  (children):    expression

### conditional_type
  alternative:     type
  consequence:     type
  left:            type
  right:           type

### constraint
  (children):    type

### construct_signature
  parameters:          formal_parameters
  type?:               type_annotation
  type_parameters?:    type_parameters

### constructor_type
  parameters:          formal_parameters
  type:                type
  type_parameters?:    type_parameters

### continue_statement
  label?:    statement_identifier

### debugger_statement
  (leaf)

### declaration
  (leaf)

### decorator
  (children):    call_expression | identifier | member_expression | parenthesized_expression

### default_type
  (children):    type

### do_statement
  body:          statement
  condition:     parenthesized_expression

### else_clause
  (children):    statement

### empty_statement
  (leaf)

### enum_assignment
  name:      computed_property_name | number | private_property_identifier | property_identifier | string
  value:     expression

### enum_body
  name?: [] computed_property_name | number | private_property_identifier | property_identifier | string
  (children): [] enum_assignment

### enum_declaration
  body:     enum_body
  name:     identifier

### escape_sequence
  (leaf)

### existential_type
  (leaf)

### export_clause
  (children): [] export_specifier

### export_specifier
  alias?:    identifier | string
  name:      identifier | string

### export_statement
  declaration?:    declaration
  decorator?:   [] decorator
  source?:         string
  value?:          expression
  (children):    export_clause | expression | identifier | namespace_export

### expression
  (leaf)

### expression_statement
  (children):    expression | sequence_expression

### extends_clause
  type_arguments?: [] type_arguments
  value:           [] expression

### extends_type_clause
  type:  [] generic_type | nested_type_identifier | type_identifier

### false
  (leaf)

### finally_clause
  body:     statement_block

### flow_maybe_type
  (children):    primary_type

### for_in_statement
  body:         statement
  kind?:        ("const" | "let" | "var")
  left:         array_pattern | identifier | member_expression | non_null_expression | object_pattern | parenthesized_expression | subscript_expression | undefined
  operator:     ("in" | "of")
  right:        expression | sequence_expression
  value?:       expression

### for_statement
  body:            statement
  condition:    [] empty_statement | expression | sequence_expression | (";")
  increment?:      expression | sequence_expression
  initializer:     empty_statement | expression | lexical_declaration | sequence_expression | variable_declaration

### formal_parameters
  (children): [] optional_parameter | required_parameter

### function_declaration
  body:                statement_block
  name:                identifier
  parameters:          formal_parameters
  return_type?:        asserts_annotation | type_annotation | type_predicate_annotation
  type_parameters?:    type_parameters

### function_expression
  body:                statement_block
  name?:               identifier
  parameters:          formal_parameters
  return_type?:        asserts_annotation | type_annotation | type_predicate_annotation
  type_parameters?:    type_parameters

### function_signature
  name:                identifier
  parameters:          formal_parameters
  return_type?:        asserts_annotation | type_annotation | type_predicate_annotation
  type_parameters?:    type_parameters

### function_type
  parameters:          formal_parameters
  return_type:         asserts | type | type_predicate
  type_parameters?:    type_parameters

### generator_function
  body:                statement_block
  name?:               identifier
  parameters:          formal_parameters
  return_type?:        asserts_annotation | type_annotation | type_predicate_annotation
  type_parameters?:    type_parameters

### generator_function_declaration
  body:                statement_block
  name:                identifier
  parameters:          formal_parameters
  return_type?:        asserts_annotation | type_annotation | type_predicate_annotation
  type_parameters?:    type_parameters

### generic_type
  name:               nested_type_identifier | type_identifier
  type_arguments:     type_arguments

### hash_bang_line
  (leaf)

### html_character_reference
  (leaf)

### html_comment
  (leaf)

### identifier
  (leaf)

### if_statement
  alternative?:    else_clause
  condition:       parenthesized_expression
  consequence:     statement

### implements_clause
  (children): [] type

### import
  (leaf)

### import_alias
  (children): [] identifier | nested_identifier

### import_attribute
  (children):    object

### import_clause
  (children): [] identifier | named_imports | namespace_import

### import_require_clause
  source:     string
  (children):    identifier

### import_specifier
  alias?:    identifier
  name:      identifier | string

### import_statement
  source?:    string
  (children): [] import_attribute | import_clause | import_require_clause

### index_signature
  index_type?:    type
  name?:          identifier
  sign?:          ("+" | "-")
  type:           adding_type_annotation | omitting_type_annotation | opting_type_annotation | type_annotation
  (children):    mapped_type_clause

### index_type_query
  (children):    primary_type

### infer_type
  (children): [] type | type_identifier

### instantiation_expression
  function?:          identifier | import | member_expression | subscript_expression
  type_arguments:     type_arguments
  (children):    expression

### interface_body
  (children): [] call_signature | construct_signature | export_statement | index_signature | method_signature | property_signature

### interface_declaration
  body:                interface_body
  name:                type_identifier
  type_parameters?:    type_parameters
  (children):    extends_type_clause

### internal_module
  body?:    statement_block
  name:     identifier | nested_identifier | string

### intersection_type
  (children): [] type

### jsx_attribute
  (children): [] jsx_element | jsx_expression | jsx_namespace_name | jsx_self_closing_element | property_identifier | string

### jsx_closing_element
  name?:    identifier | jsx_namespace_name | member_expression

### jsx_element
  close_tag:     jsx_closing_element
  open_tag:      jsx_opening_element
  (children): [] html_character_reference | jsx_element | jsx_expression | jsx_self_closing_element | jsx_text

### jsx_expression
  (children):    expression | sequence_expression | spread_element

### jsx_namespace_name
  (children): [] identifier

### jsx_opening_element
  attribute?:      [] jsx_attribute | jsx_expression
  name?:              identifier | jsx_namespace_name | member_expression
  type_arguments?:    type_arguments

### jsx_self_closing_element
  attribute?:      [] jsx_attribute | jsx_expression
  name?:              identifier | jsx_namespace_name | member_expression
  type_arguments?:    type_arguments

### jsx_text
  (leaf)

### labeled_statement
  body:      statement
  label:     statement_identifier

### lexical_declaration
  kind:     ("const" | "let")
  (children): [] variable_declarator

### literal_type
  (children):    false | null | number | string | true | unary_expression | undefined

### lookup_type
  (children): [] type

### mapped_type_clause
  alias?:    type
  name:      type_identifier
  type:      type

### member_expression
  object:             expression | import
  optional_chain?:    optional_chain
  property:           private_property_identifier | property_identifier

### meta_property
  (leaf)

### method_definition
  body:                statement_block
  name:                computed_property_name | number | private_property_identifier | property_identifier | string
  parameters:          formal_parameters
  return_type?:        asserts_annotation | type_annotation | type_predicate_annotation
  type_parameters?:    type_parameters
  (children): [] accessibility_modifier | override_modifier

### method_signature
  name:                computed_property_name | number | private_property_identifier | property_identifier | string
  parameters:          formal_parameters
  return_type?:        asserts_annotation | type_annotation | type_predicate_annotation
  type_parameters?:    type_parameters
  (children): [] accessibility_modifier | override_modifier

### module
  body?:    statement_block
  name:     identifier | nested_identifier | string

### named_imports
  (children): [] import_specifier

### namespace_export
  (children):    identifier | string

### namespace_import
  (children):    identifier

### nested_identifier
  object:       identifier | member_expression
  property:     property_identifier

### nested_type_identifier
  module:     identifier | nested_identifier
  name:       type_identifier

### new_expression
  arguments?:         arguments
  constructor:        primary_expression
  type_arguments?:    type_arguments

### non_null_expression
  (children):    expression

### null
  (leaf)

### number
  (leaf)

### object
  (children): [] method_definition | pair | shorthand_property_identifier | spread_element

### object_assignment_pattern
  left:      array_pattern | object_pattern | shorthand_property_identifier_pattern
  right:     expression

### object_pattern
  (children): [] object_assignment_pattern | pair_pattern | rest_pattern | shorthand_property_identifier_pattern

### object_type
  (children): [] call_signature | construct_signature | export_statement | index_signature | method_signature | property_signature

### omitting_type_annotation
  (children):    type

### opting_type_annotation
  (children):    type

### optional_chain
  (leaf)

### optional_parameter
  decorator?: [] decorator
  name?:         identifier
  pattern?:      pattern | this
  type?:         type_annotation
  value?:        expression
  (children): [] accessibility_modifier | override_modifier

### optional_type
  (children):    type

### override_modifier
  (leaf)

### pair
  key:       computed_property_name | number | private_property_identifier | property_identifier | string
  value:     expression

### pair_pattern
  key:       computed_property_name | number | private_property_identifier | property_identifier | string
  value:     assignment_pattern | pattern

### parenthesized_expression
  type?:    type_annotation
  (children):    call_expression | expression | identifier | member_expression | sequence_expression

### parenthesized_type
  (children):    type

### pattern
  (leaf)

### predefined_type
  (leaf)

### primary_expression
  (leaf)

### primary_type
  (leaf)

### private_property_identifier
  (leaf)

### program
  (children): [] hash_bang_line | statement

### property_identifier
  (leaf)

### property_signature
  name:     computed_property_name | number | private_property_identifier | property_identifier | string
  type?:    type_annotation
  (children): [] accessibility_modifier | override_modifier

### public_field_definition
  decorator?: [] decorator
  name:          computed_property_name | number | private_property_identifier | property_identifier | string
  type?:         type_annotation
  value?:        expression
  (children): [] accessibility_modifier | override_modifier

### readonly_type
  (children):    type

### regex
  flags?:      regex_flags
  pattern:     regex_pattern

### regex_flags
  (leaf)

### regex_pattern
  (leaf)

### required_parameter
  decorator?: [] decorator
  name?:         identifier | rest_pattern
  pattern?:      pattern | this
  type?:         type_annotation
  value?:        expression
  (children): [] accessibility_modifier | override_modifier

### rest_pattern
  (children):    array_pattern | identifier | member_expression | non_null_expression | object_pattern | subscript_expression | undefined

### rest_type
  (children):    type

### return_statement
  (children):    expression | sequence_expression

### satisfies_expression
  (children): [] expression | type

### sequence_expression
  (children): [] expression

### shorthand_property_identifier
  (leaf)

### shorthand_property_identifier_pattern
  (leaf)

### spread_element
  (children):    expression

### statement
  (leaf)

### statement_block
  (children): [] statement

### statement_identifier
  (leaf)

### string
  (children): [] escape_sequence | html_character_reference | string_fragment

### string_fragment
  (leaf)

### subscript_expression
  index:              expression | number | predefined_type | sequence_expression | string
  object:             expression
  optional_chain?:    optional_chain

### super
  (leaf)

### switch_body
  (children): [] switch_case | switch_default

### switch_case
  body?:  [] statement
  value:     expression | sequence_expression

### switch_default
  body?: [] statement

### switch_statement
  body:      switch_body
  value:     parenthesized_expression

### template_literal_type
  (children): [] string_fragment | template_type

### template_string
  (children): [] escape_sequence | string_fragment | template_substitution

### template_substitution
  (children):    expression | sequence_expression

### template_type
  (children):    infer_type | primary_type

### ternary_expression
  alternative:     expression
  condition:       expression
  consequence:     expression

### this
  (leaf)

### this_type
  (leaf)

### throw_statement
  (children):    expression | sequence_expression

### true
  (leaf)

### try_statement
  body:          statement_block
  finalizer?:    finally_clause
  handler?:      catch_clause

### tuple_type
  (children): [] optional_parameter | optional_type | required_parameter | rest_type | type

### type
  (leaf)

### type_alias_declaration
  name:                type_identifier
  type_parameters?:    type_parameters
  value:               type

### type_annotation
  (children):    type

### type_arguments
  (children): [] type

### type_identifier
  (leaf)

### type_parameter
  constraint?:    constraint
  name:           type_identifier
  value?:         default_type

### type_parameters
  (children): [] type_parameter

### type_predicate
  name:     identifier | this
  type:     type

### type_predicate_annotation
  (children):    type_predicate

### type_query
  (children):    call_expression | identifier | instantiation_expression | member_expression | subscript_expression | this

### unary_expression
  argument:     expression | number
  operator:     ("!" | "+" | "-" | +4 more)

### undefined
  (leaf)

### union_type
  (children): [] type

### update_expression
  argument:     expression
  operator:     ("++" | "--")

### variable_declaration
  (children): [] variable_declarator

### variable_declarator
  name:      array_pattern | identifier | object_pattern
  type?:     type_annotation
  value?:    expression

### while_statement
  body:          statement
  condition:     parenthesized_expression

### with_statement
  body:       statement
  object:     parenthesized_expression

### yield_expression
  (children):    expression

