/* eslint-disable tsdoc/syntax */
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
	squashedExcept,
	adjustForZeros,
	initKnownPositions,
	updateKnownPositions,
	generateCyclicKnownPositions,
	accessPosition,
	rhoF
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
import { KnownInitialPositionsDomain } from './known-initial-positions-domain';
import { guard } from '../../util/assert';

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
	private readonly naFactory:      import('./vector-domain').DomainFactory<NAAwareDomain<Domain>>;
	private readonly valueConverter: ValueToDomainConverter<Domain>;

	constructor(
		factory: import('./vector-domain').DomainFactory<Domain>,
		valueConverter: ValueToDomainConverter<Domain>,
		{ trackOperations = true, ...config }: VectorInferenceConfiguration
	) {
		super(config, VectorDomain.top(factory));
		this.factory = factory;
		this.naFactory = NAAwareDomain.createSmartFactory(factory);
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

		vectorLogger.debug(`Handler: handleConcatenate [argCount=${args.length}]`);
		for(const arg of args) {
			if(arg.resolved) {
				vectorLogger.debug(`Handler: handleConcatenate arg [id=${arg.id}, length=${arg.resolved.length.toString()}, values=${arg.resolved.known.toString()}]`);
			} else {
				vectorLogger.debug(`Handler: handleConcatenate arg [id=${arg.id}, resolved=undefined]`);
			}
		}

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

		vectorLogger.debug(`Handler: handleArithmetic [lhsId=${lhsId}, rhsId=${rhsId}, operator=${(node as RBinaryOp | RUnaryOp).operator}]`);

		// Handle unary operations (e.g., -1) where there's only one argument
		if(node.type === RType.UnaryOp) {
			if(lhsId === undefined) {
				vectorLogger.debug('Handler: handleArithmetic unary - no lhsId');
				return [{ operation: 'unknown', operand: undefined }];
			}
			// For unary minus, we need to negate the value
			// Since PosIntervalDomain can't represent negative values, we return top
			// to indicate we can't precisely track the value
			const operandValue = this.getVectorDomainValue(lhsId);
			if(operandValue?.isValue() && node.operator === '-') {
				vectorLogger.debug(`Handler: handleArithmetic unary minus with value [length=${operandValue.length.toString()}]`);
				// The operand has a concrete value, try to negate it
				// Return top since we can't represent negative values in PosIntervalDomain
				return [{ operation: 'concatenate', operand: operandValue.top() }];
			}
			vectorLogger.debug(`Handler: handleArithmetic unary - not handling [hasValue=${operandValue?.isValue()}, operator=${node.operator}]`);
			return [{ operation: 'unknown', operand: undefined }];
		}

		if(lhsId === undefined) {
			vectorLogger.debug('Handler: handleArithmetic binary - no lhsId');
			return [{ operation: 'unknown', operand: undefined }];
		}

		const lhsValue = this.getVectorDomainValue(lhsId);
		const rhsValue = rhsId !== undefined ? this.getVectorDomainValue(rhsId) : undefined;
		vectorLogger.debug(`Handler: handleArithmetic binary [lhsLength=${lhsValue?.length.toString()}, rhsLength=${rhsValue?.length.toString()}]`);

		return [{
			operation: 'recycle',
			operand:   lhsValue,
			other:     rhsValue
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

			vectorLogger.debug(`Handler: handleAccess [operandId=${operand}, selectorId=${selector}, selectorKind=${selectorKind}]`);
			if(resolvedOperand) {
				vectorLogger.debug(`Handler: handleAccess operand value [length=${resolvedOperand.length.toString()}, values=${resolvedOperand.known.toString()}, summary=${resolvedOperand.summary.toString()}]`);
			}

			return [{
				operation: 'select',
				operand:   resolvedOperand,
				selector:  selector !== undefined ? String(selector) : undefined,
				selectorKind
			}];
		}

		// Two arguments: x[i, j] - matrix/array access (not supported yet)
		vectorLogger.debug(`Handler: handleAccess matrix access (not supported) [argCount=${args.length}]`);
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
			const resolvedValues = values !== undefined ? this.getVectorDomainValue(values) : undefined;

			vectorLogger.debug(`Handler: handleReplacement [operandId=${operand}, selectorId=${selector}, valuesId=${values}, selectorKind=${selectorKind}]`);
			if(resolvedOperand) {
				vectorLogger.debug(`Handler: handleReplacement operand [length=${resolvedOperand.length.toString()}, values=${resolvedOperand.known.toString()}]`);
			}
			if(resolvedValues) {
				vectorLogger.debug(`Handler: handleReplacement values [length=${resolvedValues.length.toString()}, values=${resolvedValues.known.toString()}]`);
			}

			return [{
				operation: 'update',
				operand:   resolvedOperand,
				selector:  selector !== undefined ? String(selector) : undefined,
				known:     values !== undefined ? String(values) : undefined,
				selectorKind
			}];
		}

		vectorLogger.debug(`Handler: handleReplacement matrix access (not supported) [argCount=${args.length}]`);
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

		const naValue = this.naFactory(NA);

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

		if('known' in args && typeof args.known === 'string') {
			const valuesId = Number(args.known) as NodeId;
			const valuesValue = this.getVectorDomainValue(valuesId);
			resolved.known = valuesValue ?? VectorDomain.bottom(this.factory);
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
		naValue: NAAwareDomain<Domain>
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
					args.naValue as NAAwareDomain<Domain>,
					args.selectorKind as SelectorKind | undefined
				);
			case 'update':
				return this.applyUpdate(value, args.selector as VectorDomain<IntervalDomain> | VectorDomain<Domain>, args.known as VectorDomain<Domain>, args.naValue as NAAwareDomain<Domain>, args.selectorKind as SelectorKind);
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
			known:      value.known,
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
		vectorLogger.debug(`Operation: recycle lengths [len1=${len1.toString()}, len2=${len2.toString()}]`);

		if(len1.isBottom() || len2.isBottom()) {
			vectorLogger.debug('Operation: recycle returning bottom');
			return value.bottom();
		}
		const combinedSummary = value.summary.join(other.summary);
		if(len1.isTop() || len2.isTop()) {
			vectorLogger.debug('Operation: recycle returning top (length is top)');
			const result = value.create({
				length:     len1.top(),
				known:      value.known.top(),
				summary:    combinedSummary,
				attributes: value.attributes.join(other.attributes),
				type:       value.type
			});
			return result;
		}
		if(!len1.isValue() || !len2.isValue()) {
			vectorLogger.debug('Operation: recycle returning top (not value)');
			const result = value.create({
				length:     len1.top(),
				known:      value.known.top(),
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
		vectorLogger.debug(`Operation: recycle computed [l1=${l1}, u1=${u1}, l2=${l2}, u2=${u2}, newLower=${newLower}, newUpper=${newUpper}, incompatible=${incompatible}]`);

		if(incompatible) {
			vectorLogger.debug('Operation: recycle incompatible lengths, returning top');
			const result = value.create({
				length:     len1.top(),
				known:      value.known.top(),
				summary:    combinedSummary,
				attributes: value.attributes.join(other.attributes),
				type:       value.type
			});
			return result;
		}
		const recycledLength = len1.create([newLower, newUpper]);
		const combinedValues = value.known.join(other.known);
		const result = value.create({
			length:     recycledLength,
			known:      combinedValues,
			summary:    combinedSummary,
			attributes: value.attributes.join(other.attributes),
			type:       value.type
		});
		vectorLogger.debug(`Operation: recycle result [length=${result.length.toString()}, values=${result.known.toString()}]`);
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
		vectorLogger.debug(`Operation: concatenate [hasOther=${other !== undefined}]`);
		if(other === undefined) {
			vectorLogger.debug(`Operation: concatenate no other operand, returning value [length=${value.length.toString()}]`);
			return value;
		}

		const len1 = value.length;
		const len2 = other.length;
		vectorLogger.debug(`Operation: concatenate lengths [len1=${len1.toString()}, len2=${len2.toString()}]`);

		if(len1.isBottom() || len2.isBottom()) {
			vectorLogger.debug('Operation: concatenate returning bottom');
			return value.bottom();
		}
		if(len1.isTop() || len2.isTop()) {
			vectorLogger.debug('Operation: concatenate returning top');
			return value.top();
		}
		if(!len1.isValue() || !len2.isValue()) {
			vectorLogger.debug('Operation: concatenate returning top (not value)');
			return value.top();
		}
		const [l1, u1] = len1.value;
		const [l2, u2] = len2.value;
		const newLower = l1 + l2;
		const newUpper = u1 + u2;
		vectorLogger.debug(`Operation: concatenate computed [l1=${l1}, u1=${u1}, l2=${l2}, u2=${u2}, newLower=${newLower}, newUpper=${newUpper}]`);

		const concatenatedLength = len1.create([newLower, newUpper]);
		let concatenatedValues: typeof value.known;
		if(l1 === 0 && u1 === 0) {
			concatenatedValues = other.known;
			vectorLogger.debug('Operation: concatenate using other.known (len1 is 0)');
		} else if(l2 === 0 && u2 === 0) {
			concatenatedValues = value.known;
			vectorLogger.debug('Operation: concatenate using value.known (len2 is 0)');
		} else if(value.known.isBottom() || other.known.isBottom()) {
			concatenatedValues = value.known.bottom();
			vectorLogger.debug('Operation: concatenate values bottom');
		} else if(value.known.isTop() || other.known.isTop()) {
			concatenatedValues = value.known.top();
			vectorLogger.debug('Operation: concatenate values top');
		} else if(value.known.isValue() && other.known.isValue()) {
			const values1 = value.known.value as readonly NAAwareDomain<Domain>[];
			const values2 = other.known.value as readonly NAAwareDomain<Domain>[];
			const certain1 = l1 === u1;
			const certain2 = l2 === u2;
			vectorLogger.debug(`Operation: concatenate values [values1.length=${values1.length}, values2.length=${values2.length}, certain1=${certain1}, certain2=${certain2}]`);
			if(certain1 && certain2) {
				const concatenated = [...values1, ...values2];
				concatenatedValues = value.known.create(concatenated);
			} else {
				const result: NAAwareDomain<Domain>[] = [...values1, ...values2];
				for(let len_a = u1 - 1; len_a >= l1; len_a--) {
					const v2Start = len_a;
					for(let i = 0; i < values2.length; i++) {
						const pos = v2Start + i;
						if(pos < result.length) {
							result[pos] = result[pos].join(values2[i]);
						}
					}
				}
				concatenatedValues = value.known.create(result);
			}
		} else {
			concatenatedValues = value.known.top();
			vectorLogger.debug('Operation: concatenate values top (fallback)');
		}
		const combinedSummary = value.summary.join(other.summary);
		const result = value.create({
			length:     concatenatedLength,
			known:      concatenatedValues,
			summary:    combinedSummary,
			attributes: value.attributes.join(other.attributes),
			type:       value.type
		});
		vectorLogger.debug(`Operation: concatenate result [length=${result.length.toString()}, values=${result.known.toString()}]`);
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
		naValue: NAAwareDomain<Domain>,
		selectorKind?: SelectorKind
	): VectorDomain<Domain> {
		vectorLogger.debug(`Operation: select [selectorKind=${selectorKind ?? 'numeric'}]`);
		vectorLogger.debug(`Operation: select input [value.length=${value.length.toString()}, value.known=${value.known.toString()}, selector.length=${selector.length.toString()}]`);

		if(value.isBottom() || selector.isBottom()) {
			vectorLogger.debug('Operation: select returning bottom (input is bottom)');
			return value.bottom();
		}

		if(selector.isTop()) {
			vectorLogger.debug('Operation: select returning squashed (selector is top)');
			const squashedValue = squash(value);
			const smartFactory = NAAwareDomain.createSmartFactory(value.factory);
			const valueSquashed = VectorDomain.create(
				value.factory,
				PosIntervalDomain.top(),
				KnownInitialPositionsDomain.top<NAAwareDomain<Domain>>(smartFactory),
				squashedValue,
				value.attributes,
				value.type
			);
			return valueSquashed;
		}

		if(selectorKind === 'logical') {
			const result = this.applySelectLogical(value, selector as VectorDomain<Domain>, naValue);
			vectorLogger.debug(`Operation: select logical result [length=${result.length.toString()}, values=${result.known.toString()}]`);
			return result;
		}

		const numericSelector = selector as VectorDomain<IntervalDomain>;

		if(!numericSelector.known.isValue() || !Array.isArray(numericSelector.known.value)) {
			// Cannot enumerate selector values, treat all positions as positive (conservative)
			vectorLogger.debug('Operation: select cannot enumerate selector values, using conservative positive');
			const conservativeSelector = buildPosIntervalSelectorFromSource(numericSelector);
			const result = this.applySelectPositive(value, conservativeSelector, naValue);
			vectorLogger.debug(`Operation: select conservative result [length=${result.length.toString()}]`);
			return result;
		}

		// Paper Section 4.7: abstract filter classifies selector positions
		const selectorPositions = numericSelector.known.value as readonly NAAwareDomain<IntervalDomain>[];
		const filterResult = VectorDomain.abstractFilter(selectorPositions, numericSelector.factory);
		vectorLogger.debug(`Operation: select filter [positive=${filterResult.positive.length}, negative=${filterResult.negative.length}, posBottom=${filterResult.positiveHasBottom}, negBottom=${filterResult.negativeHasBottom}]`);

		// Handle bottom propagation: if both groups have bottom elements, result is bottom
		if(filterResult.positiveHasBottom && filterResult.negativeHasBottom) {
			vectorLogger.debug('Operation: select returning bottom (both groups have bottom)');
			return value.bottom();
		}

		let result = value.bottom();

		// Build positive selector and apply select_pos (paper Section 4.7)
		if(filterResult.positive.length > 0 && !filterResult.positiveHasBottom) {
			const positiveSelector = buildPosIntervalSelector(numericSelector, filterResult.positive);
			const resultPos = this.applySelectPositive(value, positiveSelector, naValue);
			vectorLogger.debug(`Operation: select positive result [length=${resultPos.length.toString()}]`);
			result = result.join(resultPos);
		}

		// Build negative selector and apply select_neg (paper Section 4.7)
		if(filterResult.negative.length > 0 && !filterResult.negativeHasBottom) {
			const negativeSelector = buildPosIntervalSelector(numericSelector, filterResult.negative);
			const resultNeg = this.applySelectNegative(value, negativeSelector, naValue);
			vectorLogger.debug(`Operation: select negative result [length=${resultNeg.length.toString()}]`);
			result = result.join(resultNeg);
		}

		vectorLogger.debug(`Operation: select final result [length=${result.length.toString()}, values=${result.known.toString()}]`);
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
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: selectPositive');
		vectorLogger.debug(`  selector [length=${selector.length.toString()}, values=${selector.known.toString()}]`);
		const adjustedSelector = adjustForZeros(selector);
		vectorLogger.debug(`  adjustedSelector [length=${adjustedSelector.length.toString()}, values=${adjustedSelector.known.toString()}]`);
		const resultKnownPositions: NAAwareDomain<Domain>[] = [];
		if(adjustedSelector.known.isValue() && Array.isArray(adjustedSelector.known.value)) {
			const selectorValues = adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[];

			let idxNumber = 0;
			for(const idx of selectorValues) {
				guard(!idx.isBottom(), 'applySelectPositive: selector position should not be bottom');

				const innerInterval = idx.inner;
				if(isEnumerable(innerInterval)) {
					if(innerInterval.isValue()) {
						const [l, u] = innerInterval.value;
						vectorLogger.trace(`Subcase: selectPositive - enumerable interval [${l}, ${u}]`);
						let joinedAccessed: NAAwareDomain<Domain> | undefined;
						for(let pos = l; pos <= u; pos++) {
							const adjustedPos = pos === 0 ? 1 : pos;
							if(adjustedPos > 0) {
								const accessed = accessPosition(value, adjustedPos - 1, naValue);
								joinedAccessed = joinedAccessed === undefined ? accessed : joinedAccessed.join(accessed);
							}
						}
						guard(joinedAccessed !== undefined, `applySelectPositive: joinedAccessed undefined for position ${idxNumber}`);

						resultKnownPositions.push(joinedAccessed);
					} else {
						vectorLogger.trace('Subcase: selectPositive - enumerable selector with non-value interval, using squash');
						resultKnownPositions.push(squash(value));
					}
				} else {
					vectorLogger.trace('Subcase: selectPositive - non-enumerable selector, using squash');
					resultKnownPositions.push(squash(value));
				}

				idxNumber += 1;
			}
		}
		const selectorLen = adjustedSelector.length;
		const isInfinite = selectorLen.isValue() && selectorLen.value[1] === +Infinity;
		if(isInfinite) {
			vectorLogger.trace('Subcase: selectPositive - infinite selector, valorizing summary');
		}
		const resultSummary = isInfinite ? squash(value) : value.summary.bottom();
		const resultValues = value.known.create(resultKnownPositions);
		const result = value.create({
			length:     adjustedSelector.length,
			known:      resultValues,
			summary:    resultSummary,
			attributes: value.attributes,
			type:       value.type
		});
		return result;
	}

	private buildNegativeSets(
		sourceUpper: number,
		selectorValues: readonly NAAwareDomain<PosIntervalDomain>[],
	): [ mustDeleted: Set<number>, mayDeleted: Set<number> ] {
		const mustDeleted = new Set<number>();
		const mayDeleted = new Set<number>();

		let idxPos = 0;
		for(const idx of selectorValues) {
			guard(idx.isBottom(), `Selector index ${idxPos} is bottom`);

			const innerInterval = idx.inner;
			guard(innerInterval.isValue(), `Selector index ${idxPos} has bottom inner value`);

			const [l, u] = innerInterval.value;
			guard(l <= 0 && u <= 0);

			const posLower = Math.abs(u);
			const posUpper = Math.abs(l);
			if(card(innerInterval) === 1) {
				const pos = posLower;
				if(pos >= 1 && pos <= sourceUpper) {
					mustDeleted.add(pos);
				}
			} else {
				for(let pos = posLower; pos <= posUpper && pos <= sourceUpper; pos++) {
					mayDeleted.add(pos);
				}
			}

			idxPos += 1;
		}

		return [mustDeleted, mayDeleted];
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
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		// 1. Entry logging
		vectorLogger.trace(`applySelectNegative [source length=${value.length.toString()}, selector length=${selector.length.toString()}]`);

		// 2. Early returns
		if(value.isBottom() || selector.isBottom()) {
			vectorLogger.trace('Subcase: selectNegative - bottom input');
			return value.bottom();
		}

		guard(value.length.isValue(), 'Source length is Bottom');
		guard(value.known.isValue(), 'Source known positions are Bottom');

		const sourceLower = value.length.value[0];
		const sourceUpper = value.length.value[1];
		if(sourceUpper === +Infinity) {
			vectorLogger.trace('Subcase: selectNegative - infinite source, returning top');
			return value.top();
		}

		// 3. Compute adjusted selector
		const adjustedSelector = adjustForZeros(selector);
		guard(adjustedSelector.isValue(), 'Adjusted Selector is bottom');
		guard(adjustedSelector.length.isValue(), 'Adjusted Selector is bottom');

		vectorLogger.trace(`Adjusted selector [length=${adjustedSelector.length.toString()}]`);

		// 4. Compute sets from ADJUSTED selector
		let mustDeleted = new Set<number>();
		let mayDeleted = new Set<number>();

		const selectorValues = adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[];
		// Sets construction
		[ mustDeleted, mayDeleted ] = this.buildNegativeSets(sourceUpper, selectorValues);


		// Compute MustNotDeleted
		const mustNotDeleted = new Set<number>();
		for(let i = 1; i <= value.known.value.length; i++) {
			if(!mayDeleted.has(i)) {
				mustNotDeleted.add(i);
			}
		}

		vectorLogger.trace(`Sets computed [mustDeleted=${mustDeleted.size}, mayDeleted=${mayDeleted.size}, mustNotDeleted=${mustNotDeleted.size}]`);

		// Check for non-enumerable positions in adjusted selector
		const hasNonEnumerable = adjustedSelector.known.isValue() &&
			(adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[])
				.some(idx => !isEnumerable(idx.inner));

		// 5. Paragraph 1: At least one non-enumerable position (Paper §4.7, L591-605)
		if(hasNonEnumerable) {
			vectorLogger.debug('Paragraph 1: Non-enumerable position in selector, using SquashExcept');
			const newUpper = Math.max(0, sourceUpper - mustDeleted.size);
			const resultLength = value.length.create([0, newUpper]);
			const resultKnownPositions: NAAwareDomain<Domain>[] = [];

			// prefix_r = [SquashExcept(ν₁, MustDeleted)]_1^(u₁ - |MustDeleted|)
			const squashResult = squashedExcept(value, mustDeleted);
			for(let i = 0; i < newUpper; i++) {
				resultKnownPositions.push(squashResult);
			}

			const result = value.create({
				length:     resultLength,
				known:      value.known.create(resultKnownPositions),
				summary:    value.summary.bottom(),
				attributes: value.attributes,
				type:       value.type
			});
			vectorLogger.trace(`Result [length=${result.length.toString()}, values=${result.known.toString()}]`);
			return result;
		}

		// 6. Paragraphs 2 & 3: All enumerable positions
		// Determine if selector is finite or infinite
		const selectorUpper = adjustedSelector.length.isValue() ? adjustedSelector.length.value[1] : +Infinity;
		const isInfinite = selectorUpper === +Infinity;

		if(isInfinite) {
			vectorLogger.debug('Paragraph 2: Infinite selector, all enumerable');
		} else {
			vectorLogger.debug('Paragraph 3: Finite selector, all enumerable');
		}

		// CountMustDeleted helper
		const countMustDeleted = (i: number) => [...mustDeleted].filter(d => d < i).length;

		// Length computation
		const mustDeletedU1 = [...mustDeleted].filter(d => d <= sourceUpper).length;
		const mayDeletedL1 = [...mayDeleted].filter(d => d <= sourceLower).length;
		const newLower = Math.max(0, sourceLower - mayDeletedL1);
		const newUpper = Math.max(0, sourceUpper - mustDeletedU1);

		// Build prefix
		const resultPrefixSize = Math.min(newUpper, value.known.isValue() ? value.known.value.length : 0);
		const resultKnownPositions: NAAwareDomain<Domain>[] = [];

		// Initialize to bottom
		for(let i = 0; i < resultPrefixSize; i++) {
			resultKnownPositions[i] = value.summary.bottom();
		}

		guard([...mustDeleted].filter(d => d > sourceUpper).length == 0, '');
		guard([...mayDeleted].filter(d => d > sourceUpper).length == 0, '');

		// Process MustNotDeleted positions (ascending)
		for(const i of [...mustNotDeleted].sort((a, b) => a - b)) {

			const accessed = accessPosition(value, i - 1, naValue);
			const targetIdx = i - countMustDeleted(i);
			guard(targetIdx >= 1 && targetIdx <= resultPrefixSize, '!(targetIdx >= 1 && targetIdx <= resultPrefixSize)');

			resultKnownPositions[targetIdx - 1] = resultKnownPositions[targetIdx - 1].join(accessed);
		}

		// Process MayDeleted positions (ascending, excluding mustDeleted)
		for(const i of [...mayDeleted].filter(i => !mustDeleted.has(i)).sort((a, b) => a - b)) {

			const accessed = accessPosition(value, i - 1, naValue);
			const targetIdx = i - countMustDeleted(i);
			guard(targetIdx >= 1 && targetIdx <= resultPrefixSize, '!(targetIdx >= 1 && targetIdx <= resultPrefixSize)');

			resultKnownPositions[targetIdx - 1] = resultKnownPositions[targetIdx - 1].join(accessed);
		}

		// Summary: s₁ for infinite, ⊥ for finite (Paper §4.7, L607-639 vs L641-646)
		const resultSummary = isInfinite ? value.summary : value.summary.bottom();

		const result = value.create({
			length:     value.length.create([newLower, newUpper]),
			known:      value.known.create(resultKnownPositions),
			summary:    resultSummary,
			attributes: value.attributes,
			type:       value.type
		});
		vectorLogger.trace(`Result [length=${result.length.toString()}, values=${result.known.toString()}]`);
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
		selector: VectorDomain<PosIntervalDomain>,
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		vectorLogger.trace(`applySelectLogical [source length=${value.length.toString()}, selector length=${selector.length.toString()}]`);

		if(value.isBottom() || selector.isBottom()) {
			vectorLogger.trace('Subcase: selectLogical - bottom input');
			return value.bottom();
		}
		guard(value.known.isValue(), 'Source is Bottom');
		guard(selector.known.isValue(), 'Selector is Bottom');
		guard(selector.length.isValue(), 'Selector length is Bottom');

		const sourceLen = value.known.value.length;
		const selectorLen = selector.known.value.length;

		if(selectorLen === 0) {
			vectorLogger.trace('Subcase: selectLogical - empty selector');
			return value;
		}

		if(sourceLen === +Infinity || selectorLen === +Infinity) {
			vectorLogger.trace('Subcase: selectLogical - infinite source or selector');
			const result = value.create({
				length:     value.length.create([0, +Infinity]),
				known:      value.known.top(),
				summary:    squash(value),
				attributes: value.attributes,
				type:       value.type
			});
			return result;
		}

		vectorLogger.trace('Subcase: selectLogical - finite source and selector with recycling');
		const maxLen = Math.max(sourceLen, selectorLen);
		const resultKnownPositions: NAAwareDomain<Domain>[] = [];

		const adjustedSelector = rhoF(selector.known, selector.length.value[0], maxLen, selector.factory);
		guard(adjustedSelector.isValue(), 'adjustedSelector is Bottom');
		const plainSelector = adjustedSelector.toArray();
		for(let i = 0; i < selector.known.value.length; i++) {
			const iVal: NAAwareDomain<PosIntervalDomain> = plainSelector[i];
			let sourceVal = NAAwareDomain.bottom(this.factory);

			let [u, l] = [0, 0];
			if(iVal.inner.isValue()) {
				[u, l] = iVal.inner.value;

				if(l == 0 && u == 0) {
					vectorLogger.trace(`Extracted FALSE in position ${i}`);
					continue;
				} else if(u == 1) {
					vectorLogger.trace(`Contained TRUE in position ${i}`);
					const accessed = accessPosition(value, i, naValue);
					vectorLogger.trace(`Accessed value [${accessed}]`);
					sourceVal = sourceVal.join(accessed);
				}
			}

			if(iVal.containsNA()) {
				vectorLogger.trace(`Contained NA in position ${i}`);
				sourceVal = sourceVal.join(naValue);
			}

			guard(sourceVal.isValue(), `Selected position [sourceVal:${sourceVal} value:${sourceVal.value}] not valid`);
			resultKnownPositions.push(sourceVal);
		}

		const isInfinite = selector.length.isValue() && selector.length.value[1] === +Infinity;
		const result = value.create({
			length:     value.length.create([0, resultKnownPositions.length]),
			known:      value.known.create(resultKnownPositions),
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
		naValue: NAAwareDomain<Domain>,
		selectorKind: SelectorKind
	): VectorDomain<Domain> {
		vectorLogger.debug(`Operation: update [selectorKind=${selectorKind}]`);
		vectorLogger.debug(`Operation: update input [value.length=${value.length.toString()}, selector.length=${selector.length.toString()}, values.length=${values.length.toString()}]`);

		if(value.isBottom() || selector.isBottom() || values.isBottom()) {
			vectorLogger.debug('Operation: update returning bottom (input is bottom)');
			return value.bottom();
		}

		// Logical selector: use logical update
		if(selectorKind === 'logical') {
			const result = this.applyUpdateLogical(value, selector as VectorDomain<Domain>, values, naValue);
			vectorLogger.debug(`Operation: update logical result [length=${result.length.toString()}]`);
			return result;
		}

		const numericSelector = selector as VectorDomain<IntervalDomain>;

		if(!numericSelector.known.isValue() || !Array.isArray(numericSelector.known.value)) {
			// Cannot enumerate selector values, apply positive update conservatively
			vectorLogger.debug('Operation: update cannot enumerate selector values, using conservative positive');
			const conservativeSelector = buildPosIntervalSelectorFromSource(numericSelector);
			const result = this.applyUpdatePositive(value, conservativeSelector, values, naValue);
			vectorLogger.debug(`Operation: update conservative result [length=${result.length.toString()}]`);
			return result;
		}

		// Paper Section 4.8: abstract filter classifies selector positions
		const selectorPositions = numericSelector.known.value as readonly NAAwareDomain<IntervalDomain>[];
		const filterResult = VectorDomain.abstractFilter(selectorPositions, numericSelector.factory);
		vectorLogger.debug(`Operation: update filter [positive=${filterResult.positive.length}, negative=${filterResult.negative.length}]`);

		// Handle bottom propagation: if both groups have bottom elements, result is bottom
		if(filterResult.positiveHasBottom && filterResult.negativeHasBottom) {
			vectorLogger.debug('Operation: update returning bottom (both groups have bottom)');
			return value.bottom();
		}

		let result = value.bottom();

		// Build positive selector and apply update_pos (paper Section 4.8)
		if(filterResult.positive.length > 0 && !filterResult.positiveHasBottom) {
			const positiveSelector = buildPosIntervalSelector(numericSelector, filterResult.positive);
			const resultPos = this.applyUpdatePositive(value, positiveSelector, values, naValue);
			vectorLogger.debug(`Operation: update positive result [length=${resultPos.length.toString()}]`);
			result = result.join(resultPos);
		}

		// Build negative selector and apply update_neg (paper Section 4.8)
		if(filterResult.negative.length > 0 && !filterResult.negativeHasBottom) {
			const negativeSelector = buildPosIntervalSelector(numericSelector, filterResult.negative);
			const resultNeg = this.applyUpdateNegative(value, negativeSelector, values, naValue);
			vectorLogger.debug(`Operation: update negative result [length=${resultNeg.length.toString()}]`);
			result = result.join(resultNeg);
		}

		vectorLogger.debug(`Operation: update final result [length=${result.length.toString()}, values=${result.known.toString()}]`);
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
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: updatePositive');
		const adjustedSelector = adjustForZeros(selector);
		const hasNonEnumerable = adjustedSelector.known.isValue() && (adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[]).some(idx => !isEnumerable(idx.inner));
		if(hasNonEnumerable) {
			vectorLogger.trace('Subcase: updatePositive - non-enumerable selector, using squash');
			const vAll = squash(value).join(squash(values));
			const result = value.create({
				length:     value.length.create([value.length.isValue() ? value.length.value[0] : 0, +Infinity]),
				known:      value.known.create([]),
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
			vectorLogger.trace('Subcase: updatePositive - infinite selector');
			const summaryInner = adjustedSelector.summary.inner;
			const selectorSummaryEnumerable = summaryInner !== undefined ? isEnumerable(summaryInner) : false;
			const summaryLower = summaryInner !== undefined && summaryInner.isValue() ? summaryInner.value[0] : 0;
			const uR = Math.max(selectorUpper === +Infinity ? 0 : selectorUpper, summaryLower);
			const selectorKnownPositions = adjustedSelector.known.isValue() ? (adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[]) : [];
			const baseKnownPositions = initKnownPositions(selectorKnownPositions as unknown as NAAwareDomain<Domain>[], sourceLower, sourceUpper, uR, naValue);
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
					resultKnownPositions[i] = resultKnownPositions[i].join(squashValuesInner !== undefined ? squashValues : naValue.top());
				}
			}
			const resultSummary = value.summary.join(squash(values));
			const result = value.create({
				length:     value.length.create([sourceLower, +Infinity]),
				known:      value.known.create(resultKnownPositions),
				summary:    resultSummary,
				attributes: value.attributes,
				type:       value.type
			});
			return result;
		} else {
			vectorLogger.trace('Subcase: updatePositive - finite selector');
			let uR = 0;
			if(adjustedSelector.known.isValue()) {
				const selectorKnownPositions = adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[];
				for(const idx of selectorKnownPositions) {
					if(idx.inner.isValue()) {
						uR = Math.max(uR, idx.inner.value[1]);
					}
				}
			}
			uR = Math.max(uR, sourceUpper);
			const selectorKnownPositions = adjustedSelector.known.isValue() ? (adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[]) : [];
			const baseKnownPositions = initKnownPositions(selectorKnownPositions as unknown as NAAwareDomain<Domain>[], sourceLower, sourceUpper, uR, naValue);
			let valuesUpper = 0;
			if(values.length.isValue()) {
				valuesUpper = values.length.value[1];
			}
			const cyclicValues = generateCyclicKnownPositions(values, Math.max(selectorUpper, valuesUpper));
			const resultKnownPositions = updateKnownPositions(baseKnownPositions, selectorKnownPositions, cyclicValues);
			const result = value.create({
				length:     value.length.create([sourceLower, uR]),
				known:      value.known.create(resultKnownPositions),
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
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		// 1. Entry logging
		vectorLogger.trace(`applyUpdateNegative [source length=${value.length.toString()}, selector length=${selector.length.toString()}]`);

		// 2. Guard: bottom inputs
		if(value.isBottom() || selector.isBottom() || values.isBottom()) {
			vectorLogger.trace('Subcase: updateNegative - bottom input');
			return value.bottom();
		}

		// 3. Guard: extract source length bounds
		let sourceLower = 0;
		let sourceUpper = 0;
		if(value.length.isValue()) {
			sourceLower = value.length.value[0];
			sourceUpper = value.length.value[1];
			// 4. Guard: infinite source
			if(sourceUpper === +Infinity) {
				vectorLogger.trace('Subcase: updateNegative - infinite source, returning top');
				return value.top();
			}
		} else {
			vectorLogger.trace('Subcase: updateNegative - non-value source length, returning bottom');
			return value.bottom();
		}

		// 5. Compute adjusted selector
		const adjustedSelector = adjustForZeros(selector);
		vectorLogger.trace(`Adjusted selector [length=${adjustedSelector.length.toString()}]`);

		// 6. Compute MustNotUpdated set (Paper §4.8.2, lines 934-936)
		// Positions definitely NOT updated: card(p) = 1 and valid positive index in [1, u₁]
		const mustNotUpdated = new Set<number>();
		// 7. Compute MayNotUpdated set (Paper §4.8.2, lines 938-944)
		// Positions possibly NOT updated (non-singleton intervals or from summary)
		const mayNotUpdated = new Set<number>();

		if(adjustedSelector.known.isValue()) {
			const selectorKnownPositions = adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[];
			for(const idx of selectorKnownPositions) {
				if(idx.isBottom()) {
					continue;
				}
				if(idx.isNA()) {
					// NA in selector means the position is unknown
					for(let pos = 1; pos <= sourceUpper; pos++) {
						mayNotUpdated.add(pos);
					}
					continue;
				}
				const innerInterval = idx.inner;
				if(innerInterval.isValue()) {
					const [l, u] = innerInterval.value;
					// Negative indices: must be in range [-u₁, -1] to be valid
					if(l <= 0 && u <= 0) {
						const posLower = Math.abs(u); // |u| is smaller absolute value
						const posUpper = Math.abs(l); // |l| is larger absolute value
						if(card(innerInterval) === 1) {
							// Singleton: definitely this position
							const pos = posLower;
							if(pos >= 1 && pos <= sourceUpper) {
								mustNotUpdated.add(pos);
							}
						} else {
							// Non-singleton interval: range of possible positions
							for(let pos = posLower; pos <= posUpper && pos <= sourceUpper; pos++) {
								mayNotUpdated.add(pos);
							}
						}
					}
				} else {
					// Top interval: all positions may be not updated
					for(let pos = 1; pos <= sourceUpper; pos++) {
						mayNotUpdated.add(pos);
					}
				}
			}
		} else {
			// adjustedSelector.known is Bot: all positions may be not updated
			for(let pos = 1; pos <= sourceUpper; pos++) {
				mayNotUpdated.add(pos);
			}
		}

		// 8. Compute MustUpdated set (Paper §4.8.2, lines 946-948)
		// Positions definitely updated: [1, |prefix₁|] \ (MustNotUpdated ∪ MayNotUpdated)
		const mustUpdated = new Set<number>();
		const prefixLength = value.known.isValue() ? value.known.value.length : 0;
		for(let i = 1; i <= Math.min(prefixLength, sourceUpper); i++) {
			if(!mustNotUpdated.has(i) && !mayNotUpdated.has(i)) {
				mustUpdated.add(i);
			}
		}

		vectorLogger.trace(`Sets computed [mustNotUpdated=${mustNotUpdated.size}, mayNotUpdated=${mayNotUpdated.size}, mustUpdated=${mustUpdated.size}]`);

		// 9. Check for non-enumerable positions in adjusted selector
		const hasNonEnumerable = adjustedSelector.known.isValue() &&
			(adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[])
				.some(idx => !idx.isNA() && !idx.isBottom() && !isEnumerable(idx.inner));

		// 10. Paragraph 1: At least one non-enumerable position (Paper §4.8.2, lines 953-975)
		if(hasNonEnumerable) {
			vectorLogger.debug('Paragraph 1: Non-enumerable position in selector, using weak update');
			const v = squash(values);
			const sourceKnownPositions = value.known.isValue()
				? (value.known.value as readonly NAAwareDomain<Domain>[])
				: [];
			const resultKnownPositions: NAAwareDomain<Domain>[] = [];

			// Initialize to prefix₁, then weakly update positions not in MustNotUpdated
			for(let i = 1; i <= sourceUpper; i++) {
				const idx = i - 1;
				let val: NAAwareDomain<Domain>;
				if(idx < sourceKnownPositions.length) {
					val = sourceKnownPositions[idx];
				} else {
					val = value.summary;
				}
				// Weakly update: join with v if not definitely not updated
				if(!mustNotUpdated.has(i)) {
					val = val.join(v);
				}
				resultKnownPositions.push(val);
			}

			// Summary: if u₁ = +∞, update as s_r = s₁ ⊔ v
			const resultSummary = sourceUpper === +Infinity ? value.summary.join(v) : value.summary;

			const result = value.create({
				length:     value.length,
				known:      value.known.create(resultKnownPositions),
				summary:    resultSummary,
				attributes: value.attributes,
				type:       value.type
			});
			vectorLogger.trace(`Result [length=${result.length.toString()}]`);
			return result;
		}

		// 11. Paragraphs 2 & 3: All enumerable positions
		// Determine if selector is finite or infinite
		const selectorUpper = adjustedSelector.length.isValue() ? adjustedSelector.length.value[1] : +Infinity;
		const isInfinite = selectorUpper === +Infinity;

		if(isInfinite) {
			// 12. Paragraph 2: Infinite selector, all enumerable (Paper §4.8.2, lines 977-1015)
			vectorLogger.debug('Paragraph 2: Infinite selector, all enumerable, building positive selector');

			// Build positive selector from MustUpdated and MayNotUpdated
			// Length: [lᵣ, uᵣ] = [|MustUpdated_{l₁}|, u₁ - |MustNotUpdated_{u₁}|]
			const mustUpdatedCount = [...mustUpdated].filter(i => i >= sourceLower).length;
			const mustNotUpdatedCount = [...mustNotUpdated].filter(i => i <= sourceUpper).length;
			const resultLengthLower = mustUpdatedCount;
			const resultLengthUpper = sourceUpper - mustNotUpdatedCount;

			// Build selector prefix
			const selectorPrefixPositions: NAAwareDomain<PosIntervalDomain>[] = [];

			// CountMustNotUpdated helper: count positions < i
			const countMustNotUpdated = (i: number) => [...mustNotUpdated].filter(p => p < i).length;

			// For each position in MustUpdated (ascending)
			for(const i of [...mustUpdated].sort((a, b) => a - b)) {
				const targetIdx = i - countMustNotUpdated(i);
				// Ensure selectorPrefixPositions has enough room
				while(selectorPrefixPositions.length < targetIdx) {
					selectorPrefixPositions.push(new NAAwareDomain<PosIntervalDomain>({
						inner: PosIntervalDomain.bottom(),
						hasNA: false
					}, adjustedSelector.summary.factory as import('./vector-domain').DomainFactory<PosIntervalDomain>));
				}
				if(targetIdx >= 1) {
					selectorPrefixPositions[targetIdx - 1] = new NAAwareDomain<PosIntervalDomain>({
						inner: new PosIntervalDomain([i, i]),
						hasNA: false
					}, adjustedSelector.summary.factory as import('./vector-domain').DomainFactory<PosIntervalDomain>);
				}
			}

			// For each position in MayNotUpdated (ascending, excluding MustNotUpdated)
			for(const i of [...mayNotUpdated].filter(i => !mustNotUpdated.has(i)).sort((a, b) => a - b)) {
				if(i > sourceUpper) {
					continue;
				}
				const targetIdx = i - countMustNotUpdated(i);
				while(selectorPrefixPositions.length < targetIdx) {
					selectorPrefixPositions.push(new NAAwareDomain<PosIntervalDomain>({
						inner: PosIntervalDomain.bottom(),
						hasNA: false
					}, adjustedSelector.summary.factory as import('./vector-domain').DomainFactory<PosIntervalDomain>));
				}
				if(targetIdx >= 1) {
					const existing = selectorPrefixPositions[targetIdx - 1];
					selectorPrefixPositions[targetIdx - 1] = existing.join(new NAAwareDomain<PosIntervalDomain>({
						inner: new PosIntervalDomain([i, i]),
						hasNA: false
					}, adjustedSelector.summary.factory as import('./vector-domain').DomainFactory<PosIntervalDomain>));
				}
			}

			// Build selector vector
			const positiveSelector = value.create({
				length:     new PosIntervalDomain([resultLengthLower, resultLengthUpper]),
				known:      adjustedSelector.known.create(selectorPrefixPositions),
				summary:    adjustedSelector.summary,
				attributes: adjustedSelector.attributes,
				type:       adjustedSelector.type
			}) as unknown as VectorDomain<PosIntervalDomain>;

			// Call applyUpdatePositive
			const result = this.applyUpdatePositive(value, positiveSelector, values, naValue);
			vectorLogger.trace(`Result [length=${result.length.toString()}]`);
			return result;
		} else {
			// 13. Paragraph 3: Finite selector, all enumerable (Paper §4.8.2, lines 1017-1026)
			vectorLogger.debug('Paragraph 3: Finite selector, all enumerable');

			// uᵣ = max(u₁, u₂')
			const uR = Math.max(sourceUpper, selectorUpper);

			// Generate cyclic values: prefix₃' = ρ_f^♯(ν₃, l₃, uᵣ)
			let valuesUpper = 0;
			if(values.length.isValue()) {
				valuesUpper = values.length.value[1];
			}
			const cyclicValues = generateCyclicKnownPositions(values, Math.max(selectorUpper, valuesUpper));

			// Build base positions from source
			const sourceKnownPositions = value.known.isValue()
				? (value.known.value as readonly NAAwareDomain<Domain>[])
				: [];
			const resultKnownPositions: NAAwareDomain<Domain>[] = [];

			for(let i = 0; i < uR; i++) {
				if(i < sourceKnownPositions.length) {
					resultKnownPositions.push(sourceKnownPositions[i]);
				} else if(i < sourceUpper) {
					resultKnownPositions.push(value.summary);
				} else {
					resultKnownPositions.push(naValue);
				}
			}

			// Update positions that are not in MustNotUpdated or MayNotUpdated
			// (i.e., positions that are definitely being updated)
			const notUpdatedPositions = new Set([...mustNotUpdated, ...mayNotUpdated]);
			for(let i = 1; i <= uR; i++) {
				if(!notUpdatedPositions.has(i)) {
					const idx = i - 1;
					const valueIdx = (i - 1) % cyclicValues.length;
					resultKnownPositions[idx] = cyclicValues[valueIdx];
				}
			}

			// Result length: [l₁, uᵣ], summary: ⊥
			const result = value.create({
				length:     value.length.create([sourceLower, uR]),
				known:      value.known.create(resultKnownPositions),
				summary:    value.summary.bottom(),
				attributes: value.attributes,
				type:       value.type
			});
			vectorLogger.trace(`Result [length=${result.length.toString()}]`);
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
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: updateLogical');
		if(value.isBottom() || selector.isBottom() || values.isBottom()) {
			vectorLogger.trace('Subcase: updateLogical - bottom input');
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
		if(isInfinite) {
			vectorLogger.trace('Subcase: updateLogical - infinite selector');
		} else {
			vectorLogger.trace('Subcase: updateLogical - finite selector');
		}
		const sourceKnownPositions = value.known.isValue() ? (value.known.value as readonly NAAwareDomain<Domain>[]) : [];
		const selectorKnownPositions = selector.known.isValue() ? (selector.known.value as readonly NAAwareDomain<Domain>[]) : [];
		const maxLen = Math.max(sourceKnownPositions.length, selectorKnownPositions.length);
		const resultKnownPositions: NAAwareDomain<Domain>[] = [];
		for(let i = 0; i < maxLen; i++) {
			if(i < sourceKnownPositions.length) {
				resultKnownPositions.push(sourceKnownPositions[i]);
			} else if(i < sourceUpper) {
				resultKnownPositions.push(value.summary);
			} else {
				resultKnownPositions.push(naValue);
			}
		}
		const cyclicValues = generateCyclicKnownPositions(values, selectorUpper);
		for(let i = 0; i < maxLen && i < cyclicValues.length; i++) {
			let selectorVal: NAAwareDomain<Domain>;
			if(i < selectorKnownPositions.length) {
				selectorVal = selectorKnownPositions[i];
			} else if(i < selectorKnownPositions.length + (selector.summary.isValue() ? 1 : 0)) {
				selectorVal = selector.summary;
			} else {
				selectorVal = selector.summary.top();
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
			known:      value.known.create(resultKnownPositions),
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
	if(source.known.isValue() && Array.isArray(source.known.value)) {
		positions = (source.known.value as readonly NAAwareDomain<IntervalDomain>[]).map(convertNAAware);
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
