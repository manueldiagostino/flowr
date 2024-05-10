import type { NodeId, ParentInformation, RFunctionArgument, RNode, RSymbol } from '../../../../../../r-bridge'
import { EmptyArgument } from '../../../../../../r-bridge'
import type { DataflowProcessorInformation } from '../../../../../processor'
import type { DataflowInformation } from '../../../../../info'
import { alwaysExits , filterOutLoopExitPoints } from '../../../../../info'
import {
	linkCircularRedefinitionsWithinALoop, linkInputs,
	produceNameSharedIdMap
} from '../../../../linker'
import { dataflowLogger, EdgeType, makeAllMaybe } from '../../../../../index'
import { processKnownFunctionCall } from '../known-call-handling'
import { guard, isUndefined } from '../../../../../../util/assert'
import { unpackArgument } from '../argument/unpack-argument'

export function processWhileLoop<OtherInfo>(
	name: RSymbol<OtherInfo & ParentInformation>,
	args: readonly RFunctionArgument<OtherInfo & ParentInformation>[],
	rootId: NodeId,
	data: DataflowProcessorInformation<OtherInfo & ParentInformation>
): DataflowInformation {
	if(args.length !== 2 || args[1] === EmptyArgument) {
		dataflowLogger.warn(`While-Loop ${name.content} does not have 2 arguments, skipping`)
		return processKnownFunctionCall({ name, args, rootId, data }).information
	}

	const unpackedArgs = args.map(unpackArgument)

	if(unpackedArgs.some(isUndefined)) {
		dataflowLogger.warn(`While-Loop ${name.content} has empty arguments in ${JSON.stringify(args)}, skipping`)
		return processKnownFunctionCall({ name, args, rootId, data }).information
	}

	/* we inject the cf-dependency of the while-loop after the condition */
	const { information, processedArguments } = processKnownFunctionCall({
		name,
		args:      unpackedArgs as RNode<ParentInformation & OtherInfo>[],
		rootId,
		data,
		markAsNSE: [1],
		patchData: (d, i) => {
			if(i === 1) {
				return { ...d, controlDependencies: [...d.controlDependencies ?? [], name.info.id] }
			}
			return d
		} })
	const [condition, body] = processedArguments

	guard(condition !== undefined && body !== undefined, () => `While-Loop ${name.content} has no condition or body, impossible!`)
	const originalDependency = data.controlDependencies

	if(alwaysExits(condition)) {
		dataflowLogger.warn(`While-Loop ${rootId} forces exit in condition, skipping rest`)
		return condition
	}

	const remainingInputs = linkInputs([
		...makeAllMaybe(body.unknownReferences, information.graph, information.environment, false),
		...makeAllMaybe(body.in, information.graph, information.environment, false)
	], information.environment, [...condition.in, ...condition.unknownReferences], information.graph, true)
	linkCircularRedefinitionsWithinALoop(information.graph, produceNameSharedIdMap(remainingInputs), body.out)

	// as the while-loop always evaluates its condition
	information.graph.addEdge(name.info.id, condition.entryPoint, { type: EdgeType.Reads })

	return {
		unknownReferences: [],
		in:                [{ nodeId: name.info.id, name: name.lexeme, controlDependencies: originalDependency }, ...remainingInputs],
		out:               [...makeAllMaybe(body.out, information.graph, information.environment, true), ...condition.out],
		entryPoint:        name.info.id,
		exitPoints:        filterOutLoopExitPoints(body.exitPoints),
		graph:             information.graph,
		environment:       information.environment
	}
}