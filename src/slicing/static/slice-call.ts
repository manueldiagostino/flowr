import {
	BuiltIn,
	EdgeType
} from '../../dataflow'
import type {
	DataflowGraph,
	DataflowGraphVertexInfo,
	REnvironmentInformation,
	DataflowGraphVertexFunctionDefinition
	, OutgoingEdges
} from '../../dataflow'
import { overwriteEnvironment, pushLocalEnvironment, resolveByName } from '../../dataflow/environments'
import type { NodeToSlice } from './slicer-types'
import type { VisitingQueue } from './visiting-queue'
import { guard } from '../../util/assert'
import type { Fingerprint } from './fingerprint'
import { envFingerprint } from './fingerprint'
import { getAllLinkedFunctionDefinitions } from '../../dataflow/internal/linker'

function retrieveActiveEnvironment(callerInfo: DataflowGraphVertexInfo, baseEnvironment: REnvironmentInformation): REnvironmentInformation {
	let callerEnvironment = callerInfo.environment

	if(baseEnvironment.level !== callerEnvironment.level) {
		while(baseEnvironment.level < callerEnvironment.level) {
			baseEnvironment = pushLocalEnvironment(baseEnvironment)
		}
		while(baseEnvironment.level > callerEnvironment.level) {
			callerEnvironment = pushLocalEnvironment(callerEnvironment)
		}
	}

	return overwriteEnvironment(baseEnvironment, callerEnvironment)
}

/** returns the new threshold hit count */
export function sliceForCall(current: NodeToSlice, callerInfo: DataflowGraphVertexInfo, dataflowGraph: DataflowGraph, queue: VisitingQueue): void {
	// bind with call-local environments during slicing
	const outgoingEdges = dataflowGraph.get(callerInfo.id, true)
	guard(outgoingEdges !== undefined, () => `outgoing edges of id: ${callerInfo.id} must be in graph but can not be found, keep in slice to be sure`)

	// lift baseEnv on the same level
	const baseEnvironment = current.baseEnvironment
	const baseEnvPrint = envFingerprint(baseEnvironment)

	const activeEnvironment = retrieveActiveEnvironment(callerInfo, baseEnvironment)
	const activeEnvironmentFingerprint = envFingerprint(activeEnvironment)

	const functionCallDefs = resolveByName(callerInfo.name, activeEnvironment)?.filter(d => d.definedAt !== BuiltIn)?.map(d => d.nodeId) ?? []

	for(const [target, outgoingEdge] of outgoingEdges[1].entries()) {
		if(outgoingEdge.types.has(EdgeType.Calls)) {
			functionCallDefs.push(target)
		}
	}

	const functionCallTargets = getAllLinkedFunctionDefinitions(new Set(functionCallDefs), dataflowGraph)
	for(const [_, functionCallTarget] of functionCallTargets) {
		// all those linked within the scopes of other functions are already linked when exiting a function definition
		for(const openIn of (functionCallTarget as DataflowGraphVertexFunctionDefinition).subflow.in) {
			const defs = openIn.name ? resolveByName(openIn.name, activeEnvironment) : undefined
			if(defs === undefined) {
				continue
			}
			for(const def of defs.filter(d => d.nodeId !== BuiltIn)) {
				queue.add(def.nodeId, baseEnvironment, baseEnvPrint, current.onlyForSideEffects, true)
			}
		}

		for(const exitPoint of (functionCallTarget as DataflowGraphVertexFunctionDefinition).exitPoints) {
			queue.add(exitPoint, activeEnvironment, activeEnvironmentFingerprint, current.onlyForSideEffects, true)
		}
	}
}

/** Returns true if we found at least one return edge */
export function handleReturns(queue: VisitingQueue, currentEdges: OutgoingEdges, baseEnvFingerprint: Fingerprint, baseEnvironment: REnvironmentInformation): boolean {
	let found = false
	for(const [, edge] of currentEdges) {
		if(edge.types.has(EdgeType.Returns)) {
			found = true
			break
		}
	}
	if(!found) {
		return false
	}
	for(const [target, edge] of currentEdges) {
		if(edge.types.has(EdgeType.Returns)) {
			queue.add(target, baseEnvironment, baseEnvFingerprint, false, true)
		} else if(edge.types.has(EdgeType.Reads)) {
			queue.add(target, baseEnvironment, baseEnvFingerprint, false, true)
		} else if(edge.types.has(EdgeType.Argument)) {
			queue.potentialArguments.add(target)
		}
	}
	return true
}
