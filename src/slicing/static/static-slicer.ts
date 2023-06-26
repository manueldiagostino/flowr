import { DataflowGraph, DataflowGraphNodeInfo, graphToMermaidUrl, LocalScope } from '../../dataflow'
import { guard } from '../../util/assert'
import { DecoratedAstMap, NodeId } from '../../r-bridge'
import { log } from '../../util/log'
import { getAllLinkedFunctionDefinitions } from '../../dataflow/internal/linker'
import { resolveByName } from '../../dataflow/environments'

export const slicerLogger = log.getSubLogger({ name: "slicer" })


/**
 * This returns the ids to include in the slice, when slicing with the given seed id's (must be at least one).
 * <p>
 * The returned ids can be used to {@link reconstructToCode | reconstruct the slice to R code}.
 */
export function naiveStaticSlicing<OtherInfo>(dataflowGraph: DataflowGraph, dataflowIdMap: DecoratedAstMap<OtherInfo>, id: NodeId[], visited: Set<NodeId> = new Set<NodeId>()): Set<NodeId> {
  guard(id.length > 0, `must have at least one seed id to calculate slice`)
  slicerLogger.trace(`calculating slice for ${id.length} seed ids: ${JSON.stringify(id)}`)
  const visitQueue = id

  while (visitQueue.length > 0) {
    const current = visitQueue.pop()

    if (current === undefined) {
      continue
    }
    visited.add(current)

    const currentInfo = dataflowGraph.get(current, true)

    slicerLogger.trace(`visiting id: ${current} with name: ${currentInfo?.[0].name ?? '<unknown>'}`)

    if(currentInfo === undefined) {
      slicerLogger.warn(`id: ${current} must be in graph but can not be found, keep in slice to be sure`)
      continue
    }

    if(currentInfo[0].tag === 'function-call') {
      linkOnFunctionCall(currentInfo[0], currentInfo[1], visited, visitQueue)
    }

    const currentNode = dataflowIdMap.get(current)
    guard(currentNode !== undefined, () => `id: ${current} must be in dataflowIdMap is not in ${graphToMermaidUrl(dataflowGraph, dataflowIdMap)}`)

    const liveEdges = currentInfo[1].outgoingEdges(currentInfo[0].id, false).filter(([_, e]) => e.type === 'read' || e.type === 'defined-by' || e.type === 'argument' || e.type === 'calls' || e.type === 'relates' || e.type === 'returns')
    for (const [target] of liveEdges) {
      if (!visited.has(target)) {
        slicerLogger.trace(`adding id: ${target} to visit queue`)
        visitQueue.push(target)
      }
    }
  }

  slicerLogger.trace(`static slicing produced: ${JSON.stringify([...visited])}`)

  return visited
}

function linkOnFunctionCall(callerInfo: DataflowGraphNodeInfo, dataflowGraph: DataflowGraph, visited: Set<NodeId>, visitQueue: NodeId[]) {
  // bind with call-local environments during slicing
  const functionCallDefs = dataflowGraph.outgoingEdges(callerInfo.id, true).filter(([_, e]) => e.type === 'calls').map(([target]) => target)
  const functionCallTargets = getAllLinkedFunctionDefinitions(functionCallDefs, dataflowGraph)

  for (const [_, functionCallTarget] of functionCallTargets) {
    guard(functionCallTarget.tag === 'function-definition', () => `expected function definition, but got ${functionCallTarget.tag}`)
    // all those linked within the scopes of other functions are already linked when exiting a function definition
    for (const openIn of functionCallTarget.subflow.in) {
      const defs = resolveByName(openIn.name, LocalScope, callerInfo.environment)
      if (defs === undefined) {
        continue
      }
      for (const def of defs) {
        if (!visited.has(def.nodeId)) {
          visitQueue.push(def.nodeId)
        }
      }
    }
  }
}

