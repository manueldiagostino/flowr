import { NamedXmlBasedJson } from '../../input-format'
import { tryParseOneElementBasedOnType } from '../structure/single-element'
import { parseLog } from '../../parser'
import { ParserData } from '../../data'
import { tryParseIfThenStructure } from './if-then'
import { guard } from '../../../../../../../util/assert'
import { Type } from '../../../../model/type'
import { RIfThenElse } from '../../../../model/nodes/RIfThenElse'

/**
 * Try to parse the construct as a {@link RIfThenElse}.
 */
export function tryParseIfThenElseStructure(data: ParserData,
                                            tokens: [
                                              ifToken:    NamedXmlBasedJson,
                                              leftParen:  NamedXmlBasedJson,
                                              condition:  NamedXmlBasedJson,
                                              rightParen: NamedXmlBasedJson,
                                              then:       NamedXmlBasedJson,
                                              elseToken:  NamedXmlBasedJson,
                                              elseBlock:  NamedXmlBasedJson
                                          ]): RIfThenElse | undefined {
  // we start by parsing a regular if-then structure
  parseLog.trace(`trying to parse if-then-else structure for ${JSON.stringify(tokens)}`)
  const parsedIfThen = tryParseIfThenStructure(data, [tokens[0], tokens[1], tokens[2], tokens[3], tokens[4]])
  if (parsedIfThen === undefined) {
    return undefined
  }
  parseLog.trace(`if-then part successful, now parsing else part for ${JSON.stringify([tokens[5], tokens[6]])}`)
  guard(tokens[5].name === Type.Else, `expected else token for if-then-else but found ${JSON.stringify(tokens[5])}`)

  const parsedElse = tryParseOneElementBasedOnType(data, tokens[6])
  guard(parsedElse !== undefined, `unexpected missing else-part of if-then-else, received ${JSON.stringify([parsedIfThen, parsedElse])} for ${JSON.stringify(tokens)}`)

  return {
    ...parsedIfThen,
    otherwise: parsedElse
  }
}
