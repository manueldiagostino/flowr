import type { DataflowGraph } from '../../../dataflow/graph/graph';
import { FunctionArgument as FunctionArgumentUtil } from '../../../dataflow/graph/graph';
import { EmptyArgument } from '../../../r-bridge/lang-4.x/ast/model/nodes/r-function-call';
import { VertexType } from '../../../dataflow/graph/vertex';
import type { ReadOnlyFlowrAnalyzerContext } from '../../../project/context/flowr-analyzer-context';
import type { RNode } from '../../../r-bridge/lang-4.x/ast/model/model';
import type { ParentInformation } from '../../../r-bridge/lang-4.x/ast/model/processing/decorate';
import { RType } from '../../../r-bridge/lang-4.x/ast/model/type';
import type { VectorOperations, VectorOperationName } from '../vector-semantics';
import { Identifier } from '../../../dataflow/environments/identifier';
import type { VectorInferenceVisitor } from '../vector-inference';
import type { AnyAbstractDomain } from '../../domains/abstract-domain';

/**
 * Mapper for mapping supported R functions to vector operations.
 */
const VectorFunctionMapper = {
	'c': { mapper: mapCombine, operation: 'concatenate' },
	'+': { mapper: mapArithmetic, operation: 'recycle' },
	'-': { mapper: mapArithmetic, operation: 'recycle' },
	'*': { mapper: mapArithmetic, operation: 'recycle' },
	'/': { mapper: mapArithmetic, operation: 'recycle' },
	'length': { mapper: mapLength, operation: 'unknown' }
} as const;

/**
 * All R functions currently supported by the vector abstract domain.
 * Maps function names to their mapper and resulting operation type.
 */
type VectorFunction = keyof typeof VectorFunctionMapper;

/**
 * Maps a concrete R function call to vector operations.
 * @param node      - The R node of the function call
 * @param inference - The vector inference visitor
 * @param dfg       - The data flow graph
 * @param ctx       - The current flowR analyzer context
 * @returns The mapped vector operations sequence, or `undefined` if not a supported vector function
 */
export function mapVectorFunction<Domain extends AnyAbstractDomain>(
	node: RNode<ParentInformation>,
	inference: VectorInferenceVisitor<Domain>,
	dfg: DataflowGraph,
	ctx: ReadOnlyFlowrAnalyzerContext
): VectorOperations {
	if(node.type !== RType.FunctionCall && node.type !== RType.BinaryOp) {
		return undefined;
	}

	let functionName: string | undefined;
	if(node.type === RType.FunctionCall) {
		if(node.named) {
			functionName = Identifier.getName(node.functionName.content);
		}
	} else {
		functionName = node.operator;
	}

	if(functionName === undefined || !isVectorFunction(functionName)) {
		return undefined;
	}

	const mapper = VectorFunctionMapper[functionName];
	return mapper.mapper(node, inference, dfg, ctx, mapper.operation);
}

/**
 * Checks if a function name is a supported vector function.
 * @param name - The function name to check
 * @returns True if the function is a supported vector function
 */
function isVectorFunction(name: string): name is VectorFunction {
	return Object.hasOwn(VectorFunctionMapper, name);
}

/**
 * Maps the combine function c(...) to vector operations.
 * Returns a sequence of recycle operations that will align all arguments.
 * For c(a, b, c, ...), this creates:
 *   - First operation: recycle(a, b) -> result1
 *   - Second operation: recycle(result1, c) -> result2
 *   - etc.
 * @param node - The R node of the function call
 * @param inference - The vector inference visitor
 * @param dfg - The data flow graph
 * @param _ctx - The analyzer context (unused)
 * @param operation - The operation name to use (typically 'recycle')
 * @returns The mapped vector operations sequence
 */
function mapCombine<Domain extends AnyAbstractDomain>(
	node: RNode<ParentInformation>,
	inference: VectorInferenceVisitor<Domain>,
	dfg: DataflowGraph,
	_ctx: ReadOnlyFlowrAnalyzerContext,
	operation: VectorOperationName
): VectorOperations {
	const vertexInfo = dfg.get(node.info.id);
	if(vertexInfo === undefined) {
		return [{ operation: 'unknown', operand: undefined }];
	}
	const [callVertex] = vertexInfo;
	if(callVertex?.tag !== VertexType.FunctionCall) {
		return [{ operation: 'unknown', operand: undefined }];
	}

	const args: (string | undefined)[] = [];
	for(const arg of callVertex.args) {
		if(arg !== undefined && arg !== EmptyArgument) {
			const argId = FunctionArgumentUtil.getId(arg);
			if(argId !== undefined) {
				const argNode = inference.getNode(argId);
				if(argNode?.type === RType.Argument && argNode.value !== undefined) {
					args.push(String(argNode.value.info.id));
				} else {
					args.push(String(argId));
				}
			}
		}
	}

	if(args.length === 0) {
		return [{ operation: 'unknown', operand: undefined }];
	}

	if(args.length === 1) {
		return [{ operation, operand: args[0] }];
	}

	const operations: VectorOperations = [];

	operations.push({
		operation,
		operand: args[0],
		other: args[1]
	});

	for(let i = 2; i < args.length; i++) {
		operations.push({
			operation,
			operand: undefined,
			other: args[i]
		});
	}

	return operations;
}

/**
 * Maps arithmetic operations (+, -, *, /) to vector recycle operations.
 * @param node - The R node of the binary operation
 * @param _inference - The vector inference visitor (unused)
 * @param dfg - The data flow graph
 * @param _ctx - The analyzer context (unused)
 * @param operation - The operation name (recycle)
 * @returns The mapped vector operations sequence
 */
function mapArithmetic<Domain extends AnyAbstractDomain>(
	node: RNode<ParentInformation>,
	_inference: VectorInferenceVisitor<Domain>,
	dfg: DataflowGraph,
	_ctx: ReadOnlyFlowrAnalyzerContext,
	operation: VectorOperationName
): VectorOperations {
	const vertexInfo = dfg.get(node.info.id);
	if(vertexInfo === undefined) {
		return [{ operation: 'unknown', operand: undefined }];
	}
	const [callVertex] = vertexInfo;
	if(callVertex?.tag !== VertexType.FunctionCall) {
		return [{ operation: 'unknown', operand: undefined }];
	}

	const lhsId = callVertex.args[0] !== undefined && callVertex.args[0] !== EmptyArgument
		? FunctionArgumentUtil.getId(callVertex.args[0])
		: undefined;
	const rhsId = callVertex.args[1] !== undefined && callVertex.args[1] !== EmptyArgument
		? FunctionArgumentUtil.getId(callVertex.args[1])
		: undefined;

	if(lhsId === undefined) {
		return [{ operation: 'unknown', operand: undefined }];
	}

	return [{
		operation,
		operand: String(lhsId),
		other: rhsId !== undefined ? String(rhsId) : undefined
	}];
}

/**
 * Maps the length() function to an unknown operation.
 * The actual length cannot be determined statically without more analysis.
 * @returns An unknown operation since we cannot determine length statically
 */
function mapLength(): VectorOperations {
	return [{ operation: 'unknown', operand: undefined }];
}


