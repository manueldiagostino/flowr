import type { DataflowGraphVertexFunctionCall, DataflowGraphVertexValue } from '../../dataflow/graph/vertex';
import type { RNode } from '../../r-bridge/lang-4.x/ast/model/model';
import type { ParentInformation } from '../../r-bridge/lang-4.x/ast/model/processing/decorate';
import type { NodeId } from '../../r-bridge/lang-4.x/ast/model/processing/node-id';
import { AbstractInterpretationVisitor, type AbsintVisitorConfiguration } from '../absint-visitor';
import type { AnyAbstractDomain } from '../domains/abstract-domain';
import { VectorDomain } from './vector-domain';
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
import { NA } from '../domains/lattice';
import type { PosIntervalDomain } from '../domains/positive-interval-domain';
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
import { RBinaryOp } from '../../r-bridge/lang-4.x/ast/model/nodes/r-binary-op';
import { RUnaryOp } from '../../r-bridge/lang-4.x/ast/model/nodes/r-unary-op';
import { RNumber as RNumberNode } from '../../r-bridge/lang-4.x/ast/model/nodes/r-number';
import { RLogical as RLogicalNode } from '../../r-bridge/lang-4.x/ast/model/nodes/r-logical';

type VectorFunctionType = 'concatenate' | 'arithmetic' | 'length' | 'unknown';

type SelectorType = 'positive' | 'negative' | 'logical';

type VectorOperationName = 'setAttr' | 'recycle' | 'concatenate' | 'selectPositive' | 'selectNegative' | 'selectLogical' | 'updatePositive' | 'updateNegative' | 'updateLogical' | 'unknown';

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
		if(this.currentState.has(id)) {
			return this.currentState.get(id);
		}
		// For symbols, follow variable origins to find the actual value
		const origins = this.getVariableOrigins(id);
		for(const origin of origins) {
			if(this.currentState.has(origin)) {
				return this.currentState.get(origin);
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
		if(node.type !== RType.FunctionCall && node.type !== RType.BinaryOp) {
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
			return 'unknown';
		}

		if(functionName === 'c') {
			return 'concatenate';
		}
		if(['+', '-', '*', '/'].includes(functionName)) {
			return 'arithmetic';
		}
		if(functionName === 'length') {
			return 'length';
		}

		return 'unknown';
	}

	// ==================== Selector Type Detection ====================

	/**
	 * Detects the selector type by analyzing the AST of the selector expression.
	 * @param selectorNode - The selector argument node from the AST
	 * @returns The selector type: 'positive' (non-negative indices), 'negative' (negative indices), or 'logical' (boolean)
	 */
	private detectSelectorType(selectorNode: RNode<ParentInformation> | typeof EmptyArgument | undefined): SelectorType {
		if(selectorNode === undefined || selectorNode === EmptyArgument) {
			return 'positive';
		}

		// Get the actual value from the argument wrapper
		const node = RArgument.is(selectorNode) ? selectorNode.value : selectorNode;
		if(node === undefined) {
			return 'positive';
		}

		return this.detectSelectorTypeFromNode(node);
	}

	/**
	 * Recursively analyzes a node to determine the selector type.
	 * Checks for logical literals, comparisons, negative numbers, and unary minus.
	 * @param node - The AST node to analyze
	 * @returns The selector type based on the node's structure
	 */
	private detectSelectorTypeFromNode<Info>(node: RNode<Info>): SelectorType {
		// Logical literals or comparisons indicate logical selector
		if(RLogicalNode.is(node)) {
			return 'logical';
		}

		// Check for comparison operators (indicates logical selector like x[x > 0])
		if(RBinaryOp.is(node)) {
			// Comparison operators create logical vectors
			if(['>', '<', '>=', '<=', '==', '!='].includes(node.operator)) {
				return 'logical';
			}
			// For all other operators (including '-', ':', 'c'), check operands
			// Note: binary '-' does NOT imply negative selection (e.g., x[x-1] is positive)
			const lhsType = this.detectSelectorTypeFromNode(node.lhs);
			const rhsType = this.detectSelectorTypeFromNode(node.rhs);
			// If any operand is negative or logical, propagate that
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
		if(RNumberNode.is(node) && typeof node.content.num === 'number' && node.content.num < 0) {
			return 'negative';
		}

		// Default: assume positive indexing
		return 'positive';
	}

	/**
	 * Maps a selector type to the corresponding abstract vector access operation name.
	 * @param selectorType - The detected selector type
	 * @returns The corresponding select operation name
	 */
	private selectorTypeToAccessOperation(selectorType: SelectorType): Extract<VectorOperationName, 'selectPositive' | 'selectNegative' | 'selectLogical'> {
		switch(selectorType) {
			case 'negative':
				return 'selectNegative';
			case 'logical':
				return 'selectLogical';
			case 'positive':
			default:
				return 'selectPositive';
		}
	}

	/**
	 * Maps a selector type to the corresponding abstract vector update operation name.
	 * @param selectorType - The detected selector type
	 * @returns The corresponding update operation name
	 */
	private selectorTypeToUpdateOperation(selectorType: SelectorType): Extract<VectorOperationName, 'updatePositive' | 'updateNegative' | 'updateLogical'> {
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
			const selector = selectorArg !== '<>' ? selectorArg?.info.id : undefined;

			// Detect selector type from AST
			const selectorType = this.detectSelectorType(selectorArg);
			const operation = this.selectorTypeToAccessOperation(selectorType);

			return [{
				operation,
				operand:  operand !== undefined ? this.getVectorDomainValue(operand) : undefined,
				selector: selector !== undefined ? String(selector) : undefined
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

			// Detect selector type from AST
			const selectorType = this.detectSelectorType(selectorArg);
			const operation = this.selectorTypeToUpdateOperation(selectorType);

			return [{
				operation,
				operand:  operand !== undefined ? this.getVectorDomainValue(operand) : undefined,
				selector: selector !== undefined ? String(selector) : undefined,
				values:   values !== undefined ? String(values) : undefined
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
		if(operations === undefined) {
			return;
		} else if(this.operations !== undefined) {
			this.operations.set(node.info.id, operations);
		}

		let value: VectorDomain<Domain> = VectorDomain.bottom(this.factory);

		// Create the NA value representation for this domain
		// NA is a special abstract value representing missing data
		const naValue = this.factory(NA);

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

			const isOperandModification = operation === 'updatePositive' || operation === 'updateNegative' ||
				operation === 'updateLogical' || operation === 'setAttr';

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
			'selectPositive',
			'selectNegative',
			'selectLogical',
			'updatePositive',
			'updateNegative',
			'updateLogical'
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
			case 'selectPositive':
				return this.applySelect(value, args.selector as VectorDomain<PosIntervalDomain>, args.naValue as Domain, 'positive');
			case 'selectNegative':
				return this.applySelect(value, args.selector as VectorDomain<PosIntervalDomain>, args.naValue as Domain, 'negative');
			case 'selectLogical':
				return this.applySelect(value, args.selector as VectorDomain<Domain>, args.naValue as Domain, 'logical');
			case 'updatePositive':
				return this.applyUpdate(value, args.selector as VectorDomain<PosIntervalDomain>, args.values as VectorDomain<Domain>, args.naValue as Domain, 'positive');
			case 'updateNegative':
				return this.applyUpdate(value, args.selector as VectorDomain<PosIntervalDomain>, args.values as VectorDomain<Domain>, args.naValue as Domain, 'negative');
			case 'updateLogical':
				return this.applyUpdate(value, args.selector as VectorDomain<Domain>, args.values as VectorDomain<Domain>, args.naValue as Domain, 'logical');
			default:
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
		if(!attrs.isEmpty()) {
			return value.top();
		}
		return value.create({
			length:     value.length,
			values:     value.values,
			summary:    value.summary,
			attributes: attrs
		});
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
		const len1 = value.length;
		const len2 = other.length;
		if(len1.isBottom() || len2.isBottom()) {
			return value.bottom();
		}
		const combinedSummary = value.summary.join(other.summary);
		if(len1.isTop() || len2.isTop()) {
			return value.create({
				length:     len1.top(),
				values:     value.values.top(),
				summary:    combinedSummary,
				attributes: value.attributes.join(other.attributes)
			});
		}
		if(!len1.isValue() || !len2.isValue()) {
			return value.create({
				length:     len1.top(),
				values:     value.values.top(),
				summary:    combinedSummary,
				attributes: value.attributes.join(other.attributes)
			});
		}
		const [l1, u1] = len1.value;
		const [l2, u2] = len2.value;
		const newUpper = Math.max(u1, u2);
		const newLower = Math.max(l1, l2);
		const incompatible = u1 !== +Infinity && u2 !== +Infinity && (u1 % u2 !== 0) && (u2 % u1 !== 0);
		if(incompatible) {
			return value.create({
				length:     len1.top(),
				values:     value.values.top(),
				summary:    combinedSummary,
				attributes: value.attributes.join(other.attributes)
			});
		}
		const recycledLength = len1.create([newLower, newUpper]);
		const combinedValues = value.values.join(other.values);
		return value.create({
			length:     recycledLength,
			values:     combinedValues,
			summary:    combinedSummary,
			attributes: value.attributes.join(other.attributes)
		});
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
			const values1 = value.values.value as readonly Domain[];
			const values2 = other.values.value as readonly Domain[];
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
		return value.create({
			length:     concatenatedLength,
			values:     concatenatedValues,
			summary:    combinedSummary,
			attributes: value.attributes.join(other.attributes)
		});
	}

	/**
	 * Applies the select operation to choose elements from a vector based on a selector.
	 * Dispatches to the appropriate selector-type-specific method.
	 * @param value - The source VectorDomain to select from
	 * @param selector - The selector VectorDomain (interval or value domain)
	 * @param naValue - The NA value for out-of-bounds access
	 * @param selectorType - The type of selector (positive, negative, or logical)
	 * @returns The resulting VectorDomain after selection
	 */
	private applySelect(
		value: VectorDomain<Domain>,
		selector: VectorDomain<PosIntervalDomain> | VectorDomain<Domain>,
		naValue: Domain,
		selectorType: SelectorType
	): VectorDomain<Domain> {
		if(value.isBottom() || selector.isBottom()) {
			return value.bottom();
		}
		if(selectorType === 'positive') {
			return this.applySelectPositive(value, selector as VectorDomain<PosIntervalDomain>, naValue);
		}
		if(selectorType === 'negative') {
			return this.applySelectNegative(value, selector as VectorDomain<PosIntervalDomain>, naValue);
		}
		return this.applySelectLogical(value, selector as VectorDomain<Domain>, naValue);
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
		const adjustedSelector = adjustForZeros(selector);
		const resultKnownPositions: Domain[] = [];
		if(adjustedSelector.values.isValue() && Array.isArray(adjustedSelector.values.value)) {
			const selectorValues = adjustedSelector.values.value as readonly PosIntervalDomain[];
			for(const idx of selectorValues) {
				if(idx.isBottom()) {
					continue;
				}
				if(isEnumerable(idx)) {
					if(idx.isValue()) {
						const [l] = idx.value;
						const pos = l === 0 ? 1 : l;
						if(pos > 0) {
							resultKnownPositions.push(accessPosition(value, pos - 1, naValue));
						}
					} else {
						resultKnownPositions.push(squash(value));
					}
				} else {
					resultKnownPositions.push(squash(value));
				}
			}
		}
		const selectorLen = adjustedSelector.length;
		const isInfinite = selectorLen.isValue() && selectorLen.value[1] === +Infinity;
		const resultSummary = isInfinite ? squash(value) : value.summary.bottom();
		const resultValues = value.values.create(resultKnownPositions);
		return value.create({
			length:     adjustedSelector.length,
			values:     resultValues,
			summary:    resultSummary,
			attributes: value.attributes
		});
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
			const selectorValues = selector.values.value as readonly PosIntervalDomain[];
			for(const idx of selectorValues) {
				if(idx.isBottom()) {
					continue;
				}
				if(idx.isValue()) {
					const [l, u] = idx.value;
					if(l <= 0 && u <= 0) {
						const posLower = Math.abs(u);
						const posUpper = Math.abs(l);
						if(card(idx) === 1) {
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
		const hasNonEnumerable = selector.values.isValue() && (selector.values.value as readonly PosIntervalDomain[]).some(idx => !isEnumerable(idx));
		const numMustDeleted = mustDeleted.length;
		const newUpper = Math.max(0, sourceUpper - numMustDeleted);
		if(hasNonEnumerable || mayDeleted.length > 0) {
			const resultLength = value.length.create([0, newUpper]);
			const resultKnownPositions: Domain[] = [];
			const numPositions = Math.min(newUpper, sourceUpper);
			for(let i = 1; i <= numPositions; i++) {
				if(!mustDeleted.includes(i)) {
					resultKnownPositions.push(accessPosition(value, i - 1, naValue));
				}
			}
			return value.create({
				length:     resultLength,
				values:     value.values.create(resultKnownPositions),
				summary:    value.summary.bottom(),
				attributes: value.attributes
			});
		}
		const resultLength = value.length.create([newUpper, newUpper]);
		const resultKnownPositions: Domain[] = [];
		for(let i = 1; i <= sourceUpper; i++) {
			if(!mustDeleted.includes(i)) {
				resultKnownPositions.push(accessPosition(value, i - 1, naValue));
			}
		}
		return value.create({
			length:     resultLength,
			values:     value.values.create(resultKnownPositions),
			summary:    value.summary.bottom(),
			attributes: value.attributes
		});
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
			return value.create({
				length:     value.length.create([0, 0]),
				values:     value.values.create([]),
				summary:    value.summary.bottom(),
				attributes: value.attributes
			});
		}
		if(sourceLen === +Infinity || selectorLen === +Infinity) {
			return value.create({
				length:     value.length.create([0, +Infinity]),
				values:     value.values.top(),
				summary:    squash(value),
				attributes: value.attributes
			});
		}
		const maxLen = Math.max(sourceLen, selectorLen);
		const resultKnownPositions: Domain[] = [];
		for(let i = 0; i < maxLen; i++) {
			const selectorPos = i % selectorLen;
			let selectorVal: Domain;
			if(selector.values.isValue()) {
				const selectorValues = selector.values.value as readonly Domain[];
				if(selectorPos < selectorValues.length) {
					selectorVal = selectorValues[selectorPos];
				} else {
					selectorVal = selector.summary;
				}
			} else {
				selectorVal = selector.summary;
			}
			const sourceVal = accessPosition(value, i, naValue);
			if(selectorVal.isValue()) {
				resultKnownPositions.push(sourceVal);
			} else {
				resultKnownPositions.push(sourceVal.join(naValue));
			}
		}
		const isInfinite = selector.length.isValue() && selector.length.value[1] === +Infinity;
		return value.create({
			length:     value.length.create([0, resultKnownPositions.length]),
			values:     value.values.create(resultKnownPositions),
			summary:    isInfinite ? squash(value) : value.summary.bottom(),
			attributes: value.attributes
		});
	}

	/**
	 * Applies the update operation to modify elements in a vector based on a selector.
	 * Dispatcher that routes to the appropriate selector-type-specific method.
	 * @param value - The target VectorDomain to update
	 * @param selector - The selector for positions to update
	 * @param values - The values to assign to selected positions
	 * @param naValue - The NA value for out-of-bounds positions
	 * @param selectorType - The type of selector (positive, negative, or logical)
	 * @returns The resulting VectorDomain after update
	 */
	private applyUpdate(
		value: VectorDomain<Domain>,
		selector: VectorDomain<PosIntervalDomain> | VectorDomain<Domain>,
		values: VectorDomain<Domain>,
		naValue: Domain,
		selectorType: SelectorType
	): VectorDomain<Domain> {
		if(value.isBottom() || selector.isBottom() || values.isBottom()) {
			return value.bottom();
		}
		if(selectorType === 'positive') {
			return this.applyUpdatePositive(value, selector as VectorDomain<PosIntervalDomain>, values, naValue);
		}
		if(selectorType === 'negative') {
			return this.applyUpdateNegative(value, selector as VectorDomain<PosIntervalDomain>, values, naValue);
		}
		return this.applyUpdateLogical(value, selector as VectorDomain<Domain>, values, naValue);
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
		const adjustedSelector = adjustForZeros(selector);
		const hasNonEnumerable = adjustedSelector.values.isValue() && (adjustedSelector.values.value as readonly PosIntervalDomain[]).some(idx => !isEnumerable(idx));
		if(hasNonEnumerable) {
			const vAll = squash(value).join(squash(values));
			return value.create({
				length:     value.length.create([value.length.isValue() ? value.length.value[0] : 0, +Infinity]),
				values:     value.values.create([]),
				summary:    vAll,
				attributes: value.attributes
			});
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
			const selectorSummaryEnumerable = isEnumerable(adjustedSelector.summary);
			const summaryLower = adjustedSelector.summary.isValue() ? adjustedSelector.summary.value[0] : 0;
			const uR = Math.max(selectorUpper === +Infinity ? 0 : selectorUpper, summaryLower);
			const selectorKnownPositions = adjustedSelector.values.isValue() ? (adjustedSelector.values.value as readonly PosIntervalDomain[]) : [];
			const baseKnownPositions = initKnownPositions(selectorKnownPositions as unknown as Domain[], sourceLower, sourceUpper, uR, naValue);
			let valuesUpper = 0;
			if(values.length.isValue()) {
				valuesUpper = values.length.value[1];
			}
			const cyclicValues = generateCyclicKnownPositions(values, valuesUpper);
			const resultKnownPositions = updateKnownPositions(baseKnownPositions, selectorKnownPositions, cyclicValues);
			if(!selectorSummaryEnumerable && adjustedSelector.summary.isValue()) {
				const squashValues = squash(values);
				const lS2 = adjustedSelector.summary.value[0];
				for(let i = Math.max(0, lS2 - 1); i < resultKnownPositions.length; i++) {
					resultKnownPositions[i] = resultKnownPositions[i].join(squashValues);
				}
			}
			const resultSummary = value.summary.join(squash(values));
			return value.create({
				length:     value.length.create([sourceLower, +Infinity]),
				values:     value.values.create(resultKnownPositions),
				summary:    resultSummary,
				attributes: value.attributes
			});
		} else {
			let uR = 0;
			if(adjustedSelector.values.isValue()) {
				const selectorKnownPositions = adjustedSelector.values.value as readonly PosIntervalDomain[];
				for(const idx of selectorKnownPositions) {
					if(idx.isValue()) {
						uR = Math.max(uR, idx.value[1]);
					}
				}
			}
			uR = Math.max(uR, sourceUpper);
			const selectorKnownPositions = adjustedSelector.values.isValue() ? (adjustedSelector.values.value as readonly PosIntervalDomain[]) : [];
			const baseKnownPositions = initKnownPositions(selectorKnownPositions as unknown as Domain[], sourceLower, sourceUpper, uR, naValue);
			let valuesUpper = 0;
			if(values.length.isValue()) {
				valuesUpper = values.length.value[1];
			}
			const cyclicValues = generateCyclicKnownPositions(values, Math.max(selectorUpper, valuesUpper));
			const resultKnownPositions = updateKnownPositions(baseKnownPositions, selectorKnownPositions, cyclicValues);
			return value.create({
				length:     value.length.create([sourceLower, uR]),
				values:     value.values.create(resultKnownPositions),
				summary:    value.summary.bottom(),
				attributes: value.attributes
			});
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
			const selectorKnownPositions = adjustedSelector.values.value as readonly PosIntervalDomain[];
			for(const idx of selectorKnownPositions) {
				if(idx.isBottom()) {
					continue;
				}
				if(idx.isValue()) {
					const [l, u] = idx.value;
					if(l <= 0 && u <= 0) {
						const posLower = Math.abs(u);
						const posUpper = Math.abs(l);
						if(card(idx) === 1) {
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
		const hasNonEnumerable = adjustedSelector.values.isValue() && (adjustedSelector.values.value as readonly PosIntervalDomain[]).some(idx => !isEnumerable(idx));
		const v = squash(values);
		if(hasNonEnumerable) {
			const sourceKnownPositions = value.values.isValue() ? (value.values.value as readonly Domain[]) : [];
			const resultKnownPositions: Domain[] = [];
			for(let i = 1; i <= sourceUpper; i++) {
				const idx = i - 1;
				let val: Domain;
				if(idx < sourceKnownPositions.length) {
					val = sourceKnownPositions[idx];
				} else {
					val = value.summary;
				}
				if(!mustNotUpdated.includes(i)) {
					val = val.join(v);
				}
				resultKnownPositions.push(val);
			}
			const resultSummary = value.summary.join(v);
			return value.create({
				length:     value.length,
				values:     value.values.create(resultKnownPositions),
				summary:    resultSummary,
				attributes: value.attributes
			});
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
			const sourceKnownPositions = value.values.isValue() ? (value.values.value as readonly Domain[]) : [];
			const resultKnownPositions: Domain[] = [];
			for(let i = 0; i < uR; i++) {
				if(i < sourceKnownPositions.length) {
					resultKnownPositions.push(sourceKnownPositions[i]);
				} else if(i < sourceUpper) {
					resultKnownPositions.push(value.summary);
				} else {
					resultKnownPositions.push(naValue);
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
			return value.create({
				length:     value.length.create([value.length.isValue() ? value.length.value[0] : 0, uR]),
				values:     value.values.create(resultKnownPositions),
				summary:    value.summary.bottom(),
				attributes: value.attributes
			});
		}
	}

	/**
	 * Applies logical indexing update: x[c] \&lt;- v where c is a logical vector.
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
		const sourceKnownPositions = value.values.isValue() ? (value.values.value as readonly Domain[]) : [];
		const selectorKnownPositions = selector.values.isValue() ? (selector.values.value as readonly Domain[]) : [];
		const maxLen = Math.max(sourceKnownPositions.length, selectorKnownPositions.length);
		const resultKnownPositions: Domain[] = [];
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
			let selectorVal: Domain;
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
		return value.create({
			length:     value.length.create([sourceLower, resultUpper]),
			values:     value.values.create(resultKnownPositions),
			summary:    resultSummary,
			attributes: value.attributes
		});
	}
}