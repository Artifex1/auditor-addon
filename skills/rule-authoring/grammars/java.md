# java — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-java/src/node-types.json` (151 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### _literal
  (leaf)

### _simple_type
  (leaf)

### _type
  (leaf)

### _unannotated_type
  (leaf)

### annotated_type
  (children): [] _unannotated_type | annotation | marker_annotation

### annotation
  arguments:     annotation_argument_list
  name:          identifier | scoped_identifier

### annotation_argument_list
  (children): [] annotation | element_value_array_initializer | element_value_pair | expression | marker_annotation

### annotation_type_body
  (children): [] annotation_type_declaration | annotation_type_element_declaration | class_declaration | constant_declaration | enum_declaration | interface_declaration

### annotation_type_declaration
  body:     annotation_type_body
  name:     identifier
  (children):    modifiers

### annotation_type_element_declaration
  dimensions?:    dimensions
  name:           identifier
  type:           _unannotated_type
  value?:         annotation | element_value_array_initializer | expression | marker_annotation
  (children):    modifiers

### argument_list
  (children): [] expression

### array_access
  array:     primary_expression
  index:     expression

### array_creation_expression
  dimensions:  [] dimensions | dimensions_expr
  type:           _simple_type
  value?:         array_initializer
  (children): [] annotation | marker_annotation

### array_initializer
  (children): [] array_initializer | expression

### array_type
  dimensions:     dimensions
  element:        _unannotated_type

### assert_statement
  (children): [] expression

### assignment_expression
  left:         array_access | field_access | identifier
  operator:     ("%=" | "&=" | "*=" | +9 more)
  right:        expression

### asterisk
  (leaf)

### binary_expression
  left:         expression
  operator:     ("!=" | "%" | "&" | +16 more)
  right:        expression

### binary_integer_literal
  (leaf)

### block
  (children): [] statement

### block_comment
  (leaf)

### boolean_type
  (leaf)

### break_statement
  (children):    identifier

### cast_expression
  type:   [] _type
  value:     expression

### catch_clause
  body:     block
  (children):    catch_formal_parameter

### catch_formal_parameter
  dimensions?:    dimensions
  name:           identifier | underscore_pattern
  (children): [] catch_type | modifiers

### catch_type
  (children): [] _unannotated_type

### character_literal
  (leaf)

### class_body
  (children): [] annotation_type_declaration | block | class_declaration | compact_constructor_declaration | constructor_declaration | enum_declaration | field_declaration | interface_declaration | method_declaration | record_declaration | static_initializer

### class_declaration
  body:                class_body
  interfaces?:         super_interfaces
  name:                identifier
  permits?:            permits
  superclass?:         superclass
  type_parameters?:    type_parameters
  (children):    modifiers

### class_literal
  (children):    _unannotated_type

### compact_constructor_declaration
  body:     block
  name:     identifier
  (children):    modifiers

### constant_declaration
  declarator:  [] variable_declarator
  type:           _unannotated_type
  (children):    modifiers

### constructor_body
  (children): [] explicit_constructor_invocation | statement

### constructor_declaration
  body:                constructor_body
  name:                identifier
  parameters:          formal_parameters
  type_parameters?:    type_parameters
  (children): [] modifiers | throws

### continue_statement
  (children):    identifier

### decimal_floating_point_literal
  (leaf)

### decimal_integer_literal
  (leaf)

### declaration
  (leaf)

### dimensions
  (children): [] annotation | marker_annotation

### dimensions_expr
  (children): [] annotation | expression | marker_annotation

### do_statement
  body:          statement
  condition:     parenthesized_expression

### element_value_array_initializer
  (children): [] annotation | element_value_array_initializer | expression | marker_annotation

### element_value_pair
  key:       identifier
  value:     annotation | element_value_array_initializer | expression | marker_annotation

### enhanced_for_statement
  body:           statement
  dimensions?:    dimensions
  name:           identifier | underscore_pattern
  type:           _unannotated_type
  value:          expression
  (children):    modifiers

### enum_body
  (children): [] enum_body_declarations | enum_constant

### enum_body_declarations
  (children): [] annotation_type_declaration | block | class_declaration | compact_constructor_declaration | constructor_declaration | enum_declaration | field_declaration | interface_declaration | method_declaration | record_declaration | static_initializer

### enum_constant
  arguments?:    argument_list
  body?:         class_body
  name:          identifier
  (children):    modifiers

### enum_declaration
  body:           enum_body
  interfaces?:    super_interfaces
  name:           identifier
  (children):    modifiers

### escape_sequence
  (leaf)

### explicit_constructor_invocation
  arguments:          argument_list
  constructor:        super | this
  object?:            primary_expression
  type_arguments?:    type_arguments

### exports_module_directive
  modules?: [] identifier | scoped_identifier
  package:     identifier | scoped_identifier

### expression
  (leaf)

### expression_statement
  (children):    expression

### extends_interfaces
  (children):    type_list

### false
  (leaf)

### field_access
  field:      identifier | this
  object:     primary_expression | super
  (children):    super

### field_declaration
  declarator:  [] variable_declarator
  type:           _unannotated_type
  (children):    modifiers

### finally_clause
  (children):    block

### floating_point_type
  (leaf)

### for_statement
  body:          statement
  condition?:    expression
  init?:      [] expression | local_variable_declaration
  update?:    [] expression

### formal_parameter
  dimensions?:    dimensions
  name:           identifier | underscore_pattern
  type:           _unannotated_type
  (children):    modifiers

### formal_parameters
  (children): [] formal_parameter | receiver_parameter | spread_parameter

### generic_type
  (children): [] scoped_type_identifier | type_arguments | type_identifier

### guard
  (children):    expression

### hex_floating_point_literal
  (leaf)

### hex_integer_literal
  (leaf)

### identifier
  (leaf)

### if_statement
  alternative?:    statement
  condition:       parenthesized_expression
  consequence:     statement

### import_declaration
  (children): [] asterisk | identifier | scoped_identifier

### inferred_parameters
  (children): [] identifier

### instanceof_expression
  left:        expression
  name?:       identifier
  pattern?:    record_pattern
  right?:      _type

### integral_type
  (leaf)

### interface_body
  (children): [] annotation_type_declaration | class_declaration | constant_declaration | enum_declaration | interface_declaration | method_declaration | record_declaration

### interface_declaration
  body:                interface_body
  name:                identifier
  permits?:            permits
  type_parameters?:    type_parameters
  (children): [] extends_interfaces | modifiers

### labeled_statement
  (children): [] identifier | statement

### lambda_expression
  body:           block | expression
  parameters:     formal_parameters | identifier | inferred_parameters

### line_comment
  (leaf)

### local_variable_declaration
  declarator:  [] variable_declarator
  type:           _unannotated_type
  (children):    modifiers

### marker_annotation
  name:     identifier | scoped_identifier

### method_declaration
  body?:               block
  dimensions?:         dimensions
  name:                identifier
  parameters:          formal_parameters
  type:                _unannotated_type
  type_parameters?:    type_parameters
  (children): [] annotation | marker_annotation | modifiers | throws

### method_invocation
  arguments:          argument_list
  name:               identifier
  object?:            primary_expression | super
  type_arguments?:    type_arguments
  (children):    super

### method_reference
  (children): [] _type | primary_expression | super | type_arguments

### modifiers
  (children): [] annotation | marker_annotation

### module_body
  (children): [] module_directive

### module_declaration
  body:     module_body
  name:     identifier | scoped_identifier
  (children): [] annotation | marker_annotation

### module_directive
  (leaf)

### multiline_string_fragment
  (leaf)

### null_literal
  (leaf)

### object_creation_expression
  arguments:          argument_list
  type:               _simple_type
  type_arguments?:    type_arguments
  (children): [] annotation | class_body | marker_annotation | primary_expression

### octal_integer_literal
  (leaf)

### opens_module_directive
  modules?: [] identifier | scoped_identifier
  package:     identifier | scoped_identifier

### package_declaration
  (children): [] annotation | identifier | marker_annotation | scoped_identifier

### parenthesized_expression
  (children):    expression

### pattern
  (children):    record_pattern | type_pattern

### permits
  (children):    type_list

### primary_expression
  (leaf)

### program
  (children): [] method_declaration | statement

### provides_module_directive
  provided:     identifier | scoped_identifier
  provider?: [] identifier | scoped_identifier
  (children):    identifier | scoped_identifier

### receiver_parameter
  (children): [] _unannotated_type | annotation | identifier | marker_annotation | this

### record_declaration
  body:                class_body
  interfaces?:         super_interfaces
  name:                identifier
  parameters:          formal_parameters
  type_parameters?:    type_parameters
  (children):    modifiers

### record_pattern
  (children): [] generic_type | identifier | record_pattern_body

### record_pattern_body
  (children): [] record_pattern | record_pattern_component

### record_pattern_component
  (children): [] _unannotated_type | identifier | underscore_pattern

### requires_modifier
  (leaf)

### requires_module_directive
  modifiers?: [] requires_modifier
  module:        identifier | scoped_identifier

### resource
  dimensions?:    dimensions
  name?:          identifier | underscore_pattern
  type?:          _unannotated_type
  value?:         expression
  (children):    field_access | identifier | modifiers

### resource_specification
  (children): [] resource

### return_statement
  (children):    expression

### scoped_identifier
  name:      identifier
  scope:     identifier | scoped_identifier

### scoped_type_identifier
  (children): [] annotation | generic_type | marker_annotation | scoped_type_identifier | type_identifier

### spread_parameter
  (children): [] _unannotated_type | annotation | marker_annotation | modifiers | variable_declarator

### statement
  (leaf)

### static_initializer
  (children):    block

### string_fragment
  (leaf)

### string_interpolation
  (children):    expression

### string_literal
  (children): [] escape_sequence | multiline_string_fragment | string_fragment | string_interpolation

### super
  (leaf)

### super_interfaces
  (children):    type_list

### superclass
  (children):    _type

### switch_block
  (children): [] switch_block_statement_group | switch_rule

### switch_block_statement_group
  (children): [] statement | switch_label

### switch_expression
  body:          switch_block
  condition:     parenthesized_expression

### switch_label
  (children): [] expression | guard | pattern

### switch_rule
  (children): [] block | expression_statement | switch_label | throw_statement

### synchronized_statement
  body:     block
  (children):    parenthesized_expression

### template_expression
  template_argument:      string_literal
  template_processor:     primary_expression

### ternary_expression
  alternative:     expression
  condition:       expression
  consequence:     expression

### this
  (leaf)

### throw_statement
  (children):    expression

### throws
  (children): [] _type

### true
  (leaf)

### try_statement
  body:     block
  (children): [] catch_clause | finally_clause

### try_with_resources_statement
  body:          block
  resources:     resource_specification
  (children): [] catch_clause | finally_clause

### type_arguments
  (children): [] _type | wildcard

### type_bound
  (children): [] _type

### type_identifier
  (leaf)

### type_list
  (children): [] _type

### type_parameter
  (children): [] annotation | marker_annotation | type_bound | type_identifier

### type_parameters
  (children): [] type_parameter

### type_pattern
  (children): [] _unannotated_type | identifier

### unary_expression
  operand:      expression
  operator:     ("!" | "+" | "-" | +1 more)

### underscore_pattern
  (leaf)

### update_expression
  (children):    expression

### uses_module_directive
  type:     identifier | scoped_identifier

### variable_declarator
  dimensions?:    dimensions
  name:           identifier | underscore_pattern
  value?:         array_initializer | expression

### void_type
  (leaf)

### while_statement
  body:          statement
  condition:     parenthesized_expression

### wildcard
  (children): [] _type | annotation | marker_annotation | super

### yield_statement
  (children):    expression

