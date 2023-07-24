import {
  getKeysGuarded,
  NamedXmlBasedJson,
  XmlBasedJson,
  XmlParseError,
} from "../../input-format"
import { getTokenType, retrieveMetaStructure } from "../meta"
import { parseLog } from "../../parser"
import { guard } from "../../../../../../../util/assert"
import { ParserData } from "../../data"
import { tryParseSymbol } from '../values'
import { normalizeBasedOnType, tryParseOneElementBasedOnType } from '../structure'
import { Type, RSymbol, RForLoop, RNode } from '../../../../model'
import { executeHook, executeUnknownHook } from '../../hooks'

export function tryParseForLoop(
  data: ParserData,
  forToken: NamedXmlBasedJson,
  condition: NamedXmlBasedJson,
  body: NamedXmlBasedJson
): RForLoop | undefined {
  // funny, for does not use top-level parenthesis
  if (forToken.name !== Type.For) {
    parseLog.debug("encountered non-for token for supposed for-loop structure")
    return executeUnknownHook(data.hooks.loops.onForLoop.unknown, data, { forToken, condition, body })
  } else if (condition.name !== Type.ForCondition) {
    throw new XmlParseError(`expected condition for for-loop but found ${JSON.stringify(condition)}`)
  } else if (body.name !== Type.Expression && body.name !== Type.ExprHelpAssignWrapper) {
    throw new XmlParseError(`expected expr body for for-loop but found ${JSON.stringify(body)}`)
  }

  parseLog.debug('trying to parse for-loop')

  const newParseData = { ...data, data, currentRange: undefined, currentLexeme: undefined };

  ({ forToken, condition, body } = executeHook(data.hooks.loops.onForLoop.before, data, { forToken, condition, body }))

  const { variable: parsedVariable, vector: parsedVector } =
    parseForLoopCondition(newParseData, condition.content)
  const parseBody = tryParseOneElementBasedOnType(newParseData, body)

  if (
    parsedVariable === undefined ||
    parsedVector === undefined ||
    parseBody === undefined
  ) {
    throw new XmlParseError(
      `unexpected under-sided for-loop, received ${JSON.stringify([
        parsedVariable,
        parsedVariable,
        parseBody,
      ])}`
    )
  }

  const { location, content } = retrieveMetaStructure(
    data.config,
    forToken.content
  )

  // TODO: assert exists as known operator
  const result: RForLoop = {
    type:     Type.For,
    variable: parsedVariable,
    vector:   parsedVector,
    body:     parseBody,
    lexeme:   content,
    info:     {
      // TODO: include children etc.
      fullRange:        data.currentRange,
      additionalTokens: [],
      fullLexeme:       data.currentLexeme,
    },
    location,
  }
  return executeHook(data.hooks.loops.onForLoop.after, data, result)
}

function parseForLoopCondition(data: ParserData, forCondition: XmlBasedJson): { variable: RSymbol | undefined, vector: RNode | undefined } {
  // must have a child which is `in`, a variable on the left, and a vector on the right
  const children: NamedXmlBasedJson[] = getKeysGuarded<XmlBasedJson[]>(forCondition, data.config.childrenName).map(content => ({
    name: getTokenType(data.config.tokenMap, content),
    content
  }))
  const inPosition = children.findIndex(elem => elem.name === Type.ForIn)
  guard(inPosition > 0 && inPosition < children.length - 1, () => `for loop searched in and found at ${inPosition}, but this is not in legal bounds for ${JSON.stringify(children)}`)
  const variable = tryParseSymbol(data, [children[inPosition - 1]])
  guard(variable !== undefined, () => `for loop variable should have been parsed to a symbol but was ${JSON.stringify(variable)}`)
  guard(variable.type === Type.Symbol, () => `for loop variable should have been parsed to a symbol but was ${JSON.stringify(variable)}`)
  // TODO: just parse single element directly
  const vector = normalizeBasedOnType(data, [children[inPosition + 1]])
  guard(vector.length === 1, () => `for loop vector should have been parsed to a single element but was ${JSON.stringify(vector)}`)

  return { variable, vector: vector[0] }
}
