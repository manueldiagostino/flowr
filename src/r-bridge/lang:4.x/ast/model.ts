import { type MergeableRecord } from '../../../util/objects'
import { type RNa, type RNull, type RNumberValue, type RStringValue } from '../values'
import { SourceRange } from '../../../util/range'

/**
 * Represents the types known by R (i.e., it may contain more or others than the ones we use)
 */
export const enum Type {
  ExpressionList = 'exprlist',
  Expression = 'expr',
  /*
   * https://github.com/REditorSupport/languageserver/issues/327
   * https://github.com/REditorSupport/languageserver/pull/328
   */
  ExprHelpAssignWrapper = 'expr_or_assign_or_help',
  Symbol = 'SYMBOL',
  /* will be represented as a number in R */
  Logical = 'boolean',
  /* this will be a symbol for us */
  Null = 'NULL_CONST',
  Number = 'NUM_CONST', // TODO: support negative numbers
  String = 'STR_CONST',
  BinaryOp = 'binaryop',
  UnaryOp = 'unaryop',
  Comment = 'COMMENT',
  /* can be special operators like %*% or %o% */
  Special = 'SPECIAL',
  // parens will be removed and dealt with as precedences/arguments automatically
  ParenLeft = '(',
  ParenRight = ')',
  BraceLeft = '{',
  BraceRight = '}',
  Semicolon = ';',
  For = 'FOR',
  ForCondition = 'forcond',
  ForIn = 'IN',
  Repeat = 'REPEAT',
  While = 'WHILE',
  If = 'IF',
  Else = 'ELSE',
  FunctionCall = 'SYMBOL_FUNCTION_CALL',
  SymbolPackage = 'SYMBOL_PACKAGE',
  NamespaceGet = 'NS_GET',
}

export type StringUsedInRCode = string

export const enum OperatorArity {
  Unary = 1,
  Binary = 2,
  Both = 3
}

export type UnaryOperatorFlavor = 'arithmetic' | 'logical'
export type BinaryOperatorFlavor = UnaryOperatorFlavor  | 'comparison' | 'assignment'
export type BinaryOperatorFlavorInAst = BinaryOperatorFlavor | 'special'
export type OperatorWrittenAs = 'infix' | 'prefix'
export type OperatorUsedAs = 'assignment' | 'operation' | 'access'
export type OperatorName = string

export interface OperatorInformationValue extends MergeableRecord {
  name:                 OperatorName
  stringUsedInRAst:     string
  stringUsedInternally: string
  // precedence: number // handled by R
  flavorInRAst:         BinaryOperatorFlavorInAst
  flavor:               BinaryOperatorFlavor
  writtenAs:            OperatorWrittenAs
  arity:                OperatorArity
  usedAs:               OperatorUsedAs
}

// TODO: remove flavor separation and use only one (no special)
// TODO: make it complete
/* eslint-disable */
export const OperatorDatabase: Record<StringUsedInRCode, OperatorInformationValue> & MergeableRecord = {
  /* arithmetic */
  '+':    { name: 'addition or unary +',          stringUsedInRAst: '+',            stringUsedInternally: '+',    flavorInRAst: 'arithmetic', flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Both,   usedAs: 'operation' },
  '-':    { name: 'subtraction or unary -',       stringUsedInRAst: '-',            stringUsedInternally: '-',    flavorInRAst: 'arithmetic', flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Both,   usedAs: 'operation' },
  '*':    { name: 'multiplication',               stringUsedInRAst: '*',            stringUsedInternally: '*',    flavorInRAst: 'arithmetic', flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '/':    { name: 'division',                     stringUsedInRAst: '/',            stringUsedInternally: '/',    flavorInRAst: 'arithmetic', flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '^':    { name: 'exponentiation',               stringUsedInRAst: '^',            stringUsedInternally: '^',    flavorInRAst: 'arithmetic', flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  /* no error, R uses ^ to represent ** in the AST */
  '**':   { name: 'alternative exponentiation',   stringUsedInRAst: '^' ,           stringUsedInternally: '**',   flavorInRAst: 'arithmetic', flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '%%':   { name: 'modulus',                      stringUsedInRAst: '%%',           stringUsedInternally: '%%',   flavorInRAst: 'special',    flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '%/%':  { name: 'integer division',             stringUsedInRAst: '%/%',          stringUsedInternally: '%/%',  flavorInRAst: 'special',    flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '%*%':  { name: 'matrix product',               stringUsedInRAst: '%*%',          stringUsedInternally: '%*%',  flavorInRAst: 'special',    flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '%o%':  { name: 'outer product',                stringUsedInRAst: '%o%',          stringUsedInternally: '%o%',  flavorInRAst: 'special',    flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '%x%':  { name: 'kronecker product',            stringUsedInRAst: '%x%',          stringUsedInternally: '%x%',  flavorInRAst: 'special',    flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  /* comparison */
  '==':   { name: 'equal to',                     stringUsedInRAst: 'EQ',           stringUsedInternally: '==',   flavorInRAst: 'comparison', flavor: 'comparison',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '!=':   { name: 'not equal to',                 stringUsedInRAst: 'NE',           stringUsedInternally: '!=',   flavorInRAst: 'comparison', flavor: 'comparison',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '>':    { name: 'greater than',                 stringUsedInRAst: 'GT',           stringUsedInternally: '>',    flavorInRAst: 'comparison', flavor: 'comparison',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '>=':   { name: 'greater than or equal to',     stringUsedInRAst: 'GE',           stringUsedInternally: '>=',   flavorInRAst: 'comparison', flavor: 'comparison',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '<':    { name: 'less than',                    stringUsedInRAst: 'LT',           stringUsedInternally: '<',    flavorInRAst: 'comparison', flavor: 'comparison',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '<=':   { name: 'less than or equal to',        stringUsedInRAst: 'LE',           stringUsedInternally: '<=',   flavorInRAst: 'comparison', flavor: 'comparison',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  /* logical */
  '&':    { name: 'logical and (vectorized)',     stringUsedInRAst: 'AND',          stringUsedInternally: '&',    flavorInRAst: 'logical',    flavor: 'logical',       writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '&&':   { name: 'logical and (non-vectorized)', stringUsedInRAst: 'AND2',         stringUsedInternally: '&&',   flavorInRAst: 'logical',    flavor: 'logical',       writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '|':    { name: 'logical or (vectorized)',      stringUsedInRAst: 'OR',           stringUsedInternally: '|',    flavorInRAst: 'logical',    flavor: 'logical',       writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '||':   { name: 'logical or (not-vectorized)',  stringUsedInRAst: 'OR2',          stringUsedInternally: '||',   flavorInRAst: 'logical',    flavor: 'logical',       writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  '!':    { name: 'unary not',                    stringUsedInRAst: '!',            stringUsedInternally: '!',    flavorInRAst: 'logical',    flavor: 'logical',       writtenAs: 'prefix', arity:  OperatorArity.Unary,  usedAs: 'operation' },
  '%in%': { name: 'matching operator',            stringUsedInRAst: '%in%',         stringUsedInternally: '%in%', flavorInRAst: 'special',    flavor: 'logical',       writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' },
  /* assignment */
  // TODO: clean up flavor? should not be special
  '<-':   { name: 'left assignment',              stringUsedInRAst: 'LEFT_ASSIGN',  stringUsedInternally: '<-',   flavorInRAst: 'special',    flavor: 'assignment',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'assignment' },
  '<<-':  { name: 'left global assignment',       stringUsedInRAst: 'LEFT_ASSIGN',  stringUsedInternally: '<<-',  flavorInRAst: 'special',    flavor: 'assignment',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'assignment' },
  '->':   { name: 'right assignment',             stringUsedInRAst: 'RIGHT_ASSIGN', stringUsedInternally: '->',   flavorInRAst: 'special',    flavor: 'assignment',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'assignment' },
  '->>':  { name: 'right global assignment',      stringUsedInRAst: 'RIGHT_ASSIGN', stringUsedInternally: '->>',  flavorInRAst: 'special',    flavor: 'assignment',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'assignment' },
  '=':    { name: 'equal assignment',             stringUsedInRAst: 'EQ_ASSIGN',    stringUsedInternally: '=',    flavorInRAst: 'special',    flavor: 'assignment',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'assignment' },
  /* others */
  /* maybe introduce custom in-r-ast flavor for these? we consider it arithmetic, as it works on numbers => if we change this we have to create custom tests! (with arithmetic, there is the automatic test set) */
  ':':    { name: 'sequence operator',            stringUsedInRAst: ':',            stringUsedInternally: ':',    flavorInRAst: 'special',    flavor: 'arithmetic',    writtenAs: 'infix',  arity:  OperatorArity.Binary, usedAs: 'operation' }
}
/* eslint-enable */

export const ArithmeticOperators: readonly string[] = Object.keys(OperatorDatabase).filter(op => OperatorDatabase[op].flavor === 'arithmetic')
// '**' will be treated as '^'
export const ArithmeticOperatorsRAst: readonly string[] = ArithmeticOperators.map(op => OperatorDatabase[op].stringUsedInRAst)

export const ComparisonOperators: readonly string[] = Object.keys(OperatorDatabase).filter(op => OperatorDatabase[op].flavor === 'comparison')
export const ComparisonOperatorsRAst: readonly string[] = ComparisonOperators.map(op => OperatorDatabase[op].stringUsedInRAst)

export const LogicalOperators: readonly string[] = Object.keys(OperatorDatabase).filter(op => OperatorDatabase[op].flavor === 'logical')
export const LogicalOperatorsRAst: readonly string[] = LogicalOperators.map(op => OperatorDatabase[op].stringUsedInRAst)

export const Assignments: readonly string[] = Object.keys(OperatorDatabase).filter(op => OperatorDatabase[op].flavor === 'assignment')
export const AssignmentsRAst: readonly string[] = Assignments.map(op => OperatorDatabase[op].stringUsedInRAst)

export const Operators = [...ArithmeticOperators, ...ComparisonOperators, ...LogicalOperators] as const
export type Operator = typeof Operators[number]

/** simply used as an empty interface with no information about additional decorations */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface NoInfo {
}

/**
 * @typeParam Info - can be used to store additional information about the node
 */
export type Base<Info = NoInfo, LexemeType = string> = {
  type:   Type
  /** the original string retrieved from R, can be used for further identification */
  lexeme: LexemeType
} & MergeableRecord & Info

interface WithChildren<Info, Children extends Base<Info, string | undefined>> {
  children: Children[]
}

type Leaf<Info = NoInfo, LexemeType = string> = Base<Info, LexemeType>

interface Location {
  location: SourceRange
}

export type NamespaceIdentifier = string
interface Namespace {
  /* null for unknown atm */
  namespace: NamespaceIdentifier | null
}


export type RExpressionList<Info = NoInfo> = {
  readonly type:     Type.ExpressionList
  readonly content?: string
} & WithChildren<Info, RNode<Info>> & Base<Info, string | undefined> & Partial<Location>

export type RSymbol<Info = NoInfo, T extends string = string> = {
  readonly type: Type.Symbol
  content:       T
} & Leaf<Info> & Location

/** includes numeric, integer, and complex */
export type RNumber<Info = NoInfo> = {
  readonly type: Type.Number
  content:       RNumberValue
} & Leaf<Info> & Location

export type RLogicalValue = boolean

export type RLogical<Info = NoInfo> = {
  readonly type: Type.Logical
  content:       RLogicalValue
} & Leaf<Info> & Location

export type RString<Info = NoInfo> = {
  readonly type: Type.String
  content:       RStringValue
} & Leaf<Info> & Location

// TODO: others?
export type RBinaryOp<Info = NoInfo> = {
  readonly type:   Type.BinaryOp
  readonly flavor: BinaryOperatorFlavor
  op:              string
  lhs:             RNode<Info>
  rhs:             RNode<Info>
} & Base<Info> & Location

export type RLogicalBinaryOp<Info = NoInfo> = {
  flavor: 'logical'
} & RBinaryOp<Info>

export type RArithmeticBinaryOp<Info = NoInfo> = {
  flavor: 'arithmetic'
} & RBinaryOp<Info>

export type RComparisonBinaryOp<Info = NoInfo> = {
  flavor: 'comparison'
} & RBinaryOp<Info>

export type RAssignmentOp<Info = NoInfo> = {
  flavor: 'assignment'
} & RBinaryOp<Info>

export type RUnaryOp<Info = NoInfo> = {
  readonly type:   Type.UnaryOp
  readonly flavor: UnaryOperatorFlavor
  op:              string
  operand:         RNode<Info>
} & Base<Info> & Location

export type RLogicalUnaryOp<Info = NoInfo> = {
  flavor: 'logical'
} & RUnaryOp<Info>

export type RArithmeticUnaryOp<Info = NoInfo> = {
  flavor: 'arithmetic'
} & RUnaryOp<Info>

export type RIfThenElse<Info = NoInfo> = {
  readonly type: Type.If
  condition:     RNode<Info>
  then:          RNode<Info>
  otherwise?:    RNode<Info>
} & Base<Info> & Location

/**
 * ```ts
 * for(<variable> in <vector>) <body>
 * ```
 */
export type RForLoop<Info = NoInfo> = {
  readonly type: Type.For
  /** variable used in for-loop: <p> `for(<variable> in ...) ...`*/
  variable:      RSymbol<Info>
  /** vector used in for-loop: <p> `for(... in <vector>) ...`*/
  vector:        RNode<Info>
  /** body used in for-loop: <p> `for(... in ...) <body>`*/
  body:          RNode<Info>
} & Base<Info> & Location

/**
 * ```ts
 * repeat <body>
 * ```
 */
export type RRepeatLoop<Info = NoInfo> = {
  readonly type: Type.Repeat
  body:          RNode<Info>
} & Base<Info> & Location

/**
 * ```ts
 * while ( <condition> ) <body>
 * ```
 */
export type RWhileLoop<Info = NoInfo> = {
  readonly type: Type.While
  condition:     RNode<Info>
  body:          RNode<Info>
} & Base<Info> & Location

export type RFunctionCall<Info = NoInfo> = {
  readonly type: Type.FunctionCall
  arguments:     RNode<Info>[]
} & Namespace & Base<Info> & Location



// TODO: special constants
export type RConstant<Info> = RNumber<Info> | RString<Info> | RLogical<Info> | RSymbol<Info, typeof RNull | typeof RNa>

export type RSingleNode<Info> = RSymbol<Info> | RConstant<Info>
export type RLoopConstructs<Info> = RForLoop<Info> | RRepeatLoop<Info> | RWhileLoop<Info>
export type RConstructs<Info> = RLoopConstructs<Info> | RIfThenElse<Info>
export type RCalls<Info>       = RFunctionCall<Info>
export type RNode<Info = NoInfo> = RExpressionList<Info> | RCalls<Info> | RConstructs<Info> | RUnaryOp<Info> | RBinaryOp<Info> | RSingleNode<Info>
