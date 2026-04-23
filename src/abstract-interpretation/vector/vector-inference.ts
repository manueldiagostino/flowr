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
import { NA } from '../domains/lattice';
import { PosIntervalDomain } from '../domains/positive-interval-domain';
import type { IntervalDomain } from '../domains/interval-domain';
import type { ArithmeticDomain } from '../domains/arithmetic-domain';
import { VectorAttrDomain } from '../domains/vector-attr-domain';
import { RVectorTypeDomain } from '../domains/vector-type-domain';
import { KnownInitialPositionsDomain } from './known-initial-positions-domain';
import { type ValueToDomainConverter, buildVectorFromLiteral } from './resolve-vector-args';
import type { RNumber } from '../../r-bridge/lang-4.x/ast/model/nodes/r-number';
import type { RString } from '../../r-bridge/lang-4.x/ast/model/nodes/r-string';
import type { RLogical } from '../../r-bridge/lang-4.x/ast/model/nodes/r-logical';
import type { RSymbol } from '../../r-bridge/lang-4.x/ast/model/nodes/r-symbol';
import { FunctionArgument as FunctionArgumentUtil } from '../../dataflow/graph/graph';
import { EmptyArgument } from '../../r-bridge/lang-4.x/ast/model/nodes/r-function-call';
import { VertexType } from '../../dataflow/graph/vertex';
import { RType } from '../../r-bridge/lang-4.x/ast/model/type';
import { RAccess } from '../../r-bridge/lang-4.x/ast/model/nodes/r-access';
import { RArgument } from '../../r-bridge/lang-4.x/ast/model/nodes/r-argument';
import type { RBinaryOp } from '../../r-bridge/lang-4.x/ast/model/nodes/r-binary-op';
import type { RUnaryOp } from '../../r-bridge/lang-4.x/ast/model/nodes/r-unary-op';
import { guard } from '../../util/assert';
import {
	applyConcatenate,
	applyRecycle,
	applyBinaryOp,
	applyNegate,
	applySelect,
	applySelectPositive,
	applySelectNegative,
	applySelectLogical,
	applyUpdate,
	buildSelectorMatchingSourceLength,
	applyUpdatePositive,
	applyUpdateNegative,
	applyUpdateLogical,
	applySetAttr
} from './operations';
import { buildNegativeSets } from './operations/select';
import { detectVectorFunctionType, type VectorFunctionType } from './helpers/function-detection';

type VectorOperationName = 'setAttr' | 'binary_op' | 'concatenate' | 'select' | 'update' | 'negate' | 'unknown';

interface VectorOperation<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>, Name extends VectorOperationName = VectorOperationName> {
	operation:     Name;
	operand:       VectorDomain<Domain> | undefined;
	[key: string]: unknown;
}

type VectorOperations<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>> = VectorOperation<Domain>[];

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
export class VectorInferenceVisitor<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>> extends AbstractInterpretationVisitor<VectorDomain<Domain>, VectorInferenceConfiguration> {
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
		return detectVectorFunctionType(node);
	}



	// ==================== Function Handlers ====================

	/**
	 * Resolves vector arguments from a function call.
	 * @param call - The function call vertex from the dataflow graph
	 * @returns Array of resolved argument info with id and VectorDomain value
	 */
	private resolveVectorArguments(call: DataflowGraphVertexFunctionCall): { id: NodeId; resolved: VectorDomain<Domain> | undefined; named: boolean }[] {
		const args: { id: NodeId; resolved: VectorDomain<Domain> | undefined; named: boolean }[] = [];
		for(const arg of call.args) {
			if(arg !== undefined && arg !== EmptyArgument) {
				const isNamed = FunctionArgumentUtil.isNamed(arg);
				const argId = FunctionArgumentUtil.getId(arg);
				if(argId !== undefined) {
					const argNode = this.getNode(argId);
					if(argNode?.type === RType.Argument && argNode.value !== undefined) {
						const resolved = this.getVectorDomainValue(argNode.value.info.id);
						args.push({ id: argNode.value.info.id, resolved, named: isNamed });
					} else {
						const resolved = this.getVectorDomainValue(argId);
						args.push({ id: argId, resolved, named: isNamed });
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
			const resolved = args[0].resolved;
			if(resolved === undefined) {
				return [{ operation: 'concatenate', operand: undefined }];
			}
			// Apply names attribute if single argument is named
			if(args[0].named) {
				const namedVector = resolved.create({
					length:     resolved.length,
					known:      resolved.known,
					summary:    resolved.summary,
					attributes: VectorAttrDomain.from(new Set(['names']), new Set(['names'])),
					type:       resolved.type
				});
				return [{ operation: 'concatenate', operand: namedVector }];
			}
			return [{ operation: 'concatenate', operand: resolved }];
		}

		const operations: VectorOperations<Domain> = [];

		// Apply names attribute to first argument if named
		let firstResolved = args[0].resolved;
		if(firstResolved !== undefined && args[0].named) {
			firstResolved = firstResolved.create({
				length:     firstResolved.length,
				known:      firstResolved.known,
				summary:    firstResolved.summary,
				attributes: VectorAttrDomain.from(new Set(['names']), new Set(['names'])),
				type:       firstResolved.type
			});
		}

		// Apply names attribute to second argument if named
		let secondResolved = args[1].resolved;
		if(secondResolved !== undefined && args[1].named) {
			secondResolved = secondResolved.create({
				length:     secondResolved.length,
				known:      secondResolved.known,
				summary:    secondResolved.summary,
				attributes: VectorAttrDomain.from(new Set(['names']), new Set(['names'])),
				type:       secondResolved.type
			});
		}

		operations.push({
			operation: 'concatenate',
			operand:   firstResolved,
			other:     secondResolved
		});

		for(let i = 2; i < args.length; i++) {
			// Apply names attribute to subsequent arguments if named
			let argResolved = args[i].resolved;
			if(argResolved !== undefined && args[i].named) {
				argResolved = argResolved.create({
					length:     argResolved.length,
					known:      argResolved.known,
					summary:    argResolved.summary,
					attributes: VectorAttrDomain.from(new Set(['names']), new Set(['names'])),
					type:       argResolved.type
				});
			}
			operations.push({
				operation: 'concatenate',
				operand:   undefined,
				other:     argResolved
			});
		}

		return operations;
	}

	/**
	 * Handles sequence construction with the : operator (e.g., 1:3, 5:1).
	 * Creates a vector with known consecutive integer values.
	 * Reads numeric values directly from the AST instead of from abstracted domain values.
	 * @param node - The R node of the binary operation
	 * @param _call - The function call vertex from the dataflow graph
	 * @returns The mapped vector operations sequence
	 */
	private handleSequence(node: RNode<ParentInformation>, _call: DataflowGraphVertexFunctionCall): VectorOperations<Domain> {
		// Only handle binary operations (1:3, 5:1, etc.)
		if(node.type !== RType.BinaryOp) {
			return this.unknownOperation();
		}

		const binaryOp = node as RBinaryOp;
		if(binaryOp.operator !== ':') {
			return this.unknownOperation();
		}

		// Extract values directly from AST
		const lhsNode = binaryOp.lhs;
		const rhsNode = binaryOp.rhs;

		// Both must be RNumber nodes
		if(lhsNode.type !== RType.Number || rhsNode.type !== RType.Number) {
			vectorLogger.debug('Handler: handleSequence operands not concrete numbers, returning unknown');
			return this.unknownOperation();
		}

		const start = lhsNode.content.num;
		const end = rhsNode.content.num;

		vectorLogger.debug(`Handler: handleSequence range [start=${start}, end=${end}]`);

		// Build sequence: c(start, start+1, ..., end-1, end)
		// For 1:3, this creates [1, 2, 3]
		// For 5:1, this creates [5, 4, 3, 2, 1] (descending)
		const step = start <= end ? 1 : -1;
		const length = Math.abs(end - start) + 1;

		const sequenceValues: NAAwareDomain<Domain>[] = [];
		for(let i = 0; i < length; i++) {
			const val = start + (i * step);
			const domainVal = this.valueConverter(val);
			if(domainVal === undefined) {
				vectorLogger.debug(`Handler: handleSequence failed to convert value ${val}`);
				return this.unknownOperation();
			}
			const innerDomain = this.plainFactory(domainVal);
			sequenceValues.push(new NAAwareDomain({ inner: innerDomain, hasNA: false }, this.plainFactory));
		}

		const smartFactory = NAAwareDomain.createSmartFactory(this.plainFactory);
		const knownPositions = new KnownInitialPositionsDomain(sequenceValues, smartFactory);
		const summaryBottom = NAAwareDomain.bottom(this.plainFactory);

		const sequenceVector = new VectorDomain({
			length:     new PosIntervalDomain([length, length]),
			known:      knownPositions,
			summary:    summaryBottom,
			attributes: VectorAttrDomain.empty(),
			type:       RVectorTypeDomain.of('double')
		}, this.plainFactory);

		vectorLogger.debug(`Handler: handleSequence created vector [length=${length}]`);
		return [{ operation: 'concatenate', operand: sequenceVector }];
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
			operation: 'binary_op',
			operator:  node.operator,
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
		vectorLogger.debug(`Handler: handleReplacement [node.type=${node.type}, source.type=${source?.type}]`);
		if(!RAccess.is(node)) {
			vectorLogger.debug('Handler: handleReplacement node is not RAccess, returning unknown');
			return this.unknownOperation();
		}

		const access = node;
		const args = access.access;

		vectorLogger.debug(`Handler: handleReplacement args.length=${args.length}`);

		if(args.length === 1) {
			const accessedNode = access.accessed;
			const operand = accessedNode?.info.id;
			const selectorArg = args[0];
			// Unwrap RArgument to get the inner value's node ID (not the wrapper's)
			const selectorNode = selectorArg !== '<>' && selectorArg !== undefined ? (RArgument.is(selectorArg) ? selectorArg.value : selectorArg) : undefined;
			const selector = selectorNode?.info.id;
			const values = source?.info.id;

			const resolvedOperand = operand !== undefined ? this.getVectorDomainValue(operand) : undefined;
			// Try to get values from domain state; if not found, try to build from sourceNode directly
			let resolvedValues = values !== undefined ? this.getVectorDomainValue(values) : undefined;
			if(resolvedValues === undefined && source !== undefined) {
				resolvedValues = buildVectorFromLiteral(source, this.plainFactory, this.valueConverter);
			}
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
			case 'sequence': {
				const vertexInfo = this.config.dfg.get(node.info.id);
				if(vertexInfo === undefined) {
					operations = this.unknownOperation();
				} else {
					const [callVertex] = vertexInfo;
					if(callVertex?.tag !== VertexType.FunctionCall) {
						operations = this.unknownOperation();
					} else {
						operations = this.handleSequence(node, callVertex);
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
		vectorLogger.debug(`Handler: onReplacementCall [nodeId=${call.id}, target=${target}, source=${source}]`);

		// Use call.id to get the access node (x[1]), not target (which is just x)
		const node = this.getNormalizedAst(call.id);
		const sourceNode = source ? this.getNormalizedAst(source) : undefined;

		vectorLogger.debug(`Handler: onReplacementCall node type=${node?.type}, sourceNode type=${sourceNode?.type}`);

		if(node === undefined) {
			vectorLogger.debug('Handler: onReplacementCall node is undefined, returning');
			return;
		}
		const operations = this.handleReplacement(node, sourceNode);
		// Store result at target (the variable x), not at the access node (x[1])
		this.applyVectorExpression(node, operations, target);
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
	 * @param overrideTargetNodeId - Optional node ID to store result at (for replacement: store at variable x, not at x[1])
	 */
	private applyVectorExpression(node: RNode<ParentInformation>, operations: VectorOperations<Domain>, overrideTargetNodeId?: NodeId): void {
		const targetNodeId = overrideTargetNodeId ?? node.info.id;
		vectorLogger.debug(`Operation: applyVectorExpression [nodeId=${node.info.id}, targetNodeId=${targetNodeId}, operations=${operations.length}]`);
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
				this.updateState(targetNodeId, value);
			} else {
				this.updateState(targetNodeId, value);
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
			vectorLogger.debug(`resolveOperationArgs selector [id=${selectorId}, found=${selectorValue !== undefined}, value=${selectorValue?.length.toString() ?? 'undefined'}]`);
			resolved.selector = selectorValue ?? VectorDomain.bottom(this.plainFactory);
		}

		if('values' in args && typeof args.values === 'string') {
			const valuesId = Number(args.values) as NodeId;
			const valuesValue = this.getVectorDomainValue(valuesId);
			vectorLogger.debug(`resolveOperationArgs values [id=${valuesId}, found=${valuesValue !== undefined}, value=${valuesValue?.length.toString() ?? 'undefined'}]`);
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
			case 'binary_op':
				return this.applyBinaryOp(value, args.other as VectorDomain<Domain>, args.operator as string);
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
		return applySetAttr(value, attrs);
	}

	/**
	 * Recycles a pair of vectors to the same length for binary operations.
	 * Per paper Section 4.5: aligns two vectors by extending shorter one cyclically.
	 * @param v1 - The first vector
	 * @param v2 - The second vector
	 * @returns A tuple [v1_recycled, v2_recycled] with aligned lengths
	 */
	private applyRecycle(
		v1: VectorDomain<Domain>,
		v2: VectorDomain<Domain>
	): [VectorDomain<Domain>, VectorDomain<Domain>] {
		return applyRecycle(v1, v2);
	}

	/**
	 * Applies a binary operation to two vectors with proper recycling and type coercion.
	 * @param v1 - The first vector operand
	 * @param v2 - The second vector operand
	 * @param operator - The operator string (e.g., '+', '-', '*', '/')
	 * @returns The resulting VectorDomain after the binary operation
	 */
	private applyBinaryOp(
		v1: VectorDomain<Domain>,
		v2: VectorDomain<Domain> | undefined,
		operator: string
	): VectorDomain<Domain> {
		return applyBinaryOp(v1, v2, operator);
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
		return applyConcatenate(value, other);
	}

	/**
	 * Applies the negate operation to a vector.
	 * Negates each known position and the summary, preserving length/attributes/type.
	 * @param value - The VectorDomain to negate
	 * @returns The resulting VectorDomain after negation
	 */
	private applyNegate(value: VectorDomain<Domain>): VectorDomain<Domain> {
		return applyNegate(value);
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
		return applySelect(value, selector, naValue);
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
		return applySelectPositive(value, selector, naValue);
	}

	private buildNegativeSets(
		sourceUpper: number,
		selectorValues: readonly NAAwareDomain<PosIntervalDomain>[],
	): [mustDeleted: Set<number>, mayDeleted: Set<number>] {
		return buildNegativeSets(sourceUpper, selectorValues);
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
		return applySelectNegative(value, selector, naValue);
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
		return applySelectLogical(value, selector, naValue);
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
		return applyUpdate(value, selector, values, naValue);
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
		return buildSelectorMatchingSourceLength(value);
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
		return applyUpdatePositive(value, selector, values, naValue);
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
		return applyUpdateNegative(value, selector, values, naValue);
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
		return applyUpdateLogical(value, selector, values, naValue);
	}

	private unknownOperation(): VectorOperations<Domain> {
		return [{ operation: 'unknown', operand: VectorDomain.bottom(this.plainFactory) }];
	}

}
