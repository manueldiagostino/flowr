import type { DataflowGraphVertexFunctionCall } from '../../dataflow/graph/vertex';
import type { RNode } from '../../r-bridge/lang-4.x/ast/model/model';
import type { ParentInformation } from '../../r-bridge/lang-4.x/ast/model/processing/decorate';
import type { NodeId } from '../../r-bridge/lang-4.x/ast/model/processing/node-id';
import { AbstractInterpretationVisitor, type AbsintVisitorConfiguration } from '../absint-visitor';
import type { AnyAbstractDomain } from '../domains/abstract-domain';
import { VectorDomain } from './vector-domain';
import {
	applyVectorSemantics,
	ConstraintType,
	getConstraintType,
	type VectorOperations
} from './vector-semantics';
import { mapVectorFunction } from './mappers/function-mapper';
import { mapVectorAccess } from './mappers/access-mapper';
import { mapVectorReplacement } from './mappers/replacement-mapper';
import { NA, Top } from '../domains/lattice';
import type { ConcreteDomain } from '../domains/abstract-domain';
import { type ValueToDomainConverter, buildVectorFromLiteral } from './resolve-vector-args';
import type { RNumber } from '../../r-bridge/lang-4.x/ast/model/nodes/r-number';
import type { RString } from '../../r-bridge/lang-4.x/ast/model/nodes/r-string';
import type { RLogical } from '../../r-bridge/lang-4.x/ast/model/nodes/r-logical';
import type { RSymbol } from '../../r-bridge/lang-4.x/ast/model/nodes/r-symbol';
import type { DataflowGraphVertexValue } from '../../dataflow/graph/vertex';
import { RNa } from '../../r-bridge/lang-4.x/convert-values';

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
	private readonly operations?: Map<NodeId, VectorOperations>;
	private readonly factory: import('./vector-domain').DomainFactory<Domain>;
	private readonly valueConverter: ValueToDomainConverter<Domain>;

	constructor(
		factory: import('./vector-domain').DomainFactory<Domain>,
		valueConverter: ValueToDomainConverter<Domain>,
		{ trackOperations = true, ...config }: VectorInferenceConfiguration
	) {
		super(config, VectorDomain.top(factory));
		this.factory = factory;
		this.valueConverter = valueConverter;

		if (trackOperations) {
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
	 * Handles function call nodes in the dataflow graph.
	 * Maps R function calls (c(), arithmetic, seq, rep, etc.) to vector operations.
	 * @param call - The function call vertex from the dataflow graph
	 */
	protected override onFunctionCall({ call }: { call: DataflowGraphVertexFunctionCall }): void {
		super.onFunctionCall({ call });

		const node = this.getNormalizedAst(call.id);

		if (node === undefined) {
			return;
		}
		const operations = mapVectorFunction(node, this, this.config.dfg, this.config.ctx);
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

		if (node === undefined) {
			return;
		}
		const operations = mapVectorReplacement(node, sourceNode, this, this.config.dfg, this.config.ctx);
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

		if (node === undefined) {
			return;
		}
		const operations = mapVectorAccess(node, this, this.config.dfg, this.config.ctx);
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
		if (vectorDomain !== undefined) {
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
		if (vectorDomain !== undefined) {
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
		if (vectorDomain !== undefined) {
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
		if (vectorDomain !== undefined) {
			this.updateState(node.info.id, vectorDomain);
		}
	}

	/**
	 * Applies a sequence of vector operations to compute the resulting abstract value.
	 * Iterates through the operations in sequence, where the result of each operation
	 * becomes the operand for the next.
	 *
	 * @param node - The R node being processed
	 * @param operations - The sequence of operations to apply (undefined if no operations)
	 */
	private applyVectorExpression(node: RNode<ParentInformation>, operations: VectorOperations): void {
		if (operations === undefined) {
			return;
		} else if (this.operations !== undefined) {
			this.operations.set(node.info.id, operations);
		}

		let value: VectorDomain<Domain> = VectorDomain.bottom(this.factory);

		// Create the NA value representation for this domain
		// NA is a special abstract value representing missing data
		const naValue = this.factory(NA);

		for (const { operation, operand, type, ...args } of operations) {
			// Convert string operand to NodeId (number) if needed
			const operandId = operand !== undefined ? Number(operand) as NodeId : undefined;
			const operandValue = operandId !== undefined ? this.getAbstractValue(operandId, this.currentState) : value;
			const effectiveOperand = operandValue ?? VectorDomain.bottom(this.factory);

			const resolvedArgs = this.resolveOperationArgs(args);
			const argsWithNaValue = this.injectNaValueIfNeeded(operation, resolvedArgs, naValue);

			value = applyVectorSemantics(
				operation,
				effectiveOperand,
				argsWithNaValue as Parameters<typeof applyVectorSemantics>[2]
			) as VectorDomain<Domain>;

			const constraintType = type ?? getConstraintType(operation);

			if (operand !== undefined && constraintType === ConstraintType.OperandModification) {
				this.updateState(operand, value);
				for (const origin of this.getVariableOrigins(operand)) {
					this.updateState(origin, value);
				}
			} else if (constraintType === ConstraintType.ResultPostcondition) {
				this.updateState(node.info.id, value);
			}
		}
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
		// Operations that need naValue
		const operationsNeedingNaValue = new Set([
			'selectPositive',
			'selectNegative',
			'selectLogical',
			'updatePositive',
			'updateNegative',
			'updateLogical'
		]);

		if (operationsNeedingNaValue.has(operation) && !('naValue' in args)) {
			return { ...args, naValue };
		}

		return args;
	}

	/**
	 * Resolves operation arguments that are node IDs to their VectorDomain values.
	 * This is needed for operations like 'recycle' that take multiple vector operands.
	 * @param args - The raw operation arguments (may contain node IDs as strings)
	 * @returns The resolved arguments with VectorDomain values
	 */
	private resolveOperationArgs(args: Record<string, unknown>): Record<string, unknown> {
		const resolved: Record<string, unknown> = { ...args };

		if ('other' in args && typeof args.other === 'string') {
			const otherId = Number(args.other) as NodeId;
			const otherValue = this.getAbstractValue(otherId, this.currentState);
			resolved.other = otherValue ?? VectorDomain.bottom(this.factory);
		}

		if ('selector' in args && typeof args.selector === 'string') {
			const selectorId = Number(args.selector) as NodeId;
			const selectorValue = this.getAbstractValue(selectorId, this.currentState);
			resolved.selector = selectorValue ?? VectorDomain.bottom(this.factory);
		}

		return resolved;
	}
}
