import type { NodeId } from '../../../r-bridge/lang-4.x/ast/model/processing/node-id';
import type { ControlFlowGraph } from '../../../util/cfg/cfg';
import type { DataflowGraph } from '../../../dataflow/graph/graph';
import { visitInReverseOrder } from '../../../util/cfg/visitor';
import { VertexType } from '../../../dataflow/graph/vertex';
import { edgeIncludesType, EdgeType } from '../../../dataflow/graph/edge';
import { resolveByName } from '../../../dataflow/environments/resolve-by-name';
import { ReferenceType } from '../../../dataflow/environments/identifier';
import { BuiltIn } from '../../../dataflow/environments/built-in';
import { assertUnreachable } from '../../../util/assert';

export enum CallTargets {
    /** call targets a function that is not defined locally (e.g., the call targets a library function) */
    OnlyGlobal = 'global',
    /** call targets a function that is defined locally or globally, but must include a global function */
    MustIncludeGlobal = 'must-include-global',
    /** call targets a function that is defined locally  */
    OnlyLocal = 'local',
    /** call targets a function that is defined locally or globally, but must include a local function */
    MustIncludeLocal = 'must-include-local',
    /** call targets a function that is defined locally or globally */
    Any = 'any'
}

export function satisfiesCallTargets(id: NodeId, graph: DataflowGraph, callTarget: CallTargets): NodeId[] | 'no' {
	const callVertex = graph.get(id);
	if(callVertex === undefined || callVertex[0].tag !== VertexType.FunctionCall) {
		return 'no';
	}
	const [info, outgoing] = callVertex;
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
		const reResolved = resolveByName(info.name, info.environment, ReferenceType.Unknown);
		if(reResolved?.some(t => t.definedAt === BuiltIn)) {
			builtIn = true;
		}
	}

	switch(callTarget) {
		case CallTargets.Any:
			return callTargets;
		case CallTargets.OnlyGlobal:
			if(callTargets.length === 0) {
				return builtIn ? [BuiltIn] : [];
			} else {
				return 'no';
			}
		case CallTargets.MustIncludeGlobal:
			return builtIn || callTargets.length === 0 ? [...callTargets, BuiltIn] : 'no';
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

export function identifyLinkToLastCallRelation(from: NodeId, cfg: ControlFlowGraph, graph: DataflowGraph, linkTo: RegExp): NodeId[] {
	const found: NodeId[] = [];
	visitInReverseOrder(cfg, from, node => {
		/* we ignore the start id as it cannot be the last call */
		if(node === from) {
			return;
		}
		const vertex = graph.get(node);
		if(vertex === undefined || vertex[0].tag !== VertexType.FunctionCall) {
			return;
		}
		if(linkTo.test(vertex[0].name)) {
			const tar = satisfiesCallTargets(vertex[0].id, graph, CallTargets.MustIncludeGlobal);
			if(tar === 'no') {
				return true;
			}
			found.push(node);
			return true;
		}
	});
	return found;
}