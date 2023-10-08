import { graph2quads, QuadSerializationConfiguration } from '../../util/quads'
import { DataflowGraph } from './graph'

/**
 * @see cfg2quads
 * @see serialize2quads
 * @see graph2quads
 */
export function df2quads(graph: DataflowGraph, config: QuadSerializationConfiguration): string {
	return graph2quads({
		rootIds:  [...graph.rootIds()],
		vertices: [...graph.vertices(true)]
			.map(([id, v]) => ({
				...v,
				id
			})),
		edges: [...graph.edges()].flatMap(([fromId, targets]) =>
			[...targets].map(([toId, info]) => ({
				from: fromId,
				to:   toId,
				type: [...info.types],
				when: info.attribute
			}))
		)
	},
	config
	)
}
