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
	accessPosition,
	rhoF
} from './vector-semantics';
import { NA, Top, Bottom } from '../domains/lattice';
import { IntervalDomain } from '../domains/interval-domain';
import { PosIntervalDomain } from '../domains/positive-interval-domain';
import type { VectorAttrDomain } from '../domains/vector-attr-domain';
import { type ValueToDomainConverter, buildVectorFromLiteral } from './resolve-vector-args';
import type { RNumber } from '../../r-bridge/lang-4.x/ast/model/nodes/r-number';
import type { RString } from '../../r-bridge/lang-4.x/ast/model/nodes/r-string';
import type { RLogical } from '../../r-bridge/lang-4.x/ast/model/nodes/r-logical';
import type { RSymbol } from '../../r-bridge/lang-4.x/ast/model/nodes/r-symbol';
import { FunctionArgument as FunctionArgumentUtil } from '../../dataflow/graph/graph';
import { EmptyArgument } from '../../r-bridge/lang-4.x/ast/model/nodes/r-function-call';
import { VertexType } from '../../dataflow/graph/vertex';
import { RType } from '../../r-bridge/lang-4.x/ast/model/type';
import { Identifier } from '../../dataflow/environments/identifier';
import { RAccess } from '../../r-bridge/lang-4.x/ast/model/nodes/r-access';
import { RArgument } from '../../r-bridge/lang-4.x/ast/model/nodes/r-argument';
import type { RBinaryOp } from '../../r-bridge/lang-4.x/ast/model/nodes/r-binary-op';
import type { RUnaryOp } from '../../r-bridge/lang-4.x/ast/model/nodes/r-unary-op';
import { KnownInitialPositionsDomain } from './known-initial-positions-domain';
import { guard } from '../../util/assert';
import { expensiveTrace } from '../../util/log';

type VectorFunctionType = 'concatenate' | 'arithmetic' | 'length' | 'random' | 'unknown';

type VectorOperationName = 'setAttr' | 'recycle' | 'concatenate' | 'select' | 'update' | 'negate' | 'unknown';

interface VectorOperation<Domain extends AnyAbstractDomain, Name extends VectorOperationName = VectorOperationName> {
	operation:     Name;
	operand:       VectorDomain<Domain> | undefined;
	[key: string]: unknown;
}

type VectorOperations<Domain extends AnyAbstractDomain> = VectorOperation<Domain>[];

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
	private readonly operations?:    Map<NodeId, VectorOperations<Domain>>;
	private readonly plainFactory:   DomainFactory<Domain>;
	private readonly naAwareFactory: DomainFactory<NAAwareDomain<Domain>>;
	private readonly valueConverter: ValueToDomainConverter<Domain>;

	constructor(
		factory: DomainFactory<Domain>,
		valueConverter: ValueToDomainConverter<Domain>,
		{ trackOperations = true, ...config }: VectorInferenceConfiguration
	) {
		super(config, VectorDomain.top(factory));
		this.plainFactory = factory;
		this.naAwareFactory = NAAwareDomain.createSmartFactory(factory);
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
	public getAbstractOperations(id: NodeId | undefined): Readonly<VectorOperations<Domain>> | undefined {
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
		if(['runif', 'rnorm', 'rbinom', 'rexp', 'rpois'].includes(functionName)) {
			vectorLogger.debug(`Decision: function type 'random' for node type '${node.type}'`);
			return 'random';
		}

		vectorLogger.debug(`Decision: function type 'unknown' for node type '${node.type}' (functionName='${functionName}')`);
		return 'unknown';
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
	private handleConcatenate(node: RNode<ParentInformation>, call: DataflowGraphVertexFunctionCall): VectorOperations<Domain> {
		const args = this.resolveVectorArguments(call);

		vectorLogger.debug(`Handler: handleConcatenate [argCount=${args.length}]`);
		for(const arg of args) {
			if(arg.resolved) {
				vectorLogger.debug(`Handler: handleConcatenate arg [id=${arg.id}, length=${arg.resolved.length.toString()}, values=${arg.resolved.known.toString()}]`);
			} else {
				vectorLogger.debug(`Handler: handleConcatenate arg [id=${arg.id}, resolved=undefined]`);
			}
		}

		// Handle empty concatenate c() - returns empty vector
		// Paper: genvecalpha(rEmpty) = ([0,0], ε, genvalbot, attrbot)
		if(args.length === 0) {
			const emptyVector = VectorDomain.empty(this.plainFactory);
			return [{ operation: 'concatenate', operand: emptyVector }];
		}

		if(args.length === 1) {
			return [{ operation: 'concatenate', operand: args[0].resolved }];
		}

		const operations: VectorOperations<Domain> = [];

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
	private handleArithmetic(node: RNode<ParentInformation>, call: DataflowGraphVertexFunctionCall): VectorOperations<Domain> {
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
				return this.unknownOperation();
			}
			// For unary minus, we need to negate the value
			const operandValue = this.getVectorDomainValue(lhsId);
			if(operandValue?.isValue() && node.operator === '-') {
				vectorLogger.debug(`Handler: handleArithmetic unary minus with value [length=${operandValue.length.toString()}]`);
				// The operand has a concrete value, negate it
				return [{ operation: 'negate', operand: operandValue }];
			}
			vectorLogger.debug(`Handler: handleArithmetic unary - not handling [hasValue=${operandValue?.isValue()}, operator=${node.operator}]`);
			return this.unknownOperation();
		}

		if(lhsId === undefined) {
			vectorLogger.debug('Handler: handleArithmetic binary - no lhsId');
			return this.unknownOperation();
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
	private handleLength(): VectorOperations<Domain> {
		return this.unknownOperation();
	}

	/**
	 * Handles random number generation functions (runif, rnorm, etc.).
	 * Returns a VectorDomain with known length but ⊤ values.
	 * @param node - The R node of the function call
	 * @param call - The function call vertex from the dataflow graph
	 * @returns The mapped vector operations sequence
	 */
	private handleRandomFunction(node: RNode<ParentInformation>, call: DataflowGraphVertexFunctionCall): VectorOperations<Domain> {
		const args = this.resolveVectorArguments(call);

		vectorLogger.debug(`Handler: handleRandomFunction [argCount=${args.length}]`);

		// Get the first argument (n = number of values to generate)
		let _lengthDomain: PosIntervalDomain;
		if(args.length > 0 && args[0].resolved?.length.isValue()) {
			// First argument is a concrete number - use it as exact length
			const len = args[0].resolved.length;
			if(len.isValue()) {
				_lengthDomain = new PosIntervalDomain([len.value[0], len.value[1]]);
			} else {
				_lengthDomain = PosIntervalDomain.top();
			}
		} else {
			// Conservative: unknown length
			_lengthDomain = PosIntervalDomain.top();
		}

		// Build a VectorDomain with ⊤ values (any double)
		// The actual values are unknown, so we return a vector with the right length
		// but ⊤ values that will be stored via applyVectorExpression
		const topVector = VectorDomain.top(this.plainFactory);

		return [{ operation: 'concatenate', operand: topVector }];
	}

	// ==================== Access and Replacement Handlers ====================

	/**
	 * Handles vector access operations (x[i]).
	 * @param node - The R access node representing the vector
	 * @returns The mapped vector operations sequence for selection
	 */
	private handleAccess(node: RNode<ParentInformation>): VectorOperations<Domain> {
		if(!RAccess.is(node)) {
			return this.unknownOperation();
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

			const resolvedOperand = operand !== undefined ? this.getVectorDomainValue(operand) : undefined;
			// Compute selector kind from the operand's type (logical vs numeric)
			const selectorKind = resolvedOperand?.type.getType() === 'logical' ? 'logical' : 'numeric';

			vectorLogger.debug(`Handler: handleAccess [operandId=${operand}, selectorId=${selector}, selectorKind=${selectorKind}]`);
			if(resolvedOperand) {
				vectorLogger.debug(`Handler: handleAccess operand value [length=${resolvedOperand.length.toString()}, values=${resolvedOperand.known.toString()}, summary=${resolvedOperand.summary.toString()}]`);
			}

			return [{
				operation: 'select',
				operand:   resolvedOperand,
				selector:  selector !== undefined ? String(selector) : undefined
			}];
		}

		// Two arguments: x[i, j] - matrix/array access (not supported yet)
		vectorLogger.debug(`Handler: handleAccess matrix access (not supported) [argCount=${args.length}]`);
		return this.unknownOperation();
	}

	/**
	 * Handles vector replacement operations (x[i] \&lt;- v).
	 * @param node - The R access node representing the target vector
	 * @param source - The R node representing the value being assigned
	 * @returns The mapped vector operations sequence for update
	 */
	private handleReplacement(node: RNode<ParentInformation>, source: RNode<ParentInformation> | undefined): VectorOperations<Domain> {
		if(!RAccess.is(node)) {
			return this.unknownOperation();
		}

		const access = node;
		const args = access.access;

		if(args.length === 1) {
			const accessedNode = access.accessed;
			const operand = accessedNode?.info.id;
			const selectorArg = args[0];
			const selector = selectorArg !== '<>' ? selectorArg?.info.id : undefined;
			const values = source?.info.id;

			const resolvedOperand = operand !== undefined ? this.getVectorDomainValue(operand) : undefined;
			const resolvedValues = values !== undefined ? this.getVectorDomainValue(values) : undefined;
			// Compute selector kind from the operand's type (logical vs numeric)
			const selectorKind = resolvedOperand?.type.getType() === 'logical' ? 'logical' : 'numeric';

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
				values:    values !== undefined ? String(values) : undefined
			}];
		}

		vectorLogger.debug(`Handler: handleReplacement matrix access (not supported) [argCount=${args.length}]`);
		return this.unknownOperation();
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
		let operations: VectorOperations<Domain>;

		switch(funcType) {
			case 'concatenate': {
				const vertexInfo = this.config.dfg.get(node.info.id);
				if(vertexInfo === undefined) {
					operations = this.unknownOperation();
				} else {
					const [callVertex] = vertexInfo;
					if(callVertex?.tag !== VertexType.FunctionCall) {
						operations = this.unknownOperation();
					} else {
						operations = this.handleConcatenate(node, callVertex);
					}
				}
				break;
			}
			case 'arithmetic': {
				const vertexInfo = this.config.dfg.get(node.info.id);
				if(vertexInfo === undefined) {
					operations = this.unknownOperation();
				} else {
					const [callVertex] = vertexInfo;
					if(callVertex?.tag !== VertexType.FunctionCall) {
						operations = this.unknownOperation();
					} else {
						operations = this.handleArithmetic(node, callVertex);
					}
				}
				break;
			}
			case 'length':
				operations = this.handleLength();
				break;
			case 'random': {
				const vertexInfo = this.config.dfg.get(node.info.id);
				if(vertexInfo === undefined) {
					operations = this.unknownOperation();
				} else {
					const [callVertex] = vertexInfo;
					if(callVertex?.tag !== VertexType.FunctionCall) {
						operations = this.unknownOperation();
					} else {
						operations = this.handleRandomFunction(node, callVertex);
					}
				}
				break;
			}
			case 'unknown':
			default:
				vectorLogger.warn(`Unknown function type '${funcType}' in onFunctionCall [nodeId=${call.id}]`);
				operations = this.unknownOperation();
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
		const vectorDomain = buildVectorFromLiteral(node, this.plainFactory, this.valueConverter);
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
		const vectorDomain = buildVectorFromLiteral(node, this.plainFactory, this.valueConverter);
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
		const vectorDomain = buildVectorFromLiteral(node, this.plainFactory, this.valueConverter);
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
		const vectorDomain = buildVectorFromLiteral(node, this.plainFactory, this.valueConverter);
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
	private applyVectorExpression(node: RNode<ParentInformation>, operations: VectorOperations<Domain>): void {
		vectorLogger.debug(`Operation: applyVectorExpression [nodeId=${node.info.id}, operations=${operations.length}]`);
		if(operations.length === 0 || operations[0].operation === 'unknown') {
			return;
		} else if(this.operations !== undefined) {
			this.operations.set(node.info.id, operations);
		}

		let value: VectorDomain<Domain> = VectorDomain.bottom(this.plainFactory);

		const naValue = this.naAwareFactory(NA);

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
				effectiveOperand,
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
			resolved.selector = selectorValue ?? VectorDomain.bottom(this.plainFactory);
		}

		if('values' in args && typeof args.known === 'string') {
			const valuesId = Number(args.known) as NodeId;
			const valuesValue = this.getVectorDomainValue(valuesId);
			resolved.values = valuesValue ?? VectorDomain.bottom(this.plainFactory);
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
					args.selector as VectorDomain<IntervalDomain>,
					args.naValue as NAAwareDomain<Domain>,
				);
			case 'update':
				guard(args.values != undefined, 'args.known undefined');
				return this.applyUpdate(value,
					args.selector as VectorDomain<IntervalDomain>,
					args.values as VectorDomain<Domain>,
					args.naValue as NAAwareDomain<Domain>
				);
			case 'negate':
				return this.applyNegate(value);
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
	 * Applies the negate operation to a vector.
	 * Negates each known position and the summary, preserving length/attributes/type.
	 * @param value - The VectorDomain to negate
	 * @returns The resulting VectorDomain after negation
	 */
	private applyNegate(value: VectorDomain<Domain>): VectorDomain<Domain> {
		vectorLogger.debug('Operation: negate');

		if(value.isBottom()) {
			vectorLogger.debug('Operation: negate returning bottom');
			return value.bottom();
		}
		if(value.isTop()) {
			vectorLogger.debug('Operation: negate returning top');
			return value.top();
		}

		// Negate known positions
		let negatedKnown: typeof value.known;
		if(value.known.isBottom()) {
			negatedKnown = value.known.bottom();
		} else if(value.known.isTop()) {
			negatedKnown = value.known.top();
		} else if(value.known.isValue()) {
			const values = value.known.value as readonly NAAwareDomain<Domain>[];
			const negatedValues = values.map(v => v.negate());
			negatedKnown = value.known.create(negatedValues);
		} else {
			negatedKnown = value.known.top();
		}

		// Negate summary
		let negatedSummary: typeof value.summary;
		if(value.summary.isBottom()) {
			negatedSummary = value.summary.bottom();
		} else if(value.summary.isTop()) {
			negatedSummary = value.summary.top();
		} else {
			negatedSummary = value.summary.negate();
		}

		const result = value.create({
			length:     value.length,
			known:      negatedKnown,
			summary:    negatedSummary,
			attributes: value.attributes,
			type:       value.type
		});

		vectorLogger.debug(`Operation: negate result [length=${result.length.toString()}, values=${result.known.toString()}]`);
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
	 * @returns The resulting VectorDomain after selection
	 */
	private applySelect(
		value: VectorDomain<Domain>,
		selector: VectorDomain<IntervalDomain>,
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		// Derive selector kind from the selector's type (logical vs numeric)
		const selectorKind = selector.type.getType() === 'logical' ? 'logical' : 'numeric';
		vectorLogger.debug(`Operation: select [selectorKind=${selectorKind}]`);
		vectorLogger.debug(`Operation: select input [value.length=${value.length.toString()}, value.known=${value.known.toString()}, selector.length=${selector.length.toString()}]`);

		// INVARIANT 1: Bottom Propagation
		// If either source vector or selector is Bottom, return Bottom
		if(value.isBottom() || selector.isBottom()) {
			vectorLogger.debug('Operation: select returning bottom (input is bottom)');
			return value.bottom();
		}

		// INVARIANT 2: Empty Selector
		// If selector is empty (length = [0, 0]), return source vector unchanged
		// Paper Section 4.7 (L498-503): rSelectSharp(ν1, genvecalpha(rEmpty)) = ν1
		const isEmptySelector = selector.length.isValue() &&
			selector.length.value[0] === 0 &&
			selector.length.value[1] === 0;
		if(isEmptySelector) {
			vectorLogger.debug('Operation: select with empty selector, returning source vector');
			return value;
		}

		// INVARIANT 3: Selector Kind Detection
		// Determine selector kind (logical or numeric) based on selector's type
		if(selectorKind === 'logical') {
			const result = this.applySelectLogical(value, selector, naValue);
			vectorLogger.debug(`Operation: select logical result [length=${result.length.toString()}, values=${result.known.toString()}]`);
			return result;
		}

		// INVARIANT 4: No Early Return on Top
		// Do NOT handle Top selector with immediate return. Top selector means indices could be anything.
		// Logical vs numeric selection have completely different behaviors.
		// Top selector must be filtered by abstractFilter into positive/negative/logical components.

		// Numeric Selector: Use abstract filtering to classify positions
		const numericSelector = selector;

		// If selector values cannot be enumerated, use conservative positive selector
		if(!numericSelector.known.isValue() || !Array.isArray(numericSelector.known.value)) {
			vectorLogger.debug('Operation: select cannot enumerate selector values, using conservative positive');
			const conservativeSelector = buildPosIntervalSelectorFromSource(numericSelector);
			const result = this.applySelectPositive(value, conservativeSelector, naValue);
			vectorLogger.debug(`Operation: select conservative result [length=${result.length.toString()}]`);
			return result;
		}

		// Check if selector is all zeros (will become empty after adjustForZeros)
		// In this case, return empty vector
		const selectorValues = numericSelector.known.value as readonly NAAwareDomain<IntervalDomain>[];
		const allZeros = selectorValues.every(pos => {
			if(!pos.isValue() || !pos.inner.isValue()) {
				return false;
			}
			const [l, u] = pos.inner.value;
			return l === 0 && u === 0;
		});
		if(allZeros) {
			vectorLogger.debug('Operation: select with all-zero selector, returning empty vector');
			return value.create({
				length:     value.length.create([0, 0]),
				known:      value.known.create([]),
				summary:    value.summary.bottom(),
				attributes: value.attributes,
				type:       value.type
			});
		}

		// Paper Section 4.7: abstract filter classifies selector positions
		const filterResult = VectorDomain.abstractFilter(selectorValues, numericSelector.plainFactory);
		vectorLogger.debug(`Operation: select filter [positive=${filterResult.positive.length}, negative=${filterResult.negative.length}, posBottom=${filterResult.positiveHasBottom}, negBottom=${filterResult.negativeHasBottom}]`);

		// Handle bottom propagation: if both groups have bottom elements, result is bottom
		if(filterResult.positiveHasBottom && filterResult.negativeHasBottom) {
			vectorLogger.debug('Operation: select returning bottom (both groups have bottom)');
			return value.bottom();
		}

		let result = value.bottom();

		// INVARIANT 5: Positive Selector Filtering
		// Ensure selector contains only non-negative positions or NA before calling applySelectPositive
		if(filterResult.positive.length > 0 && !filterResult.positiveHasBottom) {
			const positiveSelector = buildPosIntervalSelector(numericSelector, filterResult.positive);
			const resultPos = this.applySelectPositive(value, positiveSelector, naValue);
			vectorLogger.debug(`Operation: select positive result [length=${resultPos.length.toString()}]`);
			result = result.join(resultPos);
		}

		// INVARIANT 6: Negative Selector Filtering
		// Ensure selector contains only non-positive positions (no NA) before calling applySelectNegative
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
	 * Applies positive indexing selection: x[c] where c >= 0.
	 * Preconditions (guaranteed by dispatcher):
	 * - value is not Bottom
	 * - selector is not Bottom
	 * - selector contains only non-negative positions or NA
	 *
	 * Postconditions:
	 * - Result length is determined by selector length
	 * - Result summary is ⊥ for finite selectors, Squash(value) for infinite
	 * - Result attributes are preserved from source
	 * @param value - The source VectorDomain to select from (not Bottom)
	 * @param selector - The selector VectorDomain with positive intervals (not Bottom)
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

		// Adjust selector for zeros: removes zero indices and adjusts length bounds
		const adjustedSelector = adjustForZeros(selector);
		vectorLogger.debug(`  adjustedSelector [length=${adjustedSelector.length.toString()}, values=${adjustedSelector.known.toString()}]`);

		// Empty selector after adjusting for zeros - return empty vector
		// In positive selection, empty selector means no positions are selected
		if(adjustedSelector.length.isValue()) {
			const [newL, newU] = adjustedSelector.length.value;
			if(newL === 0 && newU === 0) {
				vectorLogger.debug('Operation: selectPositive - empty selector, returning empty vector');
				// Return vector with empty length and no known positions
				return value.create({
					length:     adjustedSelector.length,
					known:      value.known.create([]),
					summary:    value.summary.bottom(),
					attributes: value.attributes,
					type:       value.type
				});
			}
		}

		const resultKnownPositions: NAAwareDomain<Domain>[] = [];
		if(adjustedSelector.known.isValue() && Array.isArray(adjustedSelector.known.value)) {
			const selectorValues = adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[];

			let idxNumber = 0;
			for(const idx of selectorValues) {
				// Precondition: dispatcher guarantees selector positions are not bottom
				// No redundant check needed here

				const innerInterval = idx.inner;
				if(isEnumerable(innerInterval)) {
					if(innerInterval.isValue()) {
						const [l, u] = innerInterval.value;
						vectorLogger.trace(`Subcase: selectPositive - enumerable interval [${l}, ${u}]`);
						let joinedAccessed: NAAwareDomain<Domain> | undefined;
						// After adjustForZeros, all positions are guaranteed to be > 0
						// No zero-to-one conversion needed
						for(let pos = l; pos <= u; pos++) {
							if(pos > 0) {
								const accessed = accessPosition(value, pos - 1, naValue);
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

		// Determine if selector is infinite
		const selectorLen = adjustedSelector.length;
		const isInfinite = selectorLen.isValue() && selectorLen.value[1] === +Infinity;
		if(isInfinite) {
			vectorLogger.trace('Subcase: selectPositive - infinite selector, valorizing summary');
		}

		// Summary: ⊥ for finite selectors, Squash(value) for infinite
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
			guard(!idx.isBottom(), `Selector index ${idxPos} is bottom`);

			const innerInterval = idx.inner;
			guard(innerInterval.isValue(), `Selector index ${idxPos} has bottom inner value`);

			const [l, u] = innerInterval.value;
			// After buildPosIntervalSelector conversion, intervals are positive
			// representing the positions to delete (negated from original negative intervals)
			guard(l >= 0 && u >= 0, `Selector index ${idxPos} has invalid positive interval [${l}, ${u}]`);

			const posLower = l;
			const posUpper = u;
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
	 * Applies negative indexing selection: x[c] where c < 0.
	 * Negative indices specify positions to delete from the vector.
	 * Preconditions (guaranteed by dispatcher):
	 * - value is not Bottom
	 * - selector is not Bottom
	 * - selector contains only non-positive positions (no NA)
	 *
	 * Postconditions:
	 * - Result length is reduced by number of excluded positions
	 * - Result summary is ⊥ for non-enumerable selectors, preserved for enumerable
	 * - Result attributes are preserved from source
	 * @param value - The source VectorDomain to select from (not Bottom)
	 * @param selector - The selector VectorDomain with negative intervals (not Bottom)
	 * @param naValue - The NA value for out-of-bounds access
	 * @returns The resulting VectorDomain after negative selection
	 */
	private applySelectNegative(
		value: VectorDomain<Domain>,
		selector: VectorDomain<PosIntervalDomain>,
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		// Entry logging
		vectorLogger.trace(`applySelectNegative [source length=${value.length.toString()}, selector length=${selector.length.toString()}]`);

		// Preconditions (guaranteed by dispatcher):
		// - value is not Bottom
		// - selector is not Bottom

		// Get source bounds
		guard(value.length.isValue(), 'Source length is not value');
		const sourceLower = value.length.value[0];
		const sourceUpper = value.length.value[1];
		if(sourceUpper === +Infinity) {
			vectorLogger.trace('Subcase: selectNegative - infinite source, returning top');
			return value.top();
		}

		// Compute adjusted selector: removes zero indices and adjusts length bounds
		const adjustedSelector = adjustForZeros(selector);

		vectorLogger.trace(`Adjusted selector [length=${adjustedSelector.length.toString()}]`);

		// Empty selector after adjusting for zeros means no positions are deleted
		// Return source vector unchanged (no positions deleted)
		if(adjustedSelector.length.isValue()) {
			const [, newU] = adjustedSelector.length.value;
			if(newU === 0) {
				vectorLogger.debug('Operation: selectNegative - empty selector, returning source vector');
				return value;
			}
		}

		// Compute sets from ADJUSTED selector
		let mustDeleted = new Set<number>();
		let mayDeleted = new Set<number>();

		guard(adjustedSelector.known.isValue() && Array.isArray(adjustedSelector.known.value), 'Adjusted selector known positions not enumerable');
		const selectorValues = adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[];
		// Sets construction
		[ mustDeleted, mayDeleted ] = this.buildNegativeSets(sourceUpper, selectorValues);


		// Compute MustNotDeleted
		const mustNotDeleted = new Set<number>();
		guard(value.known.isValue() && Array.isArray(value.known.value), 'Source known positions not enumerable');
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

		// Paragraph 1: At least one non-enumerable position (Paper §4.7, L591-605)
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

		// Paragraphs 2 & 3: All enumerable positions
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

		// Preconditions (guaranteed by dispatcher):
		// - value is not Bottom
		// - selector is not Bottom
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

		const adjustedSelector = rhoF(selector.known, selector.length.value[0], maxLen, selector.naAwareFactory);
		if(!adjustedSelector.isValue() || adjustedSelector.value.length === undefined) {
			return value.bottom();
		}

		// Empty selector after adjusting for zeros - return bottom
		if(adjustedSelector.value.length == 0) {
			vectorLogger.debug('Operation: selectNegative - empty selector, returning bottom');
			return value.bottom();
		}

		const plainSelector = adjustedSelector.toArray();
		for(let i = 0; i < selector.known.value.length; i++) {
			const iVal = plainSelector[i];
			let sourceVal = NAAwareDomain.bottom(this.plainFactory);

			let [u, l] = [0, 0];
			if(iVal.inner.isValue()) {
				[u, l] = iVal.inner.value;

				if(l == 0 && u == 0) {
					vectorLogger.trace(`Extracted FALSE in position ${i}`);
					continue;
				} else if(u == 1) {
					vectorLogger.trace(`Contained TRUE in position ${i}`);
					const accessed = accessPosition(value, i, naValue);
					vectorLogger.trace(`Accessed value [${accessed.toString()}]`);
					sourceVal = sourceVal.join(accessed);
				}
			}

			if(iVal.containsNA()) {
				vectorLogger.trace(`Contained NA in position ${i}`);
				sourceVal = sourceVal.join(naValue);
			}

			guard(sourceVal.isValue(), `Selected position [sourceVal:${sourceVal.toString()}] not valid`);
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
	 * @returns The resulting VectorDomain after update
	 */
	private applyUpdate(
		value: VectorDomain<Domain>,
		selector: VectorDomain<IntervalDomain>,
		values: VectorDomain<Domain>,
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		// Derive selector kind from the selector's type (logical vs numeric)
		const selectorKind = selector.type.getType() === 'logical' ? 'logical' : 'numeric';
		vectorLogger.debug(`Operation: update [selectorKind=${selectorKind}]`);
		vectorLogger.debug(`Operation: update input [value.length=${value.length.toString()}, selector.length=${selector.length.toString()}, values.length=${values.length.toString()}]`);

		if(value.isBottom() || selector.isBottom() || values.isBottom()) {
			vectorLogger.debug('Operation: update returning bottom (input is bottom)');
			return value.bottom();
		}

		// Paper Section 4.8 (L757-769): Empty selector update
		// rUpdateSharp(ν1, genvecalpha(rEmpty), ν3) = rUpdateSharp_pos(ν1, ν2', ν3)
		// where ν2' = rvec[[l1,u1], ⟨[1,1][2,2]...[u1,u1]⟩, s1, a1]
		const isEmptySelector = selector.length.isValue() &&
			selector.length.value[0] === 0 &&
			selector.length.value[1] === 0;
		if(isEmptySelector) {
			vectorLogger.debug('Operation: update with empty selector - building matching selector');
			// Construct selector matching source vector length: [1,1], [2,2], ..., [u1,u1]
			const constructedSelector = this.buildSelectorMatchingSourceLength(value);
			const result = this.applyUpdatePositive(value, constructedSelector, values, naValue);
			vectorLogger.debug(`Operation: update empty selector result [length=${result.length.toString()}]`);
			return result;
		}

		// Logical selector: use logical update
		if(selectorKind === 'logical') {
			const result = this.applyUpdateLogical(value, selector, values, naValue);
			vectorLogger.debug(`Operation: update logical result [length=${result.length.toString()}]`);
			return result;
		}

		const numericSelector = selector;

		// Check for Bottom: selector known positions are impossible
		if(numericSelector.known.isBottom()) {
			vectorLogger.debug('Operation: update returning bottom (selector known is bottom)');
			return value.bottom();
		}

		// Check for Top: selector known positions are unknown, apply conservative fallback
		if(numericSelector.known.isTop()) {
			vectorLogger.debug('Operation: update cannot enumerate selector values (known is top), applying conservative fallback');
			// Conservative fallback: result summary = squash(value) join squash(values)
			// known positions empty, length = [l1, +Infinity] if value.length is a value else top length
			// preserve attributes and type
			const resultSummary = squash(value).join(squash(values));
			const resultLength = value.length.isValue()
				? value.length.create([value.length.value[0], +Infinity])
				: value.length.top();
			const result = value.create({
				length:     resultLength,
				known:      value.known.create([]),
				summary:    resultSummary,
				attributes: value.attributes,
				type:       value.type
			});
			vectorLogger.debug(`Operation: update conservative fallback result [length=${result.length.toString()}]`);
			return result;
		}

		// At this point, known must be a value (non-empty array)
		if(!Array.isArray(numericSelector.known.value)) {
		// This should not happen if isValue() and !isTop() and !isBottom() are all true
			vectorLogger.debug('Operation: update returning bottom (selector known value is not an array)');
			return value.bottom();
		}

		// Check if selector is all zeros (will become empty after adjustForZeros)
		// In this case, return value unchanged (update does nothing; zeros ignored)
		const selectorValues = numericSelector.known.value as readonly NAAwareDomain<IntervalDomain>[];
		const allZeros = selectorValues.every(pos => {
			if(!pos.isValue() || !pos.inner.isValue()) {
				return false;
			}
			const [l, u] = pos.inner.value;
			return l === 0 && u === 0;
		});
		if(allZeros) {
			vectorLogger.debug('Operation: update with all-zero selector, returning value unchanged');
			return value;
		}

		// Paper Section 4.8: abstract filter classifies selector positions
		const selectorPositions = numericSelector.known.value;
		const filterResult = VectorDomain.abstractFilter(selectorPositions, numericSelector.plainFactory);
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
		// IMPORTANT: Use buildIntervalSelector to preserve negative IntervalDomain values
		// (not buildPosIntervalSelector which negates them)
		if(filterResult.negative.length > 0 && !filterResult.negativeHasBottom) {
			const negativeSelector = buildIntervalSelector(numericSelector, filterResult.negative);
			const resultNeg = this.applyUpdateNegative(value, negativeSelector, values, naValue);
			vectorLogger.debug(`Operation: update negative result [length=${resultNeg.length.toString()}]`);
			result = result.join(resultNeg);
		}

		vectorLogger.debug(`Operation: update final result [length=${result.length.toString()}, values=${result.known.toString()}]`);
		return result;
	}

	/**
	 * Builds a selector that matches the source vector's abstract length.
	 * Paper Section 4.8 (L757-769): For empty selector update:
	 * ν2' = rvec[[l1,u1], ⟨[1,1][2,2]...[u1,u1]⟩, s1, a1]
	 * @param value - The source vector to match
	 * @returns A selector with positions 1..u1
	 */
	private buildSelectorMatchingSourceLength(
		value: VectorDomain<Domain>
	): VectorDomain<PosIntervalDomain> {
		const posIntervalFactory: DomainFactory<PosIntervalDomain> = (c: unknown) => {
			if(c === undefined || c === Bottom) {
				return PosIntervalDomain.bottom();
			}
			if(c === Top) {
				return PosIntervalDomain.top();
			}
			const values = [...(c as Set<number>)];
			return new PosIntervalDomain([Math.min(...values), Math.max(...values)]);
		};

		// Get source length bounds
		let upper = 0;
		if(value.length.isValue()) {
			upper = value.length.value[1];
		} else {
			// If length is not a value, return bottom (cannot construct selector)
			return VectorDomain.bottom(posIntervalFactory);
		}

		// Handle infinite length
		if(upper === +Infinity) {
			// For infinite vectors, construct infinite selector
			const infiniteSelector = VectorDomain.create(
				posIntervalFactory,
				new PosIntervalDomain([0, +Infinity]),
				KnownInitialPositionsDomain.top(
					NAAwareDomain.createSmartFactory(posIntervalFactory)
				),
				new NAAwareDomain({ inner: new PosIntervalDomain([1, +Infinity]), hasNA: false }, posIntervalFactory),
				value.attributes,
				value.type
			);
			return infiniteSelector;
		}

		// Build positions [1,1], [2,2], ..., [u1,u1]
		const naFactory = NAAwareDomain.createSmartFactory(posIntervalFactory);
		const positions: NAAwareDomain<PosIntervalDomain>[] = [];
		for(let i = 1; i <= upper; i++) {
			const posInterval = new PosIntervalDomain([i, i]);
			positions.push(new NAAwareDomain({ inner: posInterval, hasNA: false }, posIntervalFactory));
		}

		const knownPositions = new KnownInitialPositionsDomain(positions, naFactory);
		const summary = new NAAwareDomain({ inner: PosIntervalDomain.bottom(), hasNA: false }, posIntervalFactory);

		return new VectorDomain({
			length:     new PosIntervalDomain([0, upper]),
			known:      knownPositions,
			summary:    summary,
			attributes: value.attributes,
			type:       value.type
		}, posIntervalFactory);
	}

	/**
	 * Applies positive indexing update: x[c] <- v where c >= 0.
	 * Handles both finite and infinite selectors using cyclic value recycling.
	 * Paper Section 4.8.1 (lines 916-932).
	 *
	 * **Preconditions (expected by dispatcher):**
	 * - `value`, `selector`, `values` are not Bottom (dispatcher ensures this)
	 * - `selector` contains only non-negative positions (≥ 0) or NA
	 * - `selector` has been classified as positive by abstractFilter
	 *
	 * **Structural Invariants:**
	 * - After adjustForZeros, selector length may be [0,0] (empty), Top, or Bottom
	 * - adjustForZeros can return Bottom/Top depending on selector content
	 * - Enumerable positions: card(interval) ≤ θ (threshold for enumeration)
	 * - Non-enumerable positions: use squash operation (join all values)
	 *
	 * **Postconditions:**
	 * - Result length: [sourceLower, max(sourceUpper, selectorUpper)] for finite selectors
	 * - Result length: [sourceLower, +∞] for infinite selectors
	 * - Result summary: ⊥ for finite selectors, squash(values) for infinite
	 * - Known positions: updated via cyclic recycling of values
	 *
	 * @param value - The target VectorDomain to update
	 * @param selector - The positive selector VectorDomain (contains only c ≥ 0)
	 * @param values - The values to assign (cyclically recycled)
	 * @param naValue - The NA value for out-of-bounds positions
	 * @returns The resulting VectorDomain after positive update
	 */
	private applyUpdatePositive(
		value: VectorDomain<Domain>,
		selector: VectorDomain<IntervalDomain>,
		values: VectorDomain<Domain>,
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: updatePositive');
		const adjustedSelector = adjustForZeros(selector);
		if(adjustedSelector.isBottom() || adjustedSelector.length.isBottom()) {
			expensiveTrace(vectorLogger, () => 'adjustedSelector is Bottom, returning Bottom');
			return value.bottom();
		}

		guard(adjustedSelector.length.isValue(), 'adjustedSelector length is not a Value');
		const [_adjustedL, adjustedU] = adjustedSelector.length.value;
		if(adjustedU == 0) {
			return value.bottom();
		}

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
			const vLower = values.length.isValue() ? values.length.value[0] : 1;
			const rhoFResult = rhoF(values.known, vLower, valuesUpper, values.factory);
			const cyclicValues = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];
			const resultKnownPositions = updateKnownPositions(baseKnownPositions, selectorKnownPositions, cyclicValues);
			if(!selectorSummaryEnumerable && summaryInner != undefined && summaryInner.isValue()) {
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
			const vLower = values.length.isValue() ? values.length.value[0] : 1;
			const rhoFResult = rhoF(values.known, vLower, Math.max(selectorUpper, valuesUpper), values.factory);
			const cyclicValues = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];
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
	 * Applies negative indexing update: x[c] <- v where c < 0.
	 * Negative indices specify positions to update by their absolute values.
	 * Paper Section 4.8.2 (lines 934-1026).
	 *
	 * **Preconditions (expected by dispatcher):**
	 * - `value`, `selector`, `values` are not Bottom (dispatcher ensures this)
	 * - `selector` contains only non-positive positions (≤ 0), no NA
	 * - `selector` has been classified as negative by abstractFilter
	 * - `value.length` must be a Value (not Top/Bottom) - defensive check inside
	 *
	 * **Structural Invariants:**
	 * - Negative indices in range [-u₁, -1] map to positions [1, u₁]
	 * - MustNotUpdated: positions definitely NOT updated (singleton negative indices)
	 * - MayNotUpdated: positions possibly NOT updated (non-singleton intervals or summary)
	 * - MustUpdated: positions definitely updated (in prefix, not in MustNotUpdated ∪ MayNotUpdated)
	 * - Infinite source (u₁ = +∞) returns Top (cannot determine all positions)
	 *
	 * **Postconditions:**
	 * - Paragraph 1 (non-enumerable): weak update with squash(values), summary updated if infinite
	 * - Paragraph 2 (infinite selector): converts to positive selector, delegates to applyUpdatePositive
	 * - Paragraph 3 (finite selector): strong update with cyclic recycling, summary = ⊥
	 * - Result length: [sourceLower, max(sourceUpper, selectorUpper)] for finite selectors
	 *
	 * @param value - The target VectorDomain to update
	 * @param selector - The negative selector VectorDomain (contains only c ≤ 0)
	 * @param values - The values to assign (cyclically recycled)
	 * @param naValue - The NA value for out-of-bounds positions
	 * @returns The resulting VectorDomain after negative update
	 */
	private applyUpdateNegative(
		value: VectorDomain<Domain>,
		selector: VectorDomain<IntervalDomain>,
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
			const selectorKnownPositions = adjustedSelector.known.value;
			for(const idx of selectorKnownPositions) {
				if(idx.isBottom() || idx.isNA()) {
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
		const hasNonEnumerable = adjustedSelector.known.isValue()
			&& (adjustedSelector.known.value).some(idx => !idx.isNA() && !idx.isBottom() && !isEnumerable(idx.inner));

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

			// Factory for creating PosIntervalDomain values
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

			// Build positive selector from MustUpdated and MayNotUpdated
			// Length: [lᵣ, uᵣ] = [|MustUpdated_{l₁}|, u₁ - |MustNotUpdated_{u₁}|]
			const mustUpdatedCount = [...mustUpdated].filter(i => i >= sourceLower).length;
			const mustNotUpdatedCount = [...mustNotUpdated].filter(i => i <= sourceUpper).length;
			const resultLengthLower = mustUpdatedCount;
			const resultLengthUpper = sourceUpper - mustNotUpdatedCount;

			// Build selector prefix
			const selectorPrefixPositions: NAAwareDomain<IntervalDomain>[] = [];

			// CountMustNotUpdated helper: count positions < i
			const countMustNotUpdated = (i: number) => [...mustNotUpdated].filter(p => p < i).length;

			// For each position in MustUpdated (ascending)
			for(const i of [...mustUpdated].sort((a, b) => a - b)) {
				const targetIdx = i - countMustNotUpdated(i);
				// Ensure selectorPrefixPositions has enough room
				while(selectorPrefixPositions.length < targetIdx) {
					selectorPrefixPositions.push(new NAAwareDomain({
						inner: IntervalDomain.bottom(),
						hasNA: false
					}, posIntervalFactory));
				}
				if(targetIdx >= 1) {
					selectorPrefixPositions[targetIdx - 1] = new NAAwareDomain<IntervalDomain>({
						inner: new IntervalDomain([i, i]),
						hasNA: false
					}, posIntervalFactory);
				}
			}

			// For each position in MayNotUpdated (ascending, excluding MustNotUpdated)
			for(const i of [...mayNotUpdated].filter(i => !mustNotUpdated.has(i)).sort((a, b) => a - b)) {
				if(i > sourceUpper) {
					continue;
				}
				const targetIdx = i - countMustNotUpdated(i);
				while(selectorPrefixPositions.length < targetIdx) {
					selectorPrefixPositions.push(new NAAwareDomain<IntervalDomain>({
						inner: IntervalDomain.bottom(),
						hasNA: false
					}, posIntervalFactory));
				}
				if(targetIdx >= 1) {
					const existing = selectorPrefixPositions[targetIdx - 1];
					selectorPrefixPositions[targetIdx - 1] = existing.join(new NAAwareDomain<IntervalDomain>({
						inner: new IntervalDomain([i, i]),
						hasNA: false
					}, posIntervalFactory));
				}
			}

			// Build selector vector
			const positiveSelector = selector.create({
				length:     new PosIntervalDomain([resultLengthLower, resultLengthUpper]),
				known:      adjustedSelector.known.create(selectorPrefixPositions),
				summary:    adjustedSelector.summary,
				attributes: adjustedSelector.attributes,
				type:       adjustedSelector.type
			});

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
			const vLower = values.length.isValue() ? values.length.value[0] : 1;
			const rhoFResult = rhoF(values.known, vLower, Math.max(selectorUpper, valuesUpper), values.factory);
			const cyclicValues = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];

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
	 * Applies logical indexing update: x[c] <- v where c is a logical vector.
	 * Values are assigned to positions where the selector is TRUE.
	 * Uses cyclic recycling when selector is shorter than the source.
	 * Paper Section 4.8.3 (logical update semantics).
	 *
	 * **Preconditions (expected by dispatcher):**
	 * - `value`, `selector`, `values` are not Bottom (dispatcher ensures this)
	 * - `selector` type is logical (contains TRUE/FALSE/NA values)
	 * - `value.known` is not Bottom - defensive check inside
	 *
	 * **Structural Invariants:**
	 * - Selector length > 1 cannot contain NA (sanity check: filter to first element if violated)
	 * - After adjustForZeros, logical selector has zeros removed
	 * - Cyclic recycling: values are repeated cyclically to match selector length
	 * - Positions with TRUE selector: updated with cyclic values
	 * - Positions with FALSE/NA selector: weakly updated (joined with cyclic values)
	 *
	 * **Postconditions:**
	 * - Result length: [sourceLower, max(sourceUpper, selectorUpper)] for finite selectors
	 * - Result length: [sourceLower, +∞] for infinite selectors
	 * - Result summary: ⊥ for finite selectors, squash(values) for infinite
	 * - Known positions: updated via cyclic recycling, with weak update for non-TRUE positions
	 *
	 * @param value - The target VectorDomain to update
	 * @param selector - The logical selector VectorDomain (contains TRUE/FALSE/NA)
	 * @param values - The values to assign (cyclically recycled)
	 * @param naValue - The NA value for out-of-bounds positions
	 * @returns The resulting VectorDomain after logical update
	 */
	private applyUpdateLogical(
		value: VectorDomain<Domain>,
		selector: VectorDomain<IntervalDomain>,
		values: VectorDomain<Domain>,
		naValue: NAAwareDomain<Domain>
	): VectorDomain<Domain> {
		vectorLogger.debug('Operation: updateLogical');
		if(value.isBottom() || selector.isBottom() || values.isBottom() || value.known.isBottom()) {
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

		// Sanity check: selector length > 1 <-> no NA
		if(squash(selector).containsNA() && selectorUpper > 1) {
			vectorLogger.debug('Selectors longer than 1 cannot contain NA');
			// Filter selector: keep only the first element, set length to [1, 1]
			const rawSelectorKnownPositions = selector.known.isValue() ? selector.known.value : [];
			const filteredSelectorKnownPositions = rawSelectorKnownPositions.length > 0 ? [rawSelectorKnownPositions[0]] : [];
			selector = selector.create({
				length:     selector.length.create([1, 1]),
				known:      selector.known.create(filteredSelectorKnownPositions),
				summary:    selector.summary,
				attributes: selector.attributes,
				type:       selector.type
			});

			selectorUpper = 1;
		}

		selector = adjustForZeros(selector);

		const isInfinite = selectorUpper === +Infinity;
		if(isInfinite) {
			vectorLogger.trace('Subcase: updateLogical - infinite selector');
		} else {
			vectorLogger.trace('Subcase: updateLogical - finite selector');
		}

		const sourceKnownPositions = value.known.toArray();
		const selectorKnownPositions = selector.known.toArray();
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
		const vLower = values.length.isValue() ? values.length.value[0] : 1;
		const rhoFResult = rhoF(values.known, vLower, selectorUpper, values.factory);
		const cyclicValues = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];
		for(let i = 0; i < maxLen && i < cyclicValues.length; i++) {
			let selectorVal: NAAwareDomain<IntervalDomain>;
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

	private unknownOperation(): VectorOperations<Domain> {
		return [{ operation: 'unknown', operand: VectorDomain.bottom(this.plainFactory) }];
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
		if(pos.isNA()) {
			// Pure NA position - preserve as NA
			return NAAwareDomain.na(posIntervalFactory);
		}
		// Convert inner IntervalDomain to PosIntervalDomain
		// abstractFilter guarantees: lower ≥ 0 for positive, upper ≤ 0 for negative
		const innerInterval = pos.inner;
		if(!innerInterval.isValue()) {
			return NAAwareDomain.bottom(posIntervalFactory);
		}
		const [l, u] = innerInterval.value;
		// For positive intervals [l, u] where l ≥ 0: keep as is
		// For non-positive intervals [l, u] where u ≤ 0: negate to get positions to delete
		// In R, x[-2] means delete position 2, so [-2, -1] becomes [1, 2]
		// In R, x[-2:0] means delete positions 1 and 2, so [-2, 0] becomes [1, 2] (excluding 0)
		const [posL, posU] = u <= 0 && l < 0
			? [Math.max(1, Math.abs(u)), Math.abs(l)]  // Negate and exclude 0
			: [l, u];
		const posInner = new PosIntervalDomain([posL, posU]);
		return new NAAwareDomain({ inner: posInner, hasNA: pos.containsNA() }, posIntervalFactory);
	});
	const naAwareSummary = source.summary.isBottom()
		? NAAwareDomain.bottom(posIntervalFactory)
		: source.summary.isTop()
			? NAAwareDomain.top(posIntervalFactory)
			: source.summary.inner.isValue()
				? new NAAwareDomain(
					{ inner: new PosIntervalDomain(source.summary.inner.value), hasNA: source.summary.containsNA() },
					posIntervalFactory
				)
				: NAAwareDomain.bottom(posIntervalFactory);
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
 * Builds an IntervalDomain-typed selector vector from filtered positions, preserving original values.
 * Unlike buildPosIntervalSelector, this does NOT negate negative intervals.
 * Used for update_neg where applyUpdateNegative expects negative IntervalDomain values
 * and performs its own negation to compute positions to delete.
 * @param source - The source selector VectorDomain<IntervalDomain>
 * @param positions - Filtered positions (guaranteed to be negative or zero by abstractFilter)
 * @returns A selector with preserved IntervalDomain values (not negated)
 */
function buildIntervalSelector(
	source: VectorDomain<IntervalDomain>,
	positions: readonly NAAwareDomain<IntervalDomain>[]
): VectorDomain<IntervalDomain> {
	if(positions.length === 0) {
		return source.bottom();
	}
	const intervalFactory: DomainFactory<IntervalDomain> = source.plainFactory;
	const naAwarePositions = positions.map(pos => {
		if(pos.isBottom()) {
			return NAAwareDomain.bottom(intervalFactory);
		}
		if(pos.isTop()) {
			return NAAwareDomain.top(intervalFactory);
		}
		if(pos.isNA()) {
			// Pure NA position - preserve as NA
			return NAAwareDomain.na(intervalFactory);
		}
		// Preserve the original IntervalDomain value without negation
		// abstractFilter guarantees: upper ≤ 0 for negative positions
		const innerInterval = pos.inner;
		if(!innerInterval.isValue()) {
			return NAAwareDomain.bottom(intervalFactory);
		}
		// Keep the interval as-is (negative values)
		return new NAAwareDomain({ inner: innerInterval, hasNA: pos.containsNA() }, intervalFactory);
	});
	const naAwareSummary = source.summary.isBottom()
		? NAAwareDomain.bottom(intervalFactory)
		: source.summary.isTop()
			? NAAwareDomain.top(intervalFactory)
			: source.summary.inner.isValue()
				? new NAAwareDomain(
					{ inner: source.summary.inner, hasNA: source.summary.containsNA() },
					intervalFactory
				)
				: NAAwareDomain.bottom(intervalFactory);
	return VectorDomain.fromValues(
		intervalFactory,
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
