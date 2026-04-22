# python — tree-sitter named node types

> Generated from `vendor/grammars/tree-sitter-python/src/node-types.json` (129 named types).  
> Re-run: `python3 scripts/gen-grammar-refs.py {lang}`

**How to use in rules:**
- `ast.type(handle)` → matches the `### name` heading
- `ast.child_by_field(handle, "field")` → uses field names listed below
- `ast.find(handle, "type")` → searches descendants by `### name`
- `?` = optional field, `[]` = can appear multiple times

---

### _compound_statement
  (leaf)

### _simple_statement
  (leaf)

### aliased_import
  alias:     identifier
  name:      dotted_name

### argument_list
  (children): [] dictionary_splat | expression | keyword_argument | list_splat | parenthesized_expression

### as_pattern
  alias?:    as_pattern_target
  (children): [] case_pattern | expression | identifier

### assert_statement
  (children): [] expression

### assignment
  left:      pattern | pattern_list
  right?:    assignment | augmented_assignment | expression | expression_list | pattern_list | yield
  type?:     type

### attribute
  attribute:     identifier
  object:        primary_expression

### augmented_assignment
  left:         pattern | pattern_list
  operator:     ("%=" | "&=" | "**=" | +10 more)
  right:        assignment | augmented_assignment | expression | expression_list | pattern_list | yield

### await
  (children):    primary_expression

### binary_operator
  left:         primary_expression
  operator:     ("%" | "&" | "*" | +10 more)
  right:        primary_expression

### block
  alternative?: [] case_clause
  (children): [] _compound_statement | _simple_statement

### boolean_operator
  left:         expression
  operator:     ("and" | "or")
  right:        expression

### break_statement
  (leaf)

### call
  arguments:     argument_list | generator_expression
  function:      primary_expression

### case_clause
  consequence:     block
  guard?:          if_clause
  (children): [] case_pattern

### case_pattern
  (children):    as_pattern | class_pattern | complex_pattern | concatenated_string | dict_pattern | dotted_name | false | float | integer | keyword_pattern | list_pattern | none | splat_pattern | string | true | tuple_pattern | union_pattern

### chevron
  (children):    expression

### class_definition
  body:                block
  name:                identifier
  superclasses?:       argument_list
  type_parameters?:    type_parameter

### class_pattern
  (children): [] case_pattern | dotted_name

### comment
  (leaf)

### comparison_operator
  operators:  [] ("!=" | "<" | "<=" | +8 more)
  (children): [] primary_expression

### complex_pattern
  (children): [] float | integer

### concatenated_string
  (children): [] string

### conditional_expression
  (children): [] expression

### constrained_type
  (children): [] type

### continue_statement
  (leaf)

### decorated_definition
  definition:     class_definition | function_definition
  (children): [] decorator

### decorator
  (children):    expression

### default_parameter
  name:      identifier | tuple_pattern
  value:     expression

### delete_statement
  (children):    expression | expression_list

### dict_pattern
  key?:   [] class_pattern | complex_pattern | concatenated_string | dict_pattern | dotted_name | false | float | integer | list_pattern | none | splat_pattern | string | true | tuple_pattern | union_pattern | ("-" | "_")
  value?: [] case_pattern
  (children): [] splat_pattern

### dictionary
  (children): [] dictionary_splat | pair

### dictionary_comprehension
  body:     pair
  (children): [] for_in_clause | if_clause

### dictionary_splat
  (children):    expression

### dictionary_splat_pattern
  (children):    attribute | identifier | subscript

### dotted_name
  (children): [] identifier

### elif_clause
  condition:       expression
  consequence:     block

### ellipsis
  (leaf)

### else_clause
  body:     block

### escape_interpolation
  (leaf)

### escape_sequence
  (leaf)

### except_clause
  alias?:    expression
  value?: [] expression
  (children):    block

### exec_statement
  code:     identifier | string
  (children): [] expression

### expression
  (leaf)

### expression_list
  (children): [] expression

### expression_statement
  (leaf)

### false
  (leaf)

### finally_clause
  (children):    block

### float
  (leaf)

### for_in_clause
  left:      pattern | pattern_list
  right:  [] expression | (",")

### for_statement
  alternative?:    else_clause
  body:            block
  left:            pattern | pattern_list
  right:           expression | expression_list

### format_expression
  expression:           expression | expression_list | pattern_list | yield
  format_specifier?:    format_specifier
  type_conversion?:     type_conversion

### format_specifier
  (children): [] format_expression

### function_definition
  body:                block
  name:                identifier
  parameters:          parameters
  return_type?:        type
  type_parameters?:    type_parameter

### future_import_statement
  name:  [] aliased_import | dotted_name

### generator_expression
  body:     expression
  (children): [] for_in_clause | if_clause

### generic_type
  (children): [] identifier | type_parameter

### global_statement
  (children): [] identifier

### identifier
  (leaf)

### if_clause
  (children):    expression

### if_statement
  alternative?: [] elif_clause | else_clause
  condition:       expression
  consequence:     block

### import_from_statement
  module_name:     dotted_name | relative_import
  name?:        [] aliased_import | dotted_name
  (children):    wildcard_import

### import_prefix
  (leaf)

### import_statement
  name:  [] aliased_import | dotted_name

### integer
  (leaf)

### interpolation
  expression:           expression | expression_list | pattern_list | yield
  format_specifier?:    format_specifier
  type_conversion?:     type_conversion

### keyword_argument
  name:      identifier
  value:     expression

### keyword_pattern
  (children): [] class_pattern | complex_pattern | concatenated_string | dict_pattern | dotted_name | false | float | identifier | integer | list_pattern | none | splat_pattern | string | true | tuple_pattern | union_pattern

### keyword_separator
  (leaf)

### lambda
  body:           expression
  parameters?:    lambda_parameters

### lambda_parameters
  (children): [] parameter

### line_continuation
  (leaf)

### list
  (children): [] expression | list_splat | parenthesized_list_splat | yield

### list_comprehension
  body:     expression
  (children): [] for_in_clause | if_clause

### list_pattern
  (children): [] case_pattern | pattern

### list_splat
  (children):    attribute | expression | identifier | subscript

### list_splat_pattern
  (children):    attribute | identifier | subscript

### match_statement
  body:        block
  subject:  [] expression

### member_type
  (children): [] identifier | type

### module
  (children): [] _compound_statement | _simple_statement

### named_expression
  name:      identifier
  value:     expression

### none
  (leaf)

### nonlocal_statement
  (children): [] identifier

### not_operator
  argument:     expression

### pair
  key:       expression
  value:     expression

### parameter
  (leaf)

### parameters
  (children): [] parameter

### parenthesized_expression
  (children):    expression | list_splat | parenthesized_expression | yield

### parenthesized_list_splat
  (children):    list_splat | parenthesized_expression

### pass_statement
  (leaf)

### pattern
  (leaf)

### pattern_list
  (children): [] pattern

### positional_separator
  (leaf)

### primary_expression
  (leaf)

### print_statement
  argument?: [] expression
  (children):    chevron

### raise_statement
  cause?:    expression
  (children):    expression | expression_list

### relative_import
  (children): [] dotted_name | import_prefix

### return_statement
  (children):    expression | expression_list

### set
  (children): [] expression | list_splat | parenthesized_list_splat | yield

### set_comprehension
  body:     expression
  (children): [] for_in_clause | if_clause

### slice
  (children): [] expression

### splat_pattern
  (children):    identifier

### splat_type
  (children):    identifier

### string
  (children): [] interpolation | string_content | string_end | string_start

### string_content
  (children): [] escape_interpolation | escape_sequence

### string_end
  (leaf)

### string_start
  (leaf)

### subscript
  subscript:  [] expression | slice
  value:         primary_expression

### true
  (leaf)

### try_statement
  body:     block
  (children): [] else_clause | except_clause | finally_clause

### tuple
  (children): [] expression | list_splat | parenthesized_list_splat | yield

### tuple_expression
  (children): [] expression

### tuple_pattern
  (children): [] case_pattern | pattern

### type
  (children):    constrained_type | expression | generic_type | member_type | splat_type | union_type

### type_alias_statement
  left:      type
  right:     type

### type_conversion
  (leaf)

### type_parameter
  (children): [] type

### typed_default_parameter
  name:      identifier
  type:      type
  value:     expression

### typed_parameter
  type:     type
  (children):    dictionary_splat_pattern | identifier | list_splat_pattern

### unary_operator
  argument:     primary_expression
  operator:     ("+" | "-" | "~")

### union_pattern
  (children): [] class_pattern | complex_pattern | concatenated_string | dict_pattern | dotted_name | false | float | integer | list_pattern | none | splat_pattern | string | true | tuple_pattern | union_pattern

### union_type
  (children): [] type

### while_statement
  alternative?:    else_clause
  body:            block
  condition:       expression

### wildcard_import
  (leaf)

### with_clause
  (children): [] with_item

### with_item
  value:     expression

### with_statement
  body:     block
  (children):    with_clause

### yield
  (children):    expression | expression_list

