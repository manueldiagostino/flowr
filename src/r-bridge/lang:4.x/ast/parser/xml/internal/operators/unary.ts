import { NamedXmlBasedJson } from '../../input-format'
import { retrieveMetaStructure, retrieveOpName } from '../meta'
import { parseLog } from '../../parser'
import { tryParseOneElementBasedOnType } from '../structure'
import { ParserData } from '../../data'
import { guard } from '../../../../../../../util/assert'
import {
  Type,
  RNode,
  RUnaryOp,
  ArithmeticOperatorsRAst,
  LogicalOperatorsRAst,
  UnaryOperatorFlavor
} from '../../../../model'
import { executeHook, executeUnknownHook } from '../../hooks'

/**
 * Parses the construct as a {@link RUnaryOp} (automatically identifies the flavor).
 *
 * @param data - The data used by the parser (see {@link ParserData})
 * @param op - The operator token
 * @param operand - The operand of the unary operator
 *
 * @returns The parsed {@link RUnaryOp} or `undefined` if the given construct is not a unary operator
 */
export function tryParseUnaryStructure(data: ParserData, op: NamedXmlBasedJson, operand: NamedXmlBasedJson): RNode | undefined {
  parseLog.trace(`unary op for ${op.name} ${operand.name}`)
  let flavor: UnaryOperatorFlavor
  // TODO: filter for unary
  if (ArithmeticOperatorsRAst.includes(op.name)) {
    flavor = 'arithmetic'
  } else if (LogicalOperatorsRAst.includes(op.name)) {
    flavor = 'logical'
  } else {
    return executeUnknownHook(data.hooks.operators.onUnary.unknown, data, { op, operand })
  }
  return parseUnaryOp(data, flavor, op, operand)
}

function parseUnaryOp(data: ParserData, flavor: UnaryOperatorFlavor, op: NamedXmlBasedJson, operand: NamedXmlBasedJson): RUnaryOp {
  parseLog.debug(`[unary op] parse ${flavor} with ${JSON.stringify([op, operand])}`); // <- sadly required for not miss-interpreting the destructuring match as call
  ({ flavor, op, operand} = executeHook(data.hooks.operators.onUnary.before, data, { flavor, op, operand }))

  const parsedOperand = tryParseOneElementBasedOnType(data, operand)

  guard(parsedOperand !== undefined, `unexpected under-sided unary op for ${JSON.stringify([op, operand])}`)

  const operationName = retrieveOpName(data.config, op)
  const { location, content } = retrieveMetaStructure(data.config, op.content)

  // TODO: assert exists as known operator
  const result: RUnaryOp = {
    type:    Type.UnaryOp,
    flavor,
    location,
    op:      operationName,
    lexeme:  content,
    operand: parsedOperand,
    info:    {}
  }
  return executeHook(data.hooks.operators.onUnary.after, data, result)
}