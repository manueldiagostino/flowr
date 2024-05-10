import type {
	NodeId,
	ParentInformation, RFunctionArgument,
	RSymbol
} from '../../../../../../r-bridge'
import { type DataflowProcessorInformation } from '../../../../../processor'
import type { DataflowInformation } from '../../../../../info'
import type { IdentifierReference } from '../../../../../index'
import { EdgeType } from '../../../../../index'
import { processKnownFunctionCall } from '../known-call-handling'


export function processQuote<OtherInfo>(
	name: RSymbol<OtherInfo & ParentInformation>,
	args: readonly RFunctionArgument<OtherInfo & ParentInformation>[],
	rootId: NodeId,
	data: DataflowProcessorInformation<OtherInfo & ParentInformation>,
	config?: { quoteArgumentsWithIndex?: number }
): DataflowInformation {
	const { information, processedArguments, fnRef  } = processKnownFunctionCall({ name, args, rootId, data })

	const inRefs: IdentifierReference[] = [fnRef]
	const outRefs: IdentifierReference[] = []
	const unknownRefs: IdentifierReference[] = []

	for(let i = 0; i < args.length; i++) {
		const processedArg = processedArguments[i]
		if(processedArg && i !== config?.quoteArgumentsWithIndex) {
			inRefs.push(...processedArg.in)
			outRefs.push(...processedArg.out)
			unknownRefs.push(...processedArg.unknownReferences)
		} else if(processedArg) {
			information.graph.addEdge(rootId, processedArg.entryPoint, { type: EdgeType.NonStandardEvaluation })
		}
	}

	return {
		...information,
		in:                inRefs,
		out:               outRefs,
		unknownReferences: unknownRefs
	}
}