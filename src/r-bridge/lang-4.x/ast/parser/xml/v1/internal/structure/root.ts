import type { XmlBasedJson } from '../../../common/input-format'
import { getKeyGuarded } from '../../../common/input-format'
import { assureTokenType } from '../../../common/meta'
import { normalizeBasedOnType } from './elements'
import type { ParserData } from '../../data'
import type { RExpressionList, RNode } from '../../../../../model'
import { RType, RawRType } from '../../../../../model'
import { log } from '../../../../../../../../util/log'
import { partition } from '../../../../../../../../util/arrays'
import type { RDelimiter } from '../../../../../model/nodes/info'

export function normalizeRootObjToAst(
	data: ParserData,
	obj: XmlBasedJson
): RExpressionList {
	const config = data.config
	const exprContent = getKeyGuarded<XmlBasedJson>(obj, RawRType.ExpressionList)
	assureTokenType(config.tokenMap, exprContent, RawRType.ExpressionList)

	let parsedChildren: (RNode | RDelimiter)[] = []

	if(config.children in exprContent) {
		const children = getKeyGuarded<XmlBasedJson[]>(
			exprContent,
			config.children
		)

		parsedChildren = normalizeBasedOnType(data, children)
	} else {
		log.debug('no children found, assume empty input')
	}

	const [delimiters, nodes] = partition(parsedChildren, x => x.type === RType.Delimiter)

	return {
		type:     RType.ExpressionList,
		children: nodes as RNode[],
		lexeme:   undefined,
		info:     {
			fullRange:        data.currentRange,
			additionalTokens: delimiters,
			fullLexeme:       data.currentLexeme
		}
	}
}
