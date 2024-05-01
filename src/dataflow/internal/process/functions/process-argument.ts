import type { ParentInformation, RArgument, RNode } from '../../../../r-bridge'
import { collectAllIds, RType } from '../../../../r-bridge'
import type { IdentifierReference } from '../../../environments'
import { DataflowGraph, EdgeType, VertexType } from '../../../graph'
import type { DataflowProcessorInformation } from '../../../processor'
import { processDataflowFor } from '../../../processor'
import type { DataflowInformation } from '../../../info'


export function linkReadsForArgument<OtherInfo>(root: RNode<OtherInfo & ParentInformation>, ingoingRefs: readonly IdentifierReference[], graph: DataflowGraph) {
	const allIdsBeforeArguments = new Set(collectAllIds(root, n => n.type === RType.Argument && n.info.id !== root.info.id))
	const ingoingBeforeArgs = ingoingRefs.filter(r => allIdsBeforeArguments.has(r.nodeId))

	for(const ref of ingoingBeforeArgs) {
		// link against the root reference currently I do not know how to deal with nested function calls otherwise
		graph.addEdge(root.info.id, ref, { type: EdgeType.Reads })
	}
}

export function processFunctionArgument<OtherInfo>(
	argument: RArgument<OtherInfo & ParentInformation>,
	data: DataflowProcessorInformation<OtherInfo & ParentInformation>
): DataflowInformation {
	const name = argument.name === undefined ? undefined : processDataflowFor(argument.name, data)
	const value = argument.value === undefined ? undefined : processDataflowFor(argument.value, data)
	// we do not keep the graph of the name, as this is no node that should ever exist
	const graph = value?.graph ?? new DataflowGraph()


	const argumentName = argument.name?.content
	let entryPoint = value?.entryPoint
	if(argumentName) {
		graph.addVertex({
			tag:               VertexType.Use,
			id:                argument.info.id,
			name:              argumentName,
			controlDependency: data.controlDependency
		})
		entryPoint = argument.info.id
	}

	const ingoingRefs = [...value?.unknownReferences ?? [], ...value?.in ?? [], ...(name === undefined ? [] : [...name.in])]

	if(entryPoint && argument.value?.type === RType.FunctionDefinition) {
		graph.addEdge(entryPoint, argument.value.info.id, { type: EdgeType.Reads })
	} else if(argumentName) {
		// we only need to link against those which are not already bound to another function call argument
		linkReadsForArgument(argument, [...ingoingRefs, ...value?.out ?? [] /* value may perform definitions */], graph)
	}

	return {
		unknownReferences: [],
		// active nodes of the name will be lost as they are only used to reference the corresponding parameter
		in:                ingoingRefs.filter(r => r.name !== undefined),
		// , ...value.out, ...(name?.out ?? [])
		out:               argumentName ?[ { name: argumentName, nodeId: argument.info.id, controlDependency: data.controlDependency } ] : [],
		graph:             graph,
		environment:       value?.environment ?? data.environment,
		entryPoint:        entryPoint ?? argument.info.id,
		returns:           [],
		breaks:            [],
		nexts:             []
	}
}
