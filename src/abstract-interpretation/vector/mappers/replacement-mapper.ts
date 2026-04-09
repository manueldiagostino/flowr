import type { DataflowGraph } from '../../../dataflow/graph/graph';
import type { ReadOnlyFlowrAnalyzerContext } from '../../../project/context/flowr-analyzer-context';
import type { RNode } from '../../../r-bridge/lang-4.x/ast/model/model';
import type { ParentInformation } from '../../../r-bridge/lang-4.x/ast/model/processing/decorate';
import { RAccess } from '../../../r-bridge/lang-4.x/ast/model/nodes/r-access';
import { RArgument } from '../../../r-bridge/lang-4.x/ast/model/nodes/r-argument';
import { RBinaryOp } from '../../../r-bridge/lang-4.x/ast/model/nodes/r-binary-op';
import { RUnaryOp } from '../../../r-bridge/lang-4.x/ast/model/nodes/r-unary-op';
import { RLogical } from '../../../r-bridge/lang-4.x/ast/model/nodes/r-logical';
import { RNumber } from '../../../r-bridge/lang-4.x/ast/model/nodes/r-number';
import { EmptyArgument } from '../../../r-bridge/lang-4.x/ast/model/nodes/r-function-call';
import type { VectorOperations, VectorOperationName } from '../vector-semantics';
import type { VectorInferenceVisitor } from '../vector-inference';
import type { AnyAbstractDomain } from '../../domains/abstract-domain';

/** Type of vector selector: positive (c is non-negative), negative (c is negative), or logical (boolean vector) */
type SelectorType = 'positive' | 'negative' | 'logical';

/**
 * Detects the selector type by analyzing the AST of the selector expression.
 * @param selectorNode - The selector argument node from the AST
 * @returns The selector type: 'positive' (non-negative indices), 'negative' (negative indices), or 'logical' (boolean)
 */
function detectSelectorType<Info>(selectorNode: RNode<Info> | typeof EmptyArgument | undefined): SelectorType {
	if(selectorNode === undefined || selectorNode === EmptyArgument) {
		return 'positive';
	}

	// Get the actual value from the argument wrapper
	const node = RArgument.is(selectorNode) ? selectorNode.value : selectorNode;
	if(node === undefined) {
		return 'positive';
	}

	return detectSelectorTypeFromNode(node);
}

/**
 * Recursively analyzes a node to determine the selector type.
 * Checks for logical literals, comparisons, negative numbers, and unary minus.
 * @param node - The AST node to analyze
 * @returns The selector type based on the node's structure
 */
function detectSelectorTypeFromNode<Info>(node: RNode<Info>): SelectorType {
	// Logical literals or comparisons indicate logical selector
	if(RLogical.is(node)) {
		return 'logical';
	}

	// Check for comparison operators (indicates logical selector like x[x > 0])
	if(RBinaryOp.is(node)) {
		// Comparison operators create logical vectors
		if(['>', '<', '>=', '<=', '==', '!='].includes(node.operator)) {
			return 'logical';
		}
		// Check for negative numeric literals: -1, -c(1,2), etc.
		if(node.operator === '-') {
			return 'negative';
		}
		// For other operators (like ':'), check operands
		if(node.operator === ':' || node.operator === 'c') {
			const lhsType = detectSelectorTypeFromNode(node.lhs);
			const rhsType = detectSelectorTypeFromNode(node.rhs);
			// If any operand is negative or logical, propagate that
			if(lhsType === 'logical' || rhsType === 'logical') {
				return 'logical';
			}
			if(lhsType === 'negative' || rhsType === 'negative') {
				return 'negative';
			}
			return 'positive';
		}
		// For other binary ops, check both sides
		const lhsType = detectSelectorTypeFromNode(node.lhs);
		const rhsType = detectSelectorTypeFromNode(node.rhs);
		if(lhsType === 'logical' || rhsType === 'logical') {
			return 'logical';
		}
		if(lhsType === 'negative' || rhsType === 'negative') {
			return 'negative';
		}
		return 'positive';
	}

	// Check for unary minus (negative numbers like -1, -c(1,2))
	if(RUnaryOp.is(node) && node.operator === '-') {
		return 'negative';
	}

	// Check for negative number literals directly
	if(RNumber.is(node) && typeof node.content.num === 'number' && node.content.num < 0) {
		return 'negative';
	}

	// Default: assume positive indexing
	return 'positive';
}

/**
 * Maps a selector type to the corresponding abstract vector update operation name.
 * @param selectorType - The detected selector type
 * @returns The corresponding update operation name
 */
function selectorTypeToUpdateOperation(selectorType: SelectorType): Extract<VectorOperationName, 'updatePositive' | 'updateNegative' | 'updateLogical'> {
	switch(selectorType) {
		case 'negative':
			return 'updateNegative';
		case 'logical':
			return 'updateLogical';
		case 'positive':
		default:
			return 'updatePositive';
	}
}

/**
 * Maps an R vector replacement node to abstract update operations.
 * Detects whether the selector is positive, negative, or logical indexing.
 * @param node - The R access node representing the target vector
 * @param source - The R node representing the value being assigned
 * @param _inference - The vector inference visitor (unused)
 * @param _dfg - The data flow graph (unused)
 * @param _ctx - The analyzer context (unused)
 * @returns The mapped vector operations sequence for update, or undefined if not an access node
 */
export function mapVectorReplacement<Domain extends AnyAbstractDomain>(
	node: RNode<ParentInformation>,
	source: RNode<ParentInformation> | undefined,
	_inference: VectorInferenceVisitor<Domain>,
	_dfg: DataflowGraph,
	_ctx: ReadOnlyFlowrAnalyzerContext
): VectorOperations {
	if(!RAccess.is(node)) {
		return undefined;
	}

	const access = node;
	const args = access.access;

	if(args.length === 1) {
		const accessedNode = access.accessed;
		const operand = accessedNode?.info.id;
		const selectorArg = args[0];
		const selector = selectorArg !== '<>' ? selectorArg?.info.id : undefined;
		const values = source?.info.id;

		// Detect selector type from AST
		const selectorType = detectSelectorType(selectorArg);
		const operation = selectorTypeToUpdateOperation(selectorType);

		return [{
			operation,
			operand: operand !== undefined ? String(operand) : undefined,
			selector: selector !== undefined ? String(selector) : undefined,
			values: values !== undefined ? String(values) : undefined
		}];
	}

	return [{ operation: 'unknown', operand: undefined }];
}
