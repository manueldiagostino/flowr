import type { DataflowGraphVertexFunctionCall, DataflowGraphVertexValue } from '../../dataflow/graph/vertex';
import type { RNode } from '../../r-bridge/lang-4.x/ast/model/model';
import type { ParentInformation } from '../../r-bridge/lang-4.x/ast/model/processing/decorate';
import type { NodeId } from '../../r-bridge/lang-4.x/ast/model/processing/node-id';
import { AbstractInterpretationVisitor, type AbsintVisitorConfiguration } from '../absint-visitor';
import type { AnyAbstractDomain } from '../domains/abstract-domain';
import { VectorDomain, type DomainFactory } from './vector-domain';
import { NAAwareDomain } from './na-aware-domain';
import { vectorLogger } from './logger';
import {
	card,
	isEnumerable,
	squash,
	adjustForZeros,
	initKnownPositions,
	updateKnownPositions,
	generateCyclicKnownPositions,
	accessPosition
} from './vector-semantics';
import { NA, Top, Bottom } from '../domains/lattice';
import type { IntervalDomain } from '../domains/interval-domain';
import { PosIntervalDomain } from '../domains/positive-interval-domain';
import type { VectorAttrDomain } from '../domains/vector-attr-domain';
import { type ValueToDomainConverter, buildVectorFromLiteral } from './resolve-vector-args';
import type { RNumber } from '../../r-bridge/lang-4.x/ast/model/nodes/r-number';
import type { RString } from '../../r-bridge/lang-4.x/ast/model/nodes/r-string';
import type { RLogical } from '../../r-bridge/lang-4.x/ast/model/nodes/r-logical';
import { RSymbol } from '../../r-bridge/lang-4.x/ast/model/nodes/r-symbol';
import { FunctionArgument as FunctionArgumentUtil } from '../../dataflow/graph/graph';
import { EmptyArgument, RFunctionCall } from '../../r-bridge/lang-4.x/ast/model/nodes/r-function-call';
import { VertexType } from '../../dataflow/graph/vertex';
import { RType } from '../../r-bridge/lang-4.x/ast/model/type';
import { Identifier } from '../../dataflow/environments/identifier';
import { RAccess } from '../../r-bridge/lang-4.x/ast/model/nodes/r-access';
import { RArgument } from '../../r-bridge/lang-4.x/ast/model/nodes/r-argument';
import { RBinaryOp } from '../../r-bridge/lang-4.x/ast/model/nodes/r-binary-op';
import { RUnaryOp } from '../../r-bridge/lang-4.x/ast/model/nodes/r-unary-op';
import { RNumber as RNumberNode } from '../../r-bridge/lang-4.x/ast/model/nodes/r-number';
import { RLogical as RLogicalNode } from '../../r-bridge/lang-4.x/ast/model/nodes/r-logical';

type VectorFunctionType = 'concatenate' | 'arithmetic' | 'length' | 'unknown';

type SelectorKind = 'logical' | 'numeric';

type VectorOperationName = 'setAttr' | 'recycle' | 'concatenate' | 'select' | 'update' | 'unknown';

interface VectorOperation<Name extends VectorOperationName = VectorOperationName> {
	operation:     Name;
	operand:       VectorDomain<AnyAbstractDomain> | undefined;
	[key: string]: unknown;
}

type VectorOperations = VectorOperation[] | undefined;

/**
 * Configuration options for the VectorInferenceVisitor.
 * Extends AbsintVisitorConfiguration with vector-specific options.
 */
interface VectorInferenceConfiguration extends AbsintVisitorConfiguration {
	/** Whether to track the mapped abstract operations for each node (default: true) */
	readonly trackOperations?: boolean;
}

/**
 * Abstract interpretation visitor for R vectors.
 * Maps R vector operations to abstract vector semantics and computes abstract values.
 * @template Domain - The abstract domain type for vector elements
 */
export class VectorInferenceVisitor<Domain extends AnyAbstractDomain> extends AbstractInterpretationVisitor<VectorDomain<Domain>, VectorInferenceConfiguration> {
	private readonly operations?:    Map<NodeId, VectorOperations>;
	private readonly factory:        import('./vector-domain').DomainFactory<Domain>;
	private readonly valueConverter: ValueToDomainConverter<Domain>;

	constructor(
		factory: import('./vector-domain').DomainFactory<Domain>,
		valueConverter: ValueToDomainConverter<Domain>,
		{ trackOperations = true, ...config }: VectorInferenceConfiguration
	) {
		super(config, VectorDomain.top(factory));
		this.factory = factory;
		this.valueConverter = valueConverter;

		if(trackOperations) {
			this.operations = new Map();
		}
	}

	/**
	 * Gets the normalized AST node for a given node ID.
	 * @param id - The ID of the node to get
	 * @returns The normalized AST node, or undefined if not found
	 */
	public getNode(id: NodeId | undefined): RNode<ParentInformation> | undefined {
		return this.getNormalizedAst(id);
	}

	/**
	 * Gets the mapped abstract vector operations for an AST node.
	 * This requires that the abstract interpretation visitor has been completed, or at least started.
	 * @param id - The ID of the node to get the mapped abstract operations for
	 * @returns The mapped abstract vector operations for the node, or `undefined` if no abstract operation was mapped for the node or storing mapped abstract operations is disabled via the visitor config.
	 */
	public getAbstractOperations(id: NodeId | undefined): Readonly<VectorOperations> {
		return id !== undefined ? this.operations?.get(id) : undefined;
	}

	/**
	 * Gets the VectorDomain value for a given node ID from the current state.
	 * This is used by mappers to resolve operands to VectorDomain values directly.
	 * Handles symbol resolution by following variable origins.
	 * @param id - The node ID to look up
	 * @returns The VectorDomain value, or undefined if not found
	 */
	public getVectorDomainValue(id: NodeId | undefined): VectorDomain<Domain> | undefined {
		if(id === undefined) {
			return undefined;
		}
		// Check if state has direct entry for this node
		const hasDirect = this.currentState.has(id);
		if(hasDirect) {
			const directValue = this.currentState.get(id);
			return directValue;
		}
		// For symbols, follow variable origins to find the actual value
		const origins = this.getVariableOrigins(id);
		for(const origin of origins) {
			const hasOrigin = this.currentState.has(origin);
			if(hasOrigin) {
				const originValue = this.currentState.get(origin);
				return originValue;
			}
		}
		return undefined;
	}

	// ==================== Function Type Detection ====================

	/**
	 * Detects the type of vector function from an AST node.
	 * @param node - The AST node to analyze
	 * @returns The detected function type
	 */
	private detectFunctionType(node: RNode<ParentInformation>): VectorFunctionType {
		if(node.type !== RType.FunctionCall && node.type !== RType.BinaryOp && node.type !== RType.UnaryOp) {
			vectorLogger.debug(`Decision: function type 'unknown' for node type '${node.type}'`);
			return 'unknown';
		}

		let functionName: string | undefined;
		if(node.type === RType.FunctionCall) {
			if(node.named) {
				functionName = Identifier.getName(node.functionName.content);
			}
		} else {
			functionName = node.operator;
		}

		if(functionName === undefined) {
			vectorLogger.debug(`Decision: function type 'unknown' for node type '${node.type}' (no function name)`);
			return 'unknown';
		}

		if(functionName === 'c') {
			vectorLogger.debug(`Decision: function type 'concatenate' for node type '${node.type}'`);
			return 'concatenate';
		}
		if(['+', '-', '*', '/'].includes(functionName)) {
			vectorLogger.debug(`Decision: function type 'arithmetic' for node type '${node.type}'`);
			return 'arithmetic';
		}
		if(functionName === 'length') {
			vectorLogger.debug(`Decision: function type 'length' for node type '${node.type}'`);
			return 'length';
		}

		vectorLogger.debug(`Decision: function type 'unknown' for node type '${node.type}' (functionName='${functionName}')`);
		return 'unknown';
	}

	// ==================== Selector Type Detection ====================

	/**
	 * Detects whether a selector is logical or numeric from AST.
	 * Logical selectors come from: logical literals, comparisons, logical operators.
	 * Everything else is treated as numeric (including arithmetic expressions).
	 * @param selectorNode - The selector argument node from the AST
	 * @returns The selector kind: 'logical' or 'numeric'
	 */
	private detectSelectorKind(selectorNode: RNode<ParentInformation> | typeof EmptyArgument | undefined): SelectorKind {
		if(selectorNode === undefined || selectorNode === EmptyArgument) {
			vectorLogger.debug(`Decision: selector kind 'numeric' for node type '${selectorNode?.type ?? 'undefined'}' (empty/undefined)`);
			return 'numeric';
		}

		// Get the actual value from the argument wrapper
		const node = RArgument.is(selectorNode) ? selectorNode.value : selectorNode;
		if(node === undefined) {
			vectorLogger.debug(`Decision: selector kind 'numeric' for node type '${selectorNode?.type ?? 'undefined'}' (undefined value)`);
			return 'numeric';
		}

		const kind = this.detectSelectorKindFromNode(node);
		vectorLogger.debug(`Decision: selector kind '${kind}' for node type '${node.type}'`);
		return kind;
	}

	/**
	 * Recursively analyzes a node to determine if it produces logical or numeric output.
	 * For vectors (e.g., `c(TRUE, 1, 2, FALSE)`), if ANY element is numeric, the selector
	 * is numeric (R coerces all to numeric). Only if ALL elements are logical is it logical.
	 * @param node - The AST node to analyze
	 * @returns The selector kind: 'logical' or 'numeric'
	 */
	private detectSelectorKindFromNode<Info>(node: RNode<Info>): SelectorKind {
		// Logical literals indicate logical selector
		if(RLogicalNode.is(node)) {
			return 'logical';
		}

		// Check for comparison or logical operators (indicates logical selector)
		if(RBinaryOp.is(node)) {
			// Comparison operators create logical vectors
			if(['>', '<', '>=', '<=', '==', '!='].includes(node.operator)) {
				return 'logical';
			}
			// Logical operators create logical vectors
			if(['&', '|', '&&', '||'].includes(node.operator)) {
				return 'logical';
			}
			// All other binary operators (+, -, *, /, etc.) are numeric
			return 'numeric';
		}

		// Check for unary NOT (logical operator)
		if(RUnaryOp.is(node) && node.operator === '!') {
			return 'logical';
		}

		// All unary operators (+, -) are numeric
		if(RUnaryOp.is(node)) {
			return 'numeric';
		}

		// Numeric literals are numeric selectors
		if(RNumberNode.is(node)) {
			return 'numeric';
		}

		// For function calls (e.g., `c(TRUE, 1, 2, FALSE)`), check all arguments recursively
		// If ANY argument is numeric, the whole vector is numeric (R coercion rules)
		if(RFunctionCall.is(node)) {
			// For concatenation functions like c(), check all arguments
			// For other functions, conservatively assume numeric
			const functionName = RFunctionCall.isNamed(node) ? node.functionName.content : '';
			if(functionName === 'c') {
				let hasLogical = false;
				for(const arg of node.arguments) {
					if(arg !== undefined && arg !== EmptyArgument) {
						const argNode = RArgument.is(arg) ? arg.value : arg;
						if(argNode !== undefined) {
							const kind = this.detectSelectorKindFromNode(argNode);
							if(kind === 'numeric') {
								return 'numeric';
							}
							hasLogical = true;
						}
					}
				}
				// All arguments were logical (or empty)
				return hasLogical ? 'logical' : 'numeric';
			}
			// For other function calls, conservatively assume numeric
			return 'numeric';
		}

		// For symbols, try to get the vector type from abstract interpretation state
		if(RSymbol.is(node)) {
			const nodeId = (node.info as ParentInformation).id;
			const vectorValue = this.getVectorDomainValue(nodeId);
			if(vectorValue !== undefined && !vectorValue.type.isTop()) {
				const type = vectorValue.type.getType();
				if(type === 'logical') {
					return 'logical';
				}
				// For numeric types (integer, double, complex, character), use numeric selection
				return 'numeric';
			}
		}

		// For symbols and other nodes, we can't determine from AST alone
		// Conservative assumption: numeric (will be evaluated to abstract value anyway)
		return 'numeric';
	}



	// ==================== Function Handlers ====================

	/**
	 * Resolves vector arguments from a function call.
	 * @param call - The function call vertex from the dataflow graph
	 * @returns Array of resolved argument info with id and VectorDomain value
	 */
	private resolveVectorArguments(call: DataflowGraphVertexFunctionCall): { id: NodeId; resolved: VectorDomain<Domain> | undefined }[] {
		const args: { id: NodeId; resolved: VectorDomain<Domain> | undefined }[] = [];
		for(const arg of call.args) {
			if(arg !== undefined && arg !== EmptyArgument) {
				const argId = FunctionArgumentUtil.getId(arg);
				if(argId !== undefined) {
					const argNode = this.getNode(argId);
					if(argNode?.type === RType.Argument && argNode.value !== undefined) {
						const resolved = this.getVectorDomainValue(argNode.value.info.id);
						args.push({ id: argNode.value.info.id, resolved });
					} else {
						const resolved = this.getVectorDomainValue(argId);
						args.push({ id: argId, resolved });
					}
				}
			}
		}
		return args;
	}

	/**
	 * Handles the c() function (concatenate).
	 * @param node - The R node of the function call
	 * @param call - The function call vertex from the dataflow graph
	 * @returns The mapped vector operations sequence
	 */
	private handleConcatenate(node: RNode<ParentInformation>, call: DataflowGraphVertexFunctionCall): VectorOperations {
		const args = this.resolveVectorArguments(call);

		if(args.length === 0) {
			return [{ operation: 'unknown', operand: undefined }];
		}

		if(args.length === 1) {
			return [{ operation: 'concatenate', operand: args[0].resolved }];
		}

		const operations: VectorOperations = [];

		operations.push({
			operation: 'concatenate',
			operand:   args[0].resolved,
			other:     args[1].resolved
		});

		for(let i = 2; i < args.length; i++) {
			operations.push({
				operation: 'concatenate',
				operand:   undefined,
				other:     args[i].resolved
			});
		}

		return operations;
	}

	/**
	 * Handles arithmetic operations (+, -, *, /).
	 * @param node - The R node of the binary operation
	 * @param call - The function call vertex from the dataflow graph
	 * @returns The mapped vector operations sequence
	 */
	private handleArithmetic(node: RNode<ParentInformation>, call: DataflowGraphVertexFunctionCall): VectorOperations {
		const lhsId = call.args[0] !== undefined && call.args[0] !== EmptyArgument
			? FunctionArgumentUtil.getId(call.args[0])
			: undefined;
		const rhsId = call.args[1] !== undefined && call.args[1] !== EmptyArgument
			? FunctionArgumentUtil.getId(call.args[1])
			: undefined;

		// Handle unary operations (e.g., -1) where there's only one argument
		if(node.type === RType.UnaryOp) {
			if(lhsId === undefined) {
				return [{ operation: 'unknown', operand: undefined }];
			}
			// For unary minus, we need to negate the value
			// Since PosIntervalDomain can't represent negative values, we return top
			// to indicate we can't precisely track the value
			const operandValue = this.getVectorDomainValue(lhsId);
			if(operandValue?.isValue() && node.operator === '-') {
				// The operand has a concrete value, try to negate it
				// Return top since we can't represent negative values in PosIntervalDomain
				return [{ operation: 'concatenate', operand: operandValue.top() }];
			}
			return [{ operation: 'unknown', operand: undefined }];
		}

		if(lhsId === undefined) {
			return [{ operation: 'unknown', operand: undefined }];
		}

		return [{
			operation: 'recycle',
			operand:   this.getVectorDomainValue(lhsId),
			other:     rhsId !== undefined ? this.getVectorDomainValue(rhsId) : undefined
		}];
	}

	/**
	 * Handles the length() function.
	 * @returns An unknown operation since we cannot determine length statically
	 */
	private handleLength(): VectorOperations {
		return [{ operation: 'unknown', operand: undefined }];
	}

	// ==================== Access and Replacement Handlers ====================

	/**
	 * Handles vector access operations (x[i]).
	 * @param node - The R access node representing the vector
	 * @returns The mapped vector operations sequence for selection
	 */
	private handleAccess(node: RNode<ParentInformation>): VectorOperations {
		if(!RAccess.is(node)) {
			return undefined;
		}

		const access = node;
		const args = access.access;

		// Single argument: x[i] - could be positive, negative, or logical
		if(args.length === 1) {
			const accessedNode = access.accessed;
			const operand = accessedNode?.info.id;
			const selectorArg = args[0];
			// Unwrap RArgument to get the inner value's node ID (not the wrapper's)
			const selectorNode = selectorArg !== '<>' && selectorArg !== undefined ? (RArgument.is(selectorArg) ? selectorArg.value : selectorArg) : undefined;
			const selector = selectorNode?.info.id;

			const selectorKind = this.detectSelectorKind(selectorArg);

			const resolvedOperand = operand !== undefined ? this.getVectorDomainValue(operand) : undefined;

			return [{
				operation: 'select',
				operand:   resolvedOperand,
				selector:  selector !== undefined ? String(selector) : undefined,
				selectorKind
			}];
		}

		// Two arguments: x[i, j] - matrix/array access (not supported yet)
		return [{ operation: 'unknown', operand: undefined }];
	}

	/**
	 * Handles vector replacement operations (x[i] \&lt;- v).
	 * @param node - The R access node representing the target vector
	 * @param source - The R node representing the value being assigned
	 * @returns The mapped vector operations sequence for update
	 */
	private handleReplacement(node: RNode<ParentInformation>, source: RNode<ParentInformation> | undefined): VectorOperations {
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

			// Detect selector kind from AST (logical vs numeric)
			const selectorKind = this.detectSelectorKind(selectorArg);

			const resolvedOperand = operand !== undefined ? this.getVectorDomainValue(operand) : undefined;

			return [{
				operation: 'update',
				operand:   resolvedOperand,
				selector:  selector !== undefined ? String(selector) : undefined,
				values:    values !== undefined ? String(values) : undefined,
				selectorKind
			}];
		}

		return [{ operation: 'unknown', operand: undefined }];
	}

	// ==================== Event Handlers ====================

	/**
	 * Handles function call nodes in the dataflow graph.
	 * Maps R function calls (c(), arithmetic, seq, rep, etc.) to vector operations.
	 * @param call - The function call vertex from the dataflow graph
	 */
	protected override onFunctionCall({ call }: { call: DataflowGraphVertexFunctionCall }): void {
		super.onFunctionCall({ call });
		vectorLogger.debug(`Handler: onFunctionCall [nodeId=${call.id}]`);

		const node = this.getNormalizedAst(call.id);

		if(node === undefined) {
			return;
		}

		const funcType = this.detectFunctionType(node);
		let operations: VectorOperations;

		switch(funcType) {
			case 'concatenate': {
				const vertexInfo = this.config.dfg.get(node.info.id);
				if(vertexInfo === undefined) {
					operations = [{ operation: 'unknown', operand: undefined }];
				} else {
					const [callVertex] = vertexInfo;
					if(callVertex?.tag !== VertexType.FunctionCall) {
						operations = [{ operation: 'unknown', operand: undefined }];
					} else {
						operations = this.handleConcatenate(node, callVertex);
					}
				}
				break;
			}
			case 'arithmetic': {
				const vertexInfo = this.config.dfg.get(node.info.id);
				if(vertexInfo === undefined) {
					operations = [{ operation: 'unknown', operand: undefined }];
				} else {
					const [callVertex] = vertexInfo;
					if(callVertex?.tag !== VertexType.FunctionCall) {
						operations = [{ operation: 'unknown', operand: undefined }];
					} else {
						operations = this.handleArithmetic(node, callVertex);
					}
				}
				break;
			}
			case 'length':
				operations = this.handleLength();
				break;
			case 'unknown':
			default:
				vectorLogger.warn(`Unknown function type '${funcType}' in onFunctionCall [nodeId=${call.id}]`);
				operations = undefined;
				break;
		}

		this.applyVectorExpression(node, operations);
	}

	/**
	 * Handles vector replacement operations in the dataflow graph.
	 * Maps assignment through indexing to abstract update semantics.
	 * @param call - The replacement call vertex from the dataflow graph
	 * @param target - The node ID of the target vector being modified
	 * @param source - The node ID of the value being assigned
	 */
	protected override onReplacementCall({ call, target, source }: { call: DataflowGraphVertexFunctionCall, target?: NodeId, source?: NodeId }): void {
		super.onReplacementCall({ call, target, source });
		vectorLogger.debug(`Handler: onReplacementCall [nodeId=${call.id}]`);

		const node = this.getNormalizedAst(target);
		const sourceNode = source ? this.getNormalizedAst(source) : undefined;

		if(node === undefined) {
			return;
		}
		const operations = this.handleReplacement(node, sourceNode);
		this.applyVectorExpression(node, operations);
	}

	/**
	 * Handles vector access operations (x[i]) in the dataflow graph.
	 * Maps indexing to abstract selection semantics.
	 * @param call - The access call vertex from the dataflow graph
	 */
	protected override onAccessCall({ call }: { call: DataflowGraphVertexFunctionCall }): void {
		super.onAccessCall({ call });
		vectorLogger.debug(`Handler: onAccessCall [nodeId=${call.id}]`);

		const node = this.getNormalizedAst(call.id);

		if(node === undefined) {
			return;
		}
		const operations = this.handleAccess(node);
		this.applyVectorExpression(node, operations);
	}

	/**
	 * Handles numeric constant nodes (e.g., 1, 2, 3).
	 * Creates a VectorDomain from the numeric literal and updates the state.
	 * @param _data - The vertex and node data for the numeric constant
	 */
	protected override onNumberConstant({ vertex, node }: { vertex: DataflowGraphVertexValue, node: RNumber<ParentInformation> }): void {
		super.onNumberConstant({ vertex, node });
		vectorLogger.debug(`Handler: onNumberConstant [nodeId=${vertex.id}]`);
		const vectorDomain = buildVectorFromLiteral(node, this.factory, this.valueConverter);
		if(vectorDomain !== undefined) {
			this.updateState(node.info.id, vectorDomain);
		}
	}

	/**
	 * Handles logical constant nodes (e.g., NA, TRUE, FALSE).
	 * Creates a VectorDomain from the logical literal and updates the state.
	 * @param _data - The vertex and node data for the logical constant
	 */
	protected override onLogicalConstant({ vertex, node }: { vertex: DataflowGraphVertexValue, node: RLogical<ParentInformation> }): void {
		super.onLogicalConstant({ vertex, node });
		vectorLogger.debug(`Handler: onLogicalConstant [nodeId=${vertex.id}]`);
		const vectorDomain = buildVectorFromLiteral(node, this.factory, this.valueConverter);
		if(vectorDomain !== undefined) {
			this.updateState(node.info.id, vectorDomain);
		}
	}

	/**
	 * Handles string constant nodes (e.g., "hello").
	 * Creates a VectorDomain from the string literal and updates the state.
	 * @param _data - The vertex and node data for the string constant
	 */
	protected override onStringConstant({ vertex, node }: { vertex: DataflowGraphVertexValue, node: RString<ParentInformation> }): void {
		super.onStringConstant({ vertex, node });
		vectorLogger.debug(`Handler: onStringConstant [nodeId=${vertex.id}]`);
		const vectorDomain = buildVectorFromLiteral(node, this.factory, this.valueConverter);
		if(vectorDomain !== undefined) {
			this.updateState(node.info.id, vectorDomain);
		}
	}

	/**
	 * Handles symbol constant nodes (e.g., NA, NULL, and variable names used as values).
	 * Creates a VectorDomain from the symbol, handling NA specially.
	 * @param _data - The vertex and node data for the symbol constant
	 */
	protected override onSymbolConstant({ vertex, node }: { vertex: DataflowGraphVertexValue, node: RSymbol<ParentInformation> }): void {
		super.onSymbolConstant({ vertex, node });
		vectorLogger.debug(`Handler: onSymbolConstant [nodeId=${vertex.id}]`);
		// Handle NA symbol - NA is parsed as RSymbol with content === 'NA'
		const vectorDomain = buildVectorFromLiteral(node, this.factory, this.valueConverter);
		if(vectorDomain !== undefined) {
			this.updateState(node.info.id, vectorDomain);
		}
	}

	/**
	 * Applies a sequence of vector operations to compute the resulting abstract value.
	 * Iterates through the operations in sequence, where the result of each operation
	 * becomes the operand for the next.
	 * @param node - The R node being processed
	 * @param operations - The sequence of operations to apply (undefined if no operations)
	 */
	private applyVectorExpression(node: RNode<ParentInformation>, operations: VectorOperations): void {
		vectorLogger.debug(`Operation: applyVectorExpression [nodeId=${node.info.id}, operations=${operations?.length ?? 0}]`);
		if(operations === undefined) {
			return;
		} else if(this.operations !== undefined) {
			this.operations.set(node.info.id, operations);
		}

		let value: VectorDomain<Domain> = VectorDomain.bottom(this.factory);

		// Create the NA value representation for this domain
		// NA is a special abstract value representing missing data
		// naValue is Domain (e.g., NAAwareDomain<IntervalDomain>), representing the NA element
		const naValue = this.factory(NA) as unknown as Domain;

		for(const { operation, operand, ...args } of operations) {
			// operand is now VectorDomain<Domain> | undefined
			// - If VectorDomain: use directly
			// - If undefined: use accumulated value (for chained operations)
			const effectiveOperand = operand ?? value;

			// Resolve string arguments (selector, values) to VectorDomain values
			const resolvedArgs = this.resolveOperationArgs(args);

			// Inject naValue for operations that need it
			const argsWithNaValue = this.injectNaValueIfNeeded(operation, resolvedArgs, naValue);

			value = this.applyOperation(
				operation,
				effectiveOperand as VectorDomain<Domain>,
				argsWithNaValue
			);

			const isOperandModification = operation === 'update' || operation === 'setAttr';

			// For chained operations (operand is undefined), we use the accumulated value
			// which is the result of the previous operation - no state update needed
			if(operand !== undefined && isOperandModification) {
				// operand is a VectorDomain - we need to find the original node ID to update
				// For now, update the current node (this is a simplification)
				this.updateState(node.info.id, value);
			} else {
				this.updateState(node.info.id, value);
			}
		}
	}

	/**
	 * Resolves operation arguments that are node IDs to their VectorDomain values.
	 * This is needed for operations like 'select' and 'update' that take selector and values arguments.
	 * @param args - The raw operation arguments (may contain node IDs as strings)
	 * @returns The resolved arguments with VectorDomain values
	 */
	/**
	 * Resolves operation arguments that are node IDs to their VectorDomain values.
	 * This is needed for operations like 'select' and 'update' that take selector and values arguments.
	 * @param args - The raw operation arguments (may contain node IDs as strings)
	 * @returns The resolved arguments with VectorDomain values
	 */
	private resolveOperationArgs(args: Record<string, unknown>): Record<string, unknown> {
		const resolved: Record<string, unknown> = { ...args };

		if('selector' in args && typeof args.selector === 'string') {
			const selectorId = Number(args.selector) as NodeId;
			const selectorValue = this.getVectorDomainValue(selectorId);
			resolved.selector = selectorValue ?? VectorDomain.bottom(this.factory);
		}

		if('values' in args && typeof args.values === 'string') {
			const valuesId = Number(args.values) as NodeId;
			const valuesValue = this.getVectorDomainValue(valuesId);
			resolved.values = valuesValue ?? VectorDomain.bottom(this.factory);
		}

		return resolved;
	}

	/**
	 * Injects the naValue into args for operations that require it.
	 * Operations like select, update need naValue for out-of-bounds access.
	 */
	private injectNaValueIfNeeded(
		operation: string,
		args: Record<string, unknown>,
		naValue: Domain
	): Record<string, unknown> {
		const operationsNeedingNaValue = new Set([
			'select',
			'update'
		]);

		if(operationsNeedingNaValue.has(operation) && !('naValue' in args)) {
			return { ...args, naValue };
		}

		return args;
	}

	/**
	 * Dispatches to the appropriate apply method based on the operation name.
	 * @param operation - The operation name to execute
	 * @param value - The current VectorDomain value
	 * @param args - Additional arguments for the operation
	 * @returns The resulting VectorDomain after applying the operation
	 */
	private applyOperation(
		operation: VectorOperationName,
		value: VectorDomain<Domain>,
		args: Record<string, unknown>
	): VectorDomain<Domain> {
		switch(operation) {
			case 'setAttr':
				return this.applySetAttr(value, args.attrs as VectorAttrDomain);
			case 'recycle':
				return this.applyRecycle(value, args.other as VectorDomain<Domain>);
			case 'concatenate':
				return this.applyConcatenate(value, args.other as VectorDomain<Domain> | undefined);
			case 'select':
				return this.applySelect(
					value,
					args.selector as VectorDomain<IntervalDomain> | VectorDomain<Domain>,
					args.naValue as Domain,
					args.selectorKind as SelectorKind | undefined
				);
			case 'update':
				return this.applyUpdate(value, args.selector as VectorDomain<IntervalDomain> | VectorDomain<Domain>, args.values as VectorDomain<Domain>, args.naValue as Domain, args.selectorKind as SelectorKind);
			default:
				vectorLogger.warn(`Unknown operation '${operation}' in applyOperation, returning top`);
				return value.top();
		}
	}

	/**
	 * Applies the setAttr operation to set vector attributes.
	 * Returns top if attributes are non-empty (unsupported for analysis).
	 * @param value - The current VectorDomain value
	 * @param attrs - The vector attribute domain to set
	 * @returns The resulting VectorDomain with updated attributes
	 */
	private applySetAttr(
		value: VectorDomain<Domain>,
		attrs: VectorAttrDomain
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: setAttr');
		if(!attrs.isEmpty()) {
			return value.top();
		}
		const result = value.create({
			length:     value.length,
			values:     value.values,
			summary:    value.summary,
			attributes: attrs,
			type:       value.type
		});
		return result;
	}

	/**
	 * Applies the recycle operation to align two vectors to the same length for binary operations.
	 * Combines length intervals and value domains of both operands.
	 * @param value - The first VectorDomain operand
	 * @param other - The second VectorDomain operand to recycle against
	 * @returns The resulting VectorDomain after recycling
	 */
	private applyRecycle(
		value: VectorDomain<Domain>,
		other: VectorDomain<Domain>
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: recycle');
		const len1 = value.length;
		const len2 = other.length;
		if(len1.isBottom() || len2.isBottom()) {
			return value.bottom();
		}
		const combinedSummary = value.summary.join(other.summary);
		if(len1.isTop() || len2.isTop()) {
			const result = value.create({
				length:     len1.top(),
				values:     value.values.top(),
				summary:    combinedSummary,
				attributes: value.attributes.join(other.attributes),
				type:       value.type
			});
			return result;
		}
		if(!len1.isValue() || !len2.isValue()) {
			const result = value.create({
				length:     len1.top(),
				values:     value.values.top(),
				summary:    combinedSummary,
				attributes: value.attributes.join(other.attributes),
				type:       value.type
			});
			return result;
		}
		const [l1, u1] = len1.value;
		const [l2, u2] = len2.value;
		const newUpper = Math.max(u1, u2);
		const newLower = Math.max(l1, l2);
		const incompatible = u1 !== +Infinity && u2 !== +Infinity && (u1 % u2 !== 0) && (u2 % u1 !== 0);
		if(incompatible) {
			const result = value.create({
				length:     len1.top(),
				values:     value.values.top(),
				summary:    combinedSummary,
				attributes: value.attributes.join(other.attributes),
				type:       value.type
			});
			return result;
		}
		const recycledLength = len1.create([newLower, newUpper]);
		const combinedValues = value.values.join(other.values);
		const result = value.create({
			length:     recycledLength,
			values:     combinedValues,
			summary:    combinedSummary,
			attributes: value.attributes.join(other.attributes),
			type:       value.type
		});
		return result;
	}

	/**
	 * Applies the concatenate operation to join two vectors.
	 * Computes new length interval as sum of both lengths and combines value domains.
	 * @param value - The first VectorDomain operand
	 * @param other - The second VectorDomain operand (undefined for single-element concatenations)
	 * @returns The resulting VectorDomain after concatenation
	 */
	private applyConcatenate(
		value: VectorDomain<Domain>,
		other: VectorDomain<Domain> | undefined
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: concatenate');
		if(other === undefined) {
			return value;
		}
		const len1 = value.length;
		const len2 = other.length;
		if(len1.isBottom() || len2.isBottom()) {
			return value.bottom();
		}
		if(len1.isTop() || len2.isTop()) {
			return value.top();
		}
		if(!len1.isValue() || !len2.isValue()) {
			return value.top();
		}
		const [l1, u1] = len1.value;
		const [l2, u2] = len2.value;
		const newLower = l1 + l2;
		const newUpper = u1 + u2;
		const concatenatedLength = len1.create([newLower, newUpper]);
		let concatenatedValues: typeof value.values;
		if(l1 === 0 && u1 === 0) {
			concatenatedValues = other.values;
		} else if(l2 === 0 && u2 === 0) {
			concatenatedValues = value.values;
		} else if(value.values.isBottom() || other.values.isBottom()) {
			concatenatedValues = value.values.bottom();
		} else if(value.values.isTop() || other.values.isTop()) {
			concatenatedValues = value.values.top();
		} else if(value.values.isValue() && other.values.isValue()) {
			const values1 = value.values.value as readonly NAAwareDomain<Domain>[];
			const values2 = other.values.value as readonly NAAwareDomain<Domain>[];
			const certain1 = l1 === u1;
			const certain2 = l2 === u2;
			if(certain1 && certain2) {
				const concatenated = [...values1, ...values2];
				concatenatedValues = value.values.create(concatenated);
			} else {
				const result: Domain[] = [...values1, ...values2];
				for(let len_a = u1 - 1; len_a >= l1; len_a--) {
					const v2Start = len_a;
					for(let i = 0; i < values2.length; i++) {
						const pos = v2Start + i;
						if(pos < result.length) {
							result[pos] = result[pos].join(values2[i]);
						}
					}
				}
				concatenatedValues = value.values.create(result);
			}
		} else {
			concatenatedValues = value.values.top();
		}
		const combinedSummary = value.summary.join(other.summary);
		const result = value.create({
			length:     concatenatedLength,
			values:     concatenatedValues,
			summary:    combinedSummary,
			attributes: value.attributes.join(other.attributes),
			type:       value.type
		});
		return result;
	}

	/**
	 * Applies the select operation to choose elements from a vector based on a selector.
	 * Uses abstract filtering (paper Section 4.7) for numeric selectors and AST-based
	 * detection for logical selectors.
	 *
	 * For numeric selectors, applies `abstractFilter` to classify positions into
	 * positive (≥ 0 or NA) and negative (≤ 0), then computes:
	 * `select(ν₁, ν₂) = select_pos(ν₁, ν₂⁺) ⊔ select_neg(ν₁, ν₂⁻)`
	 * @param value - The source VectorDomain to select from
	 * @param selector - The selector VectorDomain (interval or value domain)
	 * @param naValue - The NA value for out-of-bounds access
	 * @param selectorKind - Optional selector type from AST detection (used for logical detection)
	 * @returns The resulting VectorDomain after selection
	 */
	private applySelect(
		value: VectorDomain<Domain>,
		selector: VectorDomain<IntervalDomain> | VectorDomain<Domain>,
		naValue: Domain,
		selectorKind?: SelectorKind
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: select');
		if(value.isBottom() || selector.isBottom()) {
			return value.bottom();
		}

		if(selector.isTop()) {
			return value.top();
		}

		if(selectorKind === 'logical') {
			return this.applySelectLogical(value, selector as VectorDomain<Domain>, naValue);
		}

		const numericSelector = selector as VectorDomain<IntervalDomain>;

		if(!numericSelector.values.isValue() || !Array.isArray(numericSelector.values.value)) {
			// Cannot enumerate selector values, treat all positions as positive (conservative)
			const conservativeSelector = buildPosIntervalSelectorFromSource(numericSelector);
			return this.applySelectPositive(value, conservativeSelector, naValue);
		}

		// Paper Section 4.7: abstract filter classifies selector positions
		const selectorPositions = numericSelector.values.value as readonly NAAwareDomain<IntervalDomain>[];
		const filterResult = VectorDomain.abstractFilter(selectorPositions, numericSelector.factory);

		// Handle bottom propagation: if both groups have bottom elements, result is bottom
		if(filterResult.positiveHasBottom && filterResult.negativeHasBottom) {
			return value.bottom();
		}

		let result = value.bottom();

		// Build positive selector and apply select_pos (paper Section 4.7)
		if(filterResult.positive.length > 0 && !filterResult.positiveHasBottom) {
			const positiveSelector = buildPosIntervalSelector(numericSelector, filterResult.positive);
			const resultPos = this.applySelectPositive(value, positiveSelector, naValue);
			result = result.join(resultPos);
		}

		// Build negative selector and apply select_neg (paper Section 4.7)
		if(filterResult.negative.length > 0 && !filterResult.negativeHasBottom) {
			const negativeSelector = buildPosIntervalSelector(numericSelector, filterResult.negative);
			const resultNeg = this.applySelectNegative(value, negativeSelector, naValue);
			result = result.join(resultNeg);
		}

		return result;
	}

	/**
	 * Applies positive indexing selection: x[c] where c \&gt;= 0.
	 * Uses adjustForZeros to handle zero indices and builds result from known positions.
	 * @param value - The source VectorDomain to select from
	 * @param selector - The selector VectorDomain with positive intervals
	 * @param naValue - The NA value for out-of-bounds access
	 * @returns The resulting VectorDomain after positive selection
	 */
	private applySelectPositive(
		value: VectorDomain<Domain>,
		selector: VectorDomain<PosIntervalDomain>,
		naValue: Domain
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: selectPositive');
		const adjustedSelector = adjustForZeros(selector);
		const resultKnownPositions: Domain[] = [];
		if(adjustedSelector.values.isValue() && Array.isArray(adjustedSelector.values.value)) {
			const selectorValues = adjustedSelector.values.value as readonly NAAwareDomain<PosIntervalDomain>[];
			for(const idx of selectorValues) {
				if(idx.isBottom()) {
					continue;
				}
				const innerInterval = idx.inner;
				if(isEnumerable(innerInterval)) {
					if(innerInterval.isValue()) {
						const [l] = innerInterval.value;
						const pos = l === 0 ? 1 : l;
						if(pos > 0) {
							const accessed = accessPosition(value, pos - 1, naValue);
							resultKnownPositions.push(accessed);
						}
					} else {
						resultKnownPositions.push(squash(value) as unknown as Domain);
					}
				} else {
					resultKnownPositions.push(squash(value) as unknown as Domain);
				}
			}
		}
		const selectorLen = adjustedSelector.length;
		const isInfinite = selectorLen.isValue() && selectorLen.value[1] === +Infinity;
		const resultSummary = isInfinite ? squash(value) as unknown as Domain : value.summary.bottom();
		const resultValues = value.values.create(resultKnownPositions);
		const result = value.create({
			length:     adjustedSelector.length,
			values:     resultValues,
			summary:    resultSummary,
			attributes: value.attributes,
			type:       value.type
		});
		return result;
	}

	/**
	 * Applies negative indexing selection: x[c] where c \&lt; 0.
	 * Negative indices specify positions to delete from the vector.
	 * @param value - The source VectorDomain to select from
	 * @param selector - The selector VectorDomain with negative intervals
	 * @param naValue - The NA value for out-of-bounds access
	 * @returns The resulting VectorDomain after negative selection
	 */
	private applySelectNegative(
		value: VectorDomain<Domain>,
		selector: VectorDomain<PosIntervalDomain>,
		naValue: Domain
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: selectNegative');
		if(value.isBottom() || selector.isBottom()) {
			return value.bottom();
		}
		let sourceUpper: number;
		if(value.length.isValue()) {
			sourceUpper = value.length.value[1];
			if(sourceUpper === +Infinity) {
				return value.top();
			}
		} else {
			return value.top();
		}
		const _adjustedSelector = adjustForZeros(selector);
		const mustDeleted: number[] = [];
		const mayDeleted: number[] = [];
		if(selector.values.isValue()) {
			const selectorValues = selector.values.value as readonly NAAwareDomain<PosIntervalDomain>[];
			for(const idx of selectorValues) {
				if(idx.isBottom()) {
					continue;
				}
				const innerInterval = idx.inner;
				if(innerInterval.isValue()) {
					const [l, u] = innerInterval.value;
					if(l <= 0 && u <= 0) {
						const posLower = Math.abs(u);
						const posUpper = Math.abs(l);
						if(card(innerInterval) === 1) {
							const pos = posLower;
							if(pos >= 1 && pos <= sourceUpper) {
								mustDeleted.push(pos);
							}
						} else {
							for(let pos = posLower; pos <= posUpper && pos <= sourceUpper; pos++) {
								mayDeleted.push(pos);
							}
						}
					}
				} else {
					for(let pos = 1; pos <= sourceUpper; pos++) {
						mayDeleted.push(pos);
					}
				}
			}
		}
		const hasNonEnumerable = selector.values.isValue() && (selector.values.value as readonly NAAwareDomain<PosIntervalDomain>[]).some(idx => !isEnumerable(idx.inner));
		const numMustDeleted = mustDeleted.length;
		const newUpper = Math.max(0, sourceUpper - numMustDeleted);
		if(hasNonEnumerable || mayDeleted.length > 0) {
			const resultLength = value.length.create([0, newUpper]);
			const resultKnownPositions: Domain[] = [];
			const numPositions = Math.min(newUpper, sourceUpper);
			for(let i = 1; i <= numPositions; i++) {
				if(!mustDeleted.includes(i)) {
					const accessed = accessPosition(value, i - 1, naValue);
					resultKnownPositions.push(accessed);
				}
			}
			const result = value.create({
				length:     resultLength,
				values:     value.values.create(resultKnownPositions),
				summary:    value.summary.bottom(),
				attributes: value.attributes,
				type:       value.type
			});
			return result;
		}
		const resultLength = value.length.create([newUpper, newUpper]);
		const resultKnownPositions: Domain[] = [];
		for(let i = 1; i <= sourceUpper; i++) {
			if(!mustDeleted.includes(i)) {
				const accessed = accessPosition(value, i - 1, naValue);
				resultKnownPositions.push(accessed);
			}
		}
		const result = value.create({
			length:     resultLength,
			values:     value.values.create(resultKnownPositions),
			summary:    value.summary.bottom(),
			attributes: value.attributes,
			type:       value.type
		});
		return result;
	}

	/**
	 * Applies logical indexing selection: x[c] where c is a logical vector.
	 * Elements are selected where the corresponding selector value is TRUE.
	 * @param value - The source VectorDomain to select from
	 * @param selector - The logical selector VectorDomain
	 * @param naValue - The NA value for positions with NA selector
	 * @returns The resulting VectorDomain after logical selection
	 */
	private applySelectLogical(
		value: VectorDomain<Domain>,
		selector: VectorDomain<Domain>,
		naValue: Domain
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: selectLogical');
		if(value.isBottom() || selector.isBottom()) {
			return value.bottom();
		}
		let sourceLen = 0;
		if(value.length.isValue()) {
			sourceLen = value.length.value[1];
		}
		let selectorLen = 0;
		if(selector.length.isValue()) {
			selectorLen = selector.length.value[1];
		}
		if(selectorLen === 0) {
			const result = value.create({
				length:     value.length.create([0, 0]),
				values:     value.values.create([]),
				summary:    value.summary.bottom(),
				attributes: value.attributes,
				type:       value.type
			});
			return result;
		}
		if(sourceLen === +Infinity || selectorLen === +Infinity) {
			const result = value.create({
				length:     value.length.create([0, +Infinity]),
				values:     value.values.top(),
				summary:    squash(value) as unknown as Domain,
				attributes: value.attributes,
				type:       value.type
			});
			return result;
		}
		const maxLen = Math.max(sourceLen, selectorLen);
		const resultKnownPositions: Domain[] = [];
		for(let i = 0; i < maxLen; i++) {
			const selectorPos = i % selectorLen;
			let selectorVal: Domain;
			if(selector.values.isValue()) {
				const selectorValues = selector.values.value as readonly NAAwareDomain<Domain>[];
				if(selectorPos < selectorValues.length) {
					selectorVal = selectorValues[selectorPos];
				} else {
					selectorVal = selector.summary.inner;
				}
			} else {
				selectorVal = selector.summary.inner;
			}
			const sourceVal = accessPosition(value, i, naValue);
			if(selectorVal.isValue()) {
				resultKnownPositions.push(sourceVal);
			} else {
				resultKnownPositions.push(sourceVal.join(naValue));
			}
		}
		const isInfinite = selector.length.isValue() && selector.length.value[1] === +Infinity;
		const result = value.create({
			length:     value.length.create([0, resultKnownPositions.length]),
			values:     value.values.create(resultKnownPositions),
			summary:    isInfinite ? squash(value) : value.summary.bottom(),
			attributes: value.attributes,
			type:       value.type
		});
		return result;
	}

	/**
	 * Applies the update operation to modify elements in a vector based on a selector.
	 * Uses abstract filtering (paper Section 4.8) for numeric selectors and AST-based
	 * detection for logical selectors.
	 *
	 * For numeric selectors, applies `abstractFilter` to classify positions into
	 * positive (≥ 0 or NA) and negative (≤ 0), then computes:
	 * `update(ν₁, ν₂, ν₃) = update_pos(ν₁, ν₂⁺, ν₃) ⊔ update_neg(ν₁, ν₂⁻, ν₃)`
	 *
	 * Paper Section 4.8: Vector Update
	 * @param value - The target VectorDomain to update
	 * @param selector - The selector for positions to update
	 * @param values - The values to assign to selected positions
	 * @param naValue - The NA value for out-of-bounds positions
	 * @param selectorKind - The kind of selector (logical or numeric)
	 * @returns The resulting VectorDomain after update
	 */
	private applyUpdate(
		value: VectorDomain<Domain>,
		selector: VectorDomain<IntervalDomain> | VectorDomain<Domain>,
		values: VectorDomain<Domain>,
		naValue: Domain,
		selectorKind: SelectorKind
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: update');
		if(value.isBottom() || selector.isBottom() || values.isBottom()) {
			return value.bottom();
		}

		// Logical selector: use logical update
		if(selectorKind === 'logical') {
			return this.applyUpdateLogical(value, selector as VectorDomain<Domain>, values, naValue);
		}

		const numericSelector = selector as VectorDomain<IntervalDomain>;

		if(!numericSelector.values.isValue() || !Array.isArray(numericSelector.values.value)) {
			// Cannot enumerate selector values, apply positive update conservatively
			const conservativeSelector = buildPosIntervalSelectorFromSource(numericSelector);
			return this.applyUpdatePositive(value, conservativeSelector, values, naValue);
		}

		// Paper Section 4.8: abstract filter classifies selector positions
		const selectorPositions = numericSelector.values.value as readonly NAAwareDomain<IntervalDomain>[];
		const filterResult = VectorDomain.abstractFilter(selectorPositions, numericSelector.factory);

		// Handle bottom propagation: if both groups have bottom elements, result is bottom
		if(filterResult.positiveHasBottom && filterResult.negativeHasBottom) {
			return value.bottom();
		}

		let result = value.bottom();

		// Build positive selector and apply update_pos (paper Section 4.8)
		if(filterResult.positive.length > 0 && !filterResult.positiveHasBottom) {
			const positiveSelector = buildPosIntervalSelector(numericSelector, filterResult.positive);
			const resultPos = this.applyUpdatePositive(value, positiveSelector, values, naValue);
			result = result.join(resultPos);
		}

		// Build negative selector and apply update_neg (paper Section 4.8)
		if(filterResult.negative.length > 0 && !filterResult.negativeHasBottom) {
			const negativeSelector = buildPosIntervalSelector(numericSelector, filterResult.negative);
			const resultNeg = this.applyUpdateNegative(value, negativeSelector, values, naValue);
			result = result.join(resultNeg);
		}

		return result;
	}

	/**
	 * Applies positive indexing update: x[c] \&lt;- v where c \&gt;= 0.
	 * Handles both finite and infinite selectors using cyclic value recycling.
	 * @param value - The target VectorDomain to update
	 * @param selector - The positive selector VectorDomain
	 * @param values - The values to assign
	 * @param naValue - The NA value for out-of-bounds positions
	 * @returns The resulting VectorDomain after positive update
	 */
	private applyUpdatePositive(
		value: VectorDomain<Domain>,
		selector: VectorDomain<PosIntervalDomain>,
		values: VectorDomain<Domain>,
		naValue: Domain
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: updatePositive');
		const adjustedSelector = adjustForZeros(selector);
		const hasNonEnumerable = adjustedSelector.values.isValue() && (adjustedSelector.values.value as readonly NAAwareDomain<PosIntervalDomain>[]).some(idx => !isEnumerable(idx.inner));
		if(hasNonEnumerable) {
			const vAll = squash(value).join(squash(values));
			const result = value.create({
				length:     value.length.create([value.length.isValue() ? value.length.value[0] : 0, +Infinity]),
				values:     value.values.create([]),
				summary:    vAll,
				attributes: value.attributes,
				type:       value.type
			});
			return result;
		}
		let sourceLower = 0, sourceUpper = 0;
		if(value.length.isValue()) {
			sourceLower = value.length.value[0];
			sourceUpper = value.length.value[1];
		}
		let selectorUpper = 0;
		if(adjustedSelector.length.isValue()) {
			selectorUpper = adjustedSelector.length.value[1];
		}
		const isInfinite = selectorUpper === +Infinity;
		if(isInfinite) {
			const summaryInner = adjustedSelector.summary.inner;
			const selectorSummaryEnumerable = summaryInner !== undefined ? isEnumerable(summaryInner) : false;
			const summaryLower = summaryInner !== undefined && summaryInner.isValue() ? summaryInner.value[0] : 0;
			const uR = Math.max(selectorUpper === +Infinity ? 0 : selectorUpper, summaryLower);
			const selectorKnownPositions = adjustedSelector.values.isValue() ? (adjustedSelector.values.value as readonly NAAwareDomain<PosIntervalDomain>[]) : [];
			const baseKnownPositions = initKnownPositions(selectorKnownPositions as unknown as Domain[], sourceLower, sourceUpper, uR, naValue.inner);
			let valuesUpper = 0;
			if(values.length.isValue()) {
				valuesUpper = values.length.value[1];
			}
			const cyclicValues = generateCyclicKnownPositions(values, valuesUpper);
			const resultKnownPositions = updateKnownPositions(baseKnownPositions, selectorKnownPositions, cyclicValues);
			if(!selectorSummaryEnumerable && summaryInner !== undefined && summaryInner.isValue()) {
				const squashValues = squash(values);
				const squashValuesInner = squashValues.inner;
				const lS2 = summaryInner.value[0];
				for(let i = Math.max(0, lS2 - 1); i < resultKnownPositions.length; i++) {
					resultKnownPositions[i] = resultKnownPositions[i].join(squashValuesInner ?? naValue.top().inner);
				}
			}
			const resultSummary = value.summary.join(squash(values));
			const result = value.create({
				length:     value.length.create([sourceLower, +Infinity]),
				values:     value.values.create(resultKnownPositions),
				summary:    resultSummary,
				attributes: value.attributes,
				type:       value.type
			});
			return result;
		} else {
			let uR = 0;
			if(adjustedSelector.values.isValue()) {
				const selectorKnownPositions = adjustedSelector.values.value as readonly NAAwareDomain<PosIntervalDomain>[];
				for(const idx of selectorKnownPositions) {
					if(idx.inner.isValue()) {
						uR = Math.max(uR, idx.inner.value[1]);
					}
				}
			}
			uR = Math.max(uR, sourceUpper);
			const selectorKnownPositions = adjustedSelector.values.isValue() ? (adjustedSelector.values.value as readonly NAAwareDomain<PosIntervalDomain>[]) : [];
			const baseKnownPositions = initKnownPositions(selectorKnownPositions as unknown as Domain[], sourceLower, sourceUpper, uR, naValue.inner);
			let valuesUpper = 0;
			if(values.length.isValue()) {
				valuesUpper = values.length.value[1];
			}
			const cyclicValues = generateCyclicKnownPositions(values, Math.max(selectorUpper, valuesUpper));
			const resultKnownPositions = updateKnownPositions(baseKnownPositions, selectorKnownPositions, cyclicValues);
			const result = value.create({
				length:     value.length.create([sourceLower, uR]),
				values:     value.values.create(resultKnownPositions),
				summary:    value.summary.bottom(),
				attributes: value.attributes,
				type:       value.type
			});
			return result;
		}
	}

	/**
	 * Applies negative indexing update: x[c] \&lt;- v where c \&lt; 0.
	 * Negative indices specify positions to update by their absolute values.
	 * @param value - The target VectorDomain to update
	 * @param selector - The negative selector VectorDomain
	 * @param values - The values to assign
	 * @param naValue - The NA value for out-of-bounds positions
	 * @returns The resulting VectorDomain after negative update
	 */
	private applyUpdateNegative(
		value: VectorDomain<Domain>,
		selector: VectorDomain<PosIntervalDomain>,
		values: VectorDomain<Domain>,
		naValue: Domain
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: updateNegative');
		if(value.isBottom() || selector.isBottom() || values.isBottom()) {
			return value.bottom();
		}
		let sourceUpper = 0;
		if(value.length.isValue()) {
			sourceUpper = value.length.value[1];
			if(sourceUpper === +Infinity) {
				return value.top();
			}
		} else {
			return value.top();
		}
		const adjustedSelector = adjustForZeros(selector);
		const mustNotUpdated: number[] = [];
		const mayNotUpdated: number[] = [];
		if(adjustedSelector.values.isValue()) {
			const selectorKnownPositions = adjustedSelector.values.value as readonly NAAwareDomain<PosIntervalDomain>[];
			for(const idx of selectorKnownPositions) {
				if(idx.isBottom()) {
					continue;
				}
				const innerInterval = idx.inner;
				if(innerInterval.isValue()) {
					const [l, u] = innerInterval.value;
					if(l <= 0 && u <= 0) {
						const posLower = Math.abs(u);
						const posUpper = Math.abs(l);
						if(card(innerInterval) === 1) {
							const pos = posLower;
							if(pos >= 1 && pos <= sourceUpper) {
								mustNotUpdated.push(pos);
							}
						} else {
							for(let pos = posLower; pos <= posUpper && pos <= sourceUpper; pos++) {
								mayNotUpdated.push(pos);
							}
						}
					}
				} else {
					for(let pos = 1; pos <= sourceUpper; pos++) {
						mayNotUpdated.push(pos);
					}
				}
			}
		}
		const hasNonEnumerable = adjustedSelector.values.isValue() && (adjustedSelector.values.value as readonly NAAwareDomain<PosIntervalDomain>[]).some(idx => !isEnumerable(idx.inner));
		const v = squash(values);
		const vInner = v.inner;
		if(hasNonEnumerable) {
			const sourceKnownPositions = value.values.isValue() ? (value.values.value as readonly NAAwareDomain<Domain>[]) : [];
			const resultKnownPositions: Domain[] = [];
			for(let i = 1; i <= sourceUpper; i++) {
				const idx = i - 1;
				let val: Domain;
				if(idx < sourceKnownPositions.length) {
					val = sourceKnownPositions[idx];
				} else {
					val = value.summary.inner;
				}
				if(!mustNotUpdated.includes(i)) {
					val = val.join(vInner ?? naValue.top().inner);
				}
				resultKnownPositions.push(val);
			}
			const resultSummary = value.summary.join(v);
			const result = value.create({
				length:     value.length,
				values:     value.values.create(resultKnownPositions),
				summary:    resultSummary,
				attributes: value.attributes,
				type:       value.type
			});
			return result;
		}
		const isInfinite = adjustedSelector.length.isValue() && adjustedSelector.length.value[1] === +Infinity;
		if(isInfinite) {
			return value.top();
		} else {
			let selectorUpper = 0;
			if(adjustedSelector.length.isValue()) {
				selectorUpper = adjustedSelector.length.value[1];
			}
			const uR = Math.max(sourceUpper, selectorUpper);
			let valuesUpper = 0;
			if(values.length.isValue()) {
				valuesUpper = values.length.value[1];
			}
			const cyclicValues = generateCyclicKnownPositions(values, Math.max(selectorUpper, valuesUpper));
			const sourceKnownPositions = value.values.isValue() ? (value.values.value as readonly NAAwareDomain<Domain>[]) : [];
			const resultKnownPositions: Domain[] = [];
			for(let i = 0; i < uR; i++) {
				if(i < sourceKnownPositions.length) {
					resultKnownPositions.push(sourceKnownPositions[i]);
				} else if(i < sourceUpper) {
					resultKnownPositions.push(value.summary.inner);
				} else {
					resultKnownPositions.push(naValue.inner);
				}
			}
			const updatedPositions = new Set([...mustNotUpdated, ...mayNotUpdated]);
			for(let i = 1; i <= uR; i++) {
				if(!updatedPositions.has(i)) {
					const idx = i - 1;
					const valueIdx = (i - 1) % cyclicValues.length;
					resultKnownPositions[idx] = cyclicValues[valueIdx];
				}
			}
			const result = value.create({
				length:     value.length.create([value.length.isValue() ? value.length.value[0] : 0, uR]),
				values:     value.values.create(resultKnownPositions),
				summary:    value.summary.bottom(),
				attributes: value.attributes,
				type:       value.type
			});
			return result;
		}
	}

	/**
	 * Applies logical indexing update: x[c] \\&lt;- v where c is a logical vector.
	 * Values are assigned to positions where the selector is TRUE.
	 * Uses cyclic recycling when selector is shorter than the source.
	 * @param value - The target VectorDomain to update
	 * @param selector - The logical selector VectorDomain
	 * @param values - The values to assign
	 * @param naValue - The NA value for out-of-bounds positions
	 * @returns The resulting VectorDomain after logical update
	 */
	private applyUpdateLogical(
		value: VectorDomain<Domain>,
		selector: VectorDomain<Domain>,
		values: VectorDomain<Domain>,
		naValue: Domain
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: updateLogical');
		if(value.isBottom() || selector.isBottom() || values.isBottom()) {
			return value.bottom();
		}
		let sourceLower = 0, sourceUpper = 0;
		if(value.length.isValue()) {
			sourceLower = value.length.value[0];
			sourceUpper = value.length.value[1];
		}
		let selectorUpper = 0;
		if(selector.length.isValue()) {
			selectorUpper = selector.length.value[1];
		}
		const isInfinite = selectorUpper === +Infinity;
		const sourceKnownPositions = value.values.isValue() ? (value.values.value as readonly NAAwareDomain<Domain>[]) : [];
		const selectorKnownPositions = selector.values.isValue() ? (selector.values.value as readonly NAAwareDomain<Domain>[]) : [];
		const maxLen = Math.max(sourceKnownPositions.length, selectorKnownPositions.length);
		const resultKnownPositions: Domain[] = [];
		for(let i = 0; i < maxLen; i++) {
			if(i < sourceKnownPositions.length) {
				resultKnownPositions.push(sourceKnownPositions[i]);
			} else if(i < sourceUpper) {
				resultKnownPositions.push(value.summary.inner);
			} else {
				resultKnownPositions.push(naValue.inner);
			}
		}
		const cyclicValues = generateCyclicKnownPositions(values, selectorUpper);
		for(let i = 0; i < maxLen && i < cyclicValues.length; i++) {
			let selectorVal: Domain;
			if(i < selectorKnownPositions.length) {
				selectorVal = selectorKnownPositions[i];
			} else if(i < selectorKnownPositions.length + (selector.summary.isValue() ? 1 : 0)) {
				selectorVal = selector.summary.inner;
			} else {
				selectorVal = selector.summary.top().inner;
			}
			if(selectorVal.isValue()) {
				resultKnownPositions[i] = cyclicValues[i % cyclicValues.length];
			} else {
				resultKnownPositions[i] = resultKnownPositions[i].join(cyclicValues[i % cyclicValues.length]);
			}
		}
		const resultUpper = isInfinite ? +Infinity : Math.max(sourceUpper, selectorUpper);
		const resultSummary = isInfinite ? squash(values) : value.summary.bottom();
		const result = value.create({
			length:     value.length.create([sourceLower, resultUpper]),
			values:     value.values.create(resultKnownPositions),
			summary:    resultSummary,
			attributes: value.attributes,
			type:       value.type
		});
		return result;
	}
}

/**
 * Builds a PosIntervalDomain-typed selector vector from filtered positions.
 * Converts NAAwareDomain<IntervalDomain> positions (guaranteed to be in Z≥0 ∪ {NA}
 * for positive, or Z≤0 for negative) into NAAwareDomain<PosIntervalDomain>
 * by wrapping each inner IntervalDomain as a PosIntervalDomain.
 */
function buildPosIntervalSelector(
	source: VectorDomain<IntervalDomain>,
	positions: readonly NAAwareDomain<IntervalDomain>[]
): VectorDomain<PosIntervalDomain> {
	if(positions.length === 0) {
		return source.bottom();
	}
	const posIntervalFactory: DomainFactory<PosIntervalDomain> = (c: unknown) => {
		if(c === undefined) {
			return PosIntervalDomain.bottom();
		}
		if(c === Bottom) {
			return PosIntervalDomain.bottom();
		}
		if(c === Top) {
			return PosIntervalDomain.top();
		}
		const values = [...(c as Set<number>)];
		return new PosIntervalDomain([Math.min(...values), Math.max(...values)]);
	};
	const naAwarePositions = positions.map(pos => {
		if(pos.isBottom()) {
			return NAAwareDomain.bottom(posIntervalFactory);
		}
		if(pos.isTop()) {
			return NAAwareDomain.top(posIntervalFactory);
		}
		// Convert inner IntervalDomain to PosIntervalDomain
		// (safe because abstractFilter guarantees lower ≥ 0 for positive, upper ≤ 0 for negative)
		const innerInterval = pos.inner;
		const posInner = new PosIntervalDomain(innerInterval.value);
		return new NAAwareDomain({ inner: posInner, hasNA: pos.containsNA() }, posIntervalFactory);
	});
	const naAwareSummary = source.summary.isBottom()
		? NAAwareDomain.bottom(posIntervalFactory)
		: source.summary.isTop()
			? NAAwareDomain.top(posIntervalFactory)
			: new NAAwareDomain(
				{ inner: new PosIntervalDomain(source.summary.inner.value), hasNA: source.summary.containsNA() },
				posIntervalFactory
			);
	return VectorDomain.fromValues(
		posIntervalFactory,
		source.length,
		naAwarePositions,
		naAwareSummary,
		source.attributes,
		source.type
	);
}

/**
 * Converts an entire VectorDomain<IntervalDomain> selector to VectorDomain<PosIntervalDomain>
 * by converting all inner domains. Used as a conservative fallback when selector values
 * cannot be enumerated for abstract filtering.
 */
function buildPosIntervalSelectorFromSource(
	source: VectorDomain<IntervalDomain>
): VectorDomain<PosIntervalDomain> {
	const posIntervalFactory: DomainFactory<PosIntervalDomain> = (c: unknown) => {
		if(c === undefined) {
			return PosIntervalDomain.bottom();
		}
		if(c === Bottom) {
			return PosIntervalDomain.bottom();
		}
		if(c === Top) {
			return PosIntervalDomain.top();
		}
		const values = [...(c as Set<number>)];
		return new PosIntervalDomain([Math.min(...values), Math.max(...values)]);
	};
	const convertNAAware = (naAware: NAAwareDomain<IntervalDomain>): NAAwareDomain<PosIntervalDomain> => {
		if(naAware.isBottom()) {
			return NAAwareDomain.bottom(posIntervalFactory);
		}
		if(naAware.isTop()) {
			return NAAwareDomain.top(posIntervalFactory);
		}
		const posInner = new PosIntervalDomain(naAware.inner.value);
		return new NAAwareDomain({ inner: posInner, hasNA: naAware.containsNA() }, posIntervalFactory);
	};
	let positions: readonly NAAwareDomain<PosIntervalDomain>[];
	if(source.values.isValue() && Array.isArray(source.values.value)) {
		positions = (source.values.value as readonly NAAwareDomain<IntervalDomain>[]).map(convertNAAware);
	} else {
		positions = [];
	}
	const summary = convertNAAware(source.summary);
	return VectorDomain.fromValues(
		posIntervalFactory,
		source.length,
		positions,
		summary,
		source.attributes,
		source.type
	);
}
