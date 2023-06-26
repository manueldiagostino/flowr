import { NodeId, NoInfo } from '../r-bridge'
import { SourceRange } from './range'
import {
  BuiltIn,
  DataflowFunctionFlowInformation,
  DataflowGraph,
  DataflowGraphEdgeAttribute, DataflowGraphNodeInfo,
  DataflowMap,
  DataflowScopeName, FunctionArgument, IdentifierReference
} from '../dataflow'
import { guard } from './assert'

export function formatRange(range: SourceRange | undefined): string {
  if (range === undefined) {
    return '??'
  }

  return `${range.start.line}.${range.start.column}-${range.end.line}.${range.end.column}`
}

function scopeToMermaid(scope: DataflowScopeName, when: DataflowGraphEdgeAttribute): string {
  const whenText = when === 'always' ? '' : `, ${when}`
  return `, *${scope.replace('<', '#lt;')}${whenText}*`
}

function stylesForDefinitionKindsInEnvironment(_subflow: DataflowFunctionFlowInformation, _lines: string[], _idPrefix: string) {
  // TODO: highlight seems to be often wrong
}

function subflowToMermaid(nodeId: NodeId, exitPoints: NodeId[], subflow: DataflowFunctionFlowInformation | undefined, dataflowIdMap: DataflowMap<NoInfo> | undefined, lines: string[], idPrefix = '', mark?: Set<NodeId>): void {
  if(subflow === undefined) {
    return
  }
  const subflowId = `${idPrefix}flow-${nodeId}`
  lines.push(`\nsubgraph "${subflowId}" [function ${nodeId}]`)
  lines.push(graphToMermaid(subflow.graph, dataflowIdMap, null, idPrefix, mark))
  for(const [color, pool] of [['purple', subflow.in], ['green', subflow.out], ['orange', subflow.activeNodes]]) {
    for (const out of pool as IdentifierReference[]) {
      if(!mark?.has(out.nodeId)) {
        // in/out/active for unmarked
        lines.push(`    style ${idPrefix}${out.nodeId} stroke:${color as string},stroke-width:4px; `)
      }
    }
  }
  for(const exitPoint of exitPoints) {
    if(!subflow.graph.hasNode(exitPoint)) {
      const node = dataflowIdMap?.get(exitPoint)
      guard(node !== undefined, 'exit point not found')
      lines.push(` ${idPrefix}${exitPoint}{{"${node.lexeme ?? '??'} (${exitPoint})\n      ${formatRange(dataflowIdMap?.get(exitPoint)?.location)}"}}`)
    }
    lines.push(`    style ${idPrefix}${exitPoint} stroke-width:6.5px;`)
  }
  stylesForDefinitionKindsInEnvironment(subflow, lines, idPrefix)
  lines.push('end')
  lines.push(`${idPrefix}${nodeId} -.-|function| ${subflowId}\n`)
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function displayEnvReplacer(key: any, value: any): any {
  if(value instanceof Map) {
    return [...value]
  } else {
    return value
  }
}

function printArg(arg: IdentifierReference | '<value>' | undefined): string {
  if(arg === undefined || arg === '<value>') {
    return '??'
  }
  return `${arg.nodeId}`
}
function displayFunctionArgMapping(argMapping: FunctionArgument[]): string {
  const result = []
  for(const arg of argMapping) {
    result.push(Array.isArray(arg) ? `${arg[0]} -> ${printArg(arg[1])}` : `${printArg(arg)}`)
  }
  return result.length === 0 ? '' : `\n    (${result.join(', ')})`
}

function escapeMarkdown(text: string): string {
  return text.replace(/([+\-*])/g, '\\$1')
}

function nodeToMermaid(info: DataflowGraphNodeInfo, lines: string[], id: NodeId, idPrefix: string, dataflowIdMap: DataflowMap<NoInfo> | undefined, mark: Set<NodeId> | undefined, hasBuiltIn: boolean) {
  const def = info.tag === 'variable-definition' || info.tag === 'function-definition'
  const fCall = info.tag === 'function-call'
  const defText = def ? scopeToMermaid(info.scope, info.when) : ''
  let open: string
  let close: string
  if (def) {
    open = '['
    close = ']'
  } else if (fCall) {
    open = '[['
    close = ']]'
  } else {
    open = '(['
    close = '])'
  }
  lines.push(`    %% ${id}: ${JSON.stringify(info.environment, displayEnvReplacer)}`)
  lines.push(`    ${idPrefix}${id}${open}"\`${escapeMarkdown(info.name)} (${id}${defText})\n      *${formatRange(dataflowIdMap?.get(id)?.location)}*${
    fCall ? displayFunctionArgMapping(info.args) : ''
  }\`"${close}`)
  if (mark?.has(id)) {
    lines.push(`    style ${idPrefix}${id} stroke:black,stroke-width:7px; `)
  }
  for (const edge of info.edges) {
    const dotEdge = edge.type === 'same-def-def' || edge.type === 'same-read-read' || edge.type === 'relates'
    lines.push(`    ${idPrefix}${id} ${dotEdge ? '-.-' : '-->'}|"${edge.type} (${edge.attribute})"| ${idPrefix}${edge.target}`)
    if (edge.target === BuiltIn) {
      hasBuiltIn = true
    }
  }
  if (info.tag === 'function-definition') {
    subflowToMermaid(id, info.exitPoints, info.subflow, dataflowIdMap, lines, idPrefix, mark)
  }
  return hasBuiltIn
}

export function graphToMermaid(graph: DataflowGraph, dataflowIdMap: DataflowMap<NoInfo> | undefined, prefix: string | null = 'flowchart TD', idPrefix = '', mark?: Set<NodeId>): string {
  let hasBuiltIn = false
  const lines = prefix === null ? [] : [prefix]
  for (const [id, info] of graph.entries()) {
    hasBuiltIn = nodeToMermaid(info, lines, id, idPrefix, dataflowIdMap, mark, hasBuiltIn)
  }
  if(hasBuiltIn) {
    lines.push(`    ${idPrefix}${BuiltIn}["Built-in"]`)
  }
  return lines.join('\n')
}

/**
 * Converts mermaid code (potentially produced by {@link graphToMermaid}) to an url that presents the graph in the mermaid editor.
 *
 * @param code - code to convert
 */
export function mermaidCodeToUrl(code: string): string {
  const obj = {
    code,
    mermaid:       {},
    updateEditor:  false,
    autoSync:      true,
    updateDiagram: false
  }
  return `https://mermaid.live/edit#base64:${Buffer.from(JSON.stringify(obj)).toString('base64')}`
}

/**
 * Converts a dataflow graph to a mermaid url that visualizes the graph.
 *
 * @param graph         - graph to convert
 * @param dataflowIdMap - id map to use to get access to the graph id mappings
 * @param mark          - special nodes to mark (e.g. those included in the slice)
 */
export function graphToMermaidUrl(graph: DataflowGraph, dataflowIdMap: DataflowMap<NoInfo>, mark?: Set<NodeId>): string {
  return mermaidCodeToUrl(graphToMermaid(graph, dataflowIdMap, undefined, undefined, mark))
}

export interface LabeledDiffGraph {
  label: string
  graph: DataflowGraph
}

/** uses same id map but ensures, it is different from the rhs so that mermaid can work with that */
export function diffGraphsToMermaid(left: LabeledDiffGraph, right: LabeledDiffGraph, dataflowIdMap: DataflowMap<NoInfo> | undefined, prefix: string): string {
  // we add the prefix ourselves
  const leftGraph = graphToMermaid(left.graph, dataflowIdMap, '', `l-${left.label}`)
  const rightGraph = graphToMermaid(right.graph, dataflowIdMap, '', `r-${right.label}`)

  return `${prefix}flowchart TD\nsubgraph "${left.label}"\n${leftGraph}\nend\nsubgraph "${right.label}"\n${rightGraph}\nend`
}

export function diffGraphsToMermaidUrl(left: LabeledDiffGraph, right: LabeledDiffGraph, dataflowIdMap: DataflowMap<NoInfo> | undefined, prefix: string): string {
  return mermaidCodeToUrl(diffGraphsToMermaid(left, right, dataflowIdMap, prefix))
}
