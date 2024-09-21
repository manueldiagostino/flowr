import type { DataflowGraph } from '../../dataflow/graph/graph';
import type {
	CallContextQuery,
	CallContextQueryKindResult,
	CallContextQueryResult, SubCallContextQueryFormat
} from './call-context-query-format';
import { CallTargets
} from './call-context-query-format';
import type { NodeId } from '../../r-bridge/lang-4.x/ast/model/processing/node-id';
import { VertexType } from '../../dataflow/graph/vertex';
import { assertUnreachable } from '../../util/assert';
import { edgeIncludesType, EdgeType } from '../../dataflow/graph/edge';
import type { DeepWritable } from 'ts-essentials';
import { resolveByName } from '../../dataflow/environments/resolve-by-name';
import { BuiltIn } from '../../dataflow/environments/built-in';

class TwoLayerCollector<Layer1 extends string, Layer2 extends string, Values> {
	readonly store = new Map<Layer1, Map<Layer2, Values[]>>();

	public add(layer1: Layer1, layer2: Layer2, value: Values) {
		let layer2Map = this.store.get(layer1);
		if(layer2Map === undefined) {
			layer2Map = new Map<Layer2, Values[]>();
			this.store.set(layer1, layer2Map);
		}
		let values = layer2Map.get(layer2);
		if(values === undefined) {
			values = [];
			layer2Map.set(layer2, values);
		}
		values.push(value);
	}

	public get(layer1: Layer1, layer2: Layer2): Values[] | undefined {
		return this.store.get(layer1)?.get(layer2);
	}

	public outerKeys(): Iterable<Layer1> {
		return this.store.keys();
	}

	public innerKeys(layer1: Layer1): Iterable<Layer2> {
		return this.store.get(layer1)?.keys() ?? [];
	}

	public asciiSummary() {
		let result = '';
		for(const [layer1, layer2Map] of this.store) {
			result += `${JSON.stringify(layer1)}\n`;
			for(const [layer2, values] of layer2Map) {
				result += ` ╰ ${JSON.stringify(layer2)}: ${JSON.stringify(values)}\n`;
			}
		}
		return result;
	}
}

function satisfiesCallTargets(id: NodeId, graph: DataflowGraph, callTarget: CallTargets): NodeId[] | 'no'  {
	const callVertex = graph.get(id);
	if(callVertex === undefined || callVertex[0].tag !== VertexType.FunctionCall) {
		return 'no';
	}
	const [info,outgoing] = callVertex;
	const callTargets = [...outgoing]
		.filter(([, e]) => edgeIncludesType(e.types, EdgeType.Calls))
		.map(([t]) => t)
	;

	let builtIn = false;

	if(info.environment === undefined) {
		/* if we have a call with an unbound environment,
		 * this only happens if we are sure of built-in relations and want to save references
		 */
		builtIn = true;
	} else {
		/*
		 * for performance and scoping reasons, flowR will not identify the global linkage,
		 * including any potential built-in mapping.
		 */
		const reResolved = resolveByName(info.name, info.environment);
		if(reResolved && reResolved.some(t => t.definedAt === BuiltIn)) {
			builtIn = true;
		}
	}

	switch(callTarget) {
		case CallTargets.Any:
			return callTargets;
		case CallTargets.OnlyGlobal:
			return builtIn && callTargets.length === 0 ? [BuiltIn] : 'no';
		case CallTargets.MustIncludeGlobal:
			return builtIn ? [...callTargets, BuiltIn] : 'no';
		case CallTargets.OnlyLocal:
			return !builtIn && callTargets.length > 0 ? callTargets : 'no';
		case CallTargets.MustIncludeLocal:
			if(callTargets.length > 0) {
				return builtIn ? [...callTargets, BuiltIn] : callTargets;
			} else {
				return 'no';
			}
		default:
			assertUnreachable(callTarget);
	}
}

/* if the node is effected by nse, we have an ingoing nse edge */
function isQuoted(node: NodeId, graph: DataflowGraph): boolean {
	const vertex = graph.ingoingEdges(node);
	if(vertex === undefined) {
		return false;
	}
	return [...vertex.values()].some(({ types }) => edgeIncludesType(types, EdgeType.NonStandardEvaluation));
}

function makeReport(collector: TwoLayerCollector<string, string, [NodeId, NodeId[]] | [NodeId]>): CallContextQueryKindResult {
	const result: CallContextQueryKindResult = {} as unknown as CallContextQueryKindResult;
	for(const [kind, collected] of collector.store) {
		const subkinds = {} as DeepWritable<CallContextQueryKindResult[string]['subkinds']>;
		for(const [subkind, values] of collected) {
			subkinds[subkind] ??= [];
			const collectIn = subkinds[subkind];
			for(const value of values) {
				const [id, calls] = value;
				if(calls) {
					collectIn.push({ id, calls });
				} else {
					/* do not even provide the key! */
					collectIn.push({ id });
				}
			}
		}
		result[kind] = {
			subkinds
		};
	}
	return result;
}

function isSubCallQuery(query: CallContextQuery): query is SubCallContextQueryFormat {
	return 'linkTo' in query;
}

function promoteQueryCallNames(queries: readonly CallContextQuery[]) {
	return queries.map(q => {
		if(isSubCallQuery(q)) {
			return {
				...q,
				callName: new RegExp(q.callName),
				linkTo:   {
					...q.linkTo,
					/* we have to add another promotion layer whenever we add something without this call name */
					callName: new RegExp(q.linkTo.callName)
				}
			};
		} else {
			return {
				...q,
				callName: new RegExp(q.callName)
			};
		}
	});
}

/**
 * Multi-stage call context query resolve.
 *
 * 1. Resolve all calls in the DF graph that match the respective {@link DefaultCallContextQueryFormat#callName} regex.
 * 2. Identify their respective call targets, if {@link DefaultCallContextQueryFormat#callTargets} is set to be non-any.
 *    This happens during the main resolution!
 * 3. Attach `linkTo` calls to the respective calls.
 */
export function executeCallContextQueries(graph: DataflowGraph, queries: readonly CallContextQuery[]): CallContextQueryResult {
	/* omit performance page load */
	const now = Date.now();
	/* the node id and call targets if present */
	const initialIdCollector = new TwoLayerCollector<string, string, [NodeId, NodeId[]] | [NodeId]>();

	/* promote all strings to regex patterns */
	const promotedQueries = promoteQueryCallNames(queries);

	for(const [node, info] of graph.vertices(true)) {
		if(info.tag !== VertexType.FunctionCall) {
			continue;
		}
		for(const query of promotedQueries.filter(q => q.callName.test(info.name))) {
			let targets: NodeId[] | 'no' | undefined = undefined;
			if(query.callTargets) {
				targets = satisfiesCallTargets(node, graph, query.callTargets);
				if(targets === 'no') {
					continue;
				}
			}
			if(isQuoted(node, graph)) {
				/* if the call is quoted, we do not want to link to it */
				continue;
			}
			if(targets) {
				initialIdCollector.add(query.kind, query.subkind, [node, targets]);
			} else {
				initialIdCollector.add(query.kind, query.subkind, [node]);
			}
		}
	}

	/* TODO: link to */
	console.log(initialIdCollector.asciiSummary());

	return {
		'.meta': {
			timing: Date.now() - now
		},
		kinds: makeReport(initialIdCollector)
	};
}

