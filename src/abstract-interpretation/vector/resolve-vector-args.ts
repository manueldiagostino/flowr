import { type ResolveInfo, resolveIdToValue } from '../../dataflow/eval/resolve/alias-tracking';
import type { RArgument } from '../../r-bridge/lang-4.x/ast/model/nodes/r-argument';
import type { ParentInformation } from '../../r-bridge/lang-4.x/ast/model/processing/decorate';
import type { NodeId } from '../../r-bridge/lang-4.x/ast/model/processing/node-id';
import type { RNode } from '../../r-bridge/lang-4.x/ast/model/model';
import { RType } from '../../r-bridge/lang-4.x/ast/model/type';
import { unliftRValue, unwrapRValue, unwrapRVector } from '../../util/r-value';
import type { AnyAbstractDomain, ConcreteDomain } from '../domains/abstract-domain';
import { VectorDomain } from './vector-domain';
import type { DomainFactory } from './known-initial-positions-domain';
import { PosIntervalDomain } from '../domains/positive-interval-domain';
import { VectorAttrDomain } from '../domains/vector-attr-domain';
import { NA } from '../domains/lattice';
import { KnownInitialPositionsDomain } from './known-initial-positions-domain';
import { NAAwareDomain } from './na-aware-domain';
import { RNa } from '../../r-bridge/lang-4.x/convert-values';
import { RSymbol } from '../../r-bridge/lang-4.x/ast/model/nodes/r-symbol';
import { RVectorTypeDomain } from '../domains/vector-type-domain';

/**
 * Converts a primitive value (string, number, boolean) to the domain's concrete type.
 * This function must be provided by the caller based on the specific domain being used.
 * @template Domain - The abstract domain type
 * @param value - The primitive value to convert
 * @returns A set of concrete domain values, or undefined to indicate NA
 */
export type ValueToDomainConverter<Domain extends AnyAbstractDomain> = (
	value: string | number | boolean
) => ReadonlySet<ConcreteDomain<Domain>> | undefined;

/**
 * Resolves the value of a node ID to its VectorDomain representation.
 * This function attempts to resolve the node to a concrete value and then
 * constructs a VectorDomain from it using the provided factory and converter.
 * @template Domain - The abstract domain type for vector elements
 * @param id - The node ID or RArgument to resolve
 * @param info - The resolve info containing environment and graph
 * @param factory - The domain factory for creating element domain values
 * @param valueToDomain - A function that converts primitive values to domain concrete values
 * @returns The VectorDomain representation of the resolved value, or undefined if resolution fails
 */
export function resolveIdToVectorValue<Domain extends AnyAbstractDomain>(
	id: NodeId | RArgument<ParentInformation> | undefined,
	info: ResolveInfo,
	factory: DomainFactory<Domain>,
	valueToDomain: ValueToDomainConverter<Domain>
): VectorDomain<Domain> | undefined {
	const node = resolveIdToArgument(id, info);

	if(node?.value === undefined) {
		return undefined;
	}

	const resolvedValue = resolveIdToValue(node.value, info);
	const unliftedValue = unliftRValue(resolvedValue);

	if(unliftedValue === undefined) {
		return undefined;
	}

	if(!Array.isArray(unliftedValue)) {
		const unwrapped = unwrapRValue(unliftedValue);
		if(unwrapped === undefined) {
			return undefined;
		}
		const domainValues = valueToDomain(unwrapped);
		if(domainValues === undefined) {
			return undefined;
		}
		return buildVectorFromDomainValues([domainValues], factory);
	}

	const unwrappedArray = unwrapRVector(unliftedValue);
	if(unwrappedArray === undefined) {
		return undefined;
	}

	const domainValueSets: (ReadonlySet<ConcreteDomain<Domain>> | undefined)[] = [];
	for(const val of unwrappedArray) {
		const domainValues = valueToDomain(val);
		domainValueSets.push(domainValues);
	}

	return buildVectorFromDomainValues(domainValueSets, factory);
}

/**
 * Resolves the vector length from an AST node.
 * @param id - The node ID or RArgument to resolve
 * @param info - The resolve info containing environment and graph
 * @returns The resolved vector length as a number, or undefined if resolution fails
 */
export function resolveIdToVectorLength(
	id: NodeId | RArgument<ParentInformation> | undefined,
	info: ResolveInfo
): number | undefined {
	const node = resolveIdToArgument(id, info);

	if(node?.value === undefined) {
		return undefined;
	}

	const resolvedValue = resolveIdToValue(node.value, info);
	const unliftedValue = unliftRValue(resolvedValue);

	if(unliftedValue === undefined) {
		return undefined;
	}

	if(!Array.isArray(unliftedValue)) {
		const unwrapped = unwrapRValue(unliftedValue);
		return unwrapped !== undefined ? 1 : undefined;
	}

	const unwrappedArray = unwrapRVector(unliftedValue);
	if(unwrappedArray === undefined) {
		return undefined;
	}

	return unwrappedArray.length;
}

/**
 * Builds a VectorDomain from an array of domain value sets.
 * @template Domain - The abstract domain type for vector elements
 * @param domainValueSets - Array of sets of concrete domain values (or undefined for NA)
 * @param factory - The domain factory for creating element domain values
 * @returns A VectorDomain with the specified values
 */
export function buildVectorFromDomainValues<Domain extends AnyAbstractDomain>(
	domainValueSets: (ReadonlySet<ConcreteDomain<Domain>> | undefined)[],
	factory: DomainFactory<Domain>
): VectorDomain<Domain> {
	if(domainValueSets.length === 0) {
		// Empty vector: length [0,0], empty prefix ε, bottom summary/attributes
		// Paper: genvecalpha(rEmpty) = ([0,0], ε, genvalbot, attrbot)
		return VectorDomain.empty(factory);
	}

	// Wrap each element domain in NAAwareDomain (hasNA: false for concrete values)
	const elementDomains = domainValueSets.map(values => {
		const innerDomain = factory(values);
		return new NAAwareDomain({ inner: innerDomain, hasNA: false }, factory);
	});
	const smartFactory = NAAwareDomain.createSmartFactory(factory);
	const knownPositions = new KnownInitialPositionsDomain(
		elementDomains,
		smartFactory
	);
	const summaryBottom = NAAwareDomain.bottom(factory);

	return new VectorDomain({
		length:     new PosIntervalDomain([domainValueSets.length, domainValueSets.length]),
		known:      knownPositions,
		summary:    summaryBottom,
		attributes: VectorAttrDomain.top(),
		type:       RVectorTypeDomain.top()
	}, factory);
}

/**
 * Builds a VectorDomain from an R literal node (RNumber, RString, RLogical, or NA symbol).
 * @template Domain - The abstract domain type for vector elements
 * @param node - The R node to build the vector from
 * @param factory - The domain factory for creating element domain values
 * @param valueToDomain - A function that converts primitive values to domain concrete values
 * @returns A VectorDomain with the literal value, or undefined if the node is not a literal
 */
export function buildVectorFromLiteral<Domain extends AnyAbstractDomain>(
	node: RNode<ParentInformation>,
	factory: DomainFactory<Domain>,
	valueToDomain: ValueToDomainConverter<Domain>
): VectorDomain<Domain> | undefined {
	// Handle NA symbol - NA is parsed as RSymbol with content === 'NA'
	if(RSymbol.isSpecial(node) && node.content === RNa) {
		// Create pure NA value (inner is Bottom, hasNA is true)
		const naValue = NAAwareDomain.na(factory);
		const smartFactory = NAAwareDomain.createSmartFactory(factory);
		const knownPositions = new KnownInitialPositionsDomain(
			[naValue],
			smartFactory
		);
		const summaryBottom = NAAwareDomain.bottom(factory);

		return new VectorDomain({
			length:     new PosIntervalDomain([1, 1]),
			known:      knownPositions,
			summary:    summaryBottom,
			attributes: VectorAttrDomain.top(),
			type:       RVectorTypeDomain.of('logical')
		}, factory);
	}

	let primitiveValue: string | number | boolean | undefined;

	if(node.type === RType.Number) {
		primitiveValue = node.content.num;
	} else if(node.type === RType.String) {
		primitiveValue = node.content.str;
	} else if(node.type === RType.Logical) {
		primitiveValue = node.content;
	}

	if(primitiveValue === undefined) {
		return undefined;
	}

	const domainValues = valueToDomain(primitiveValue);
	return buildVectorFromDomainValues([domainValues], factory);
}

/**
 * Builds a top VectorDomain (unknown vector).
 * @template Domain - The abstract domain type for vector elements
 * @param factory - The domain factory for creating element domain values
 * @returns A VectorDomain representing any possible vector
 */
export function buildVectorTop<Domain extends AnyAbstractDomain>(
	factory: DomainFactory<Domain>
): VectorDomain<Domain> {
	return VectorDomain.top(factory);
}

/**
 * Builds a bottom VectorDomain (no possible vector).
 * @template Domain - The abstract domain type for vector elements
 * @param factory - The domain factory for creating element domain values
 * @returns A VectorDomain representing no possible vector
 */
export function buildVectorBottom<Domain extends AnyAbstractDomain>(
	factory: DomainFactory<Domain>
): VectorDomain<Domain> {
	return VectorDomain.bottom(factory);
}

/**
 * Resolves a node ID or RArgument to an RArgument by looking it up in the idMap.
 * @param id - The node ID or RArgument to resolve
 * @param info - The resolve info containing graph and idMap
 * @returns The resolved RArgument, or undefined if not found or not an argument
 */
function resolveIdToArgument(
	id: NodeId | RArgument<ParentInformation> | undefined,
	{ graph, idMap }: ResolveInfo
): RArgument<ParentInformation> | undefined {
	idMap ??= graph?.idMap;
	const node = id === undefined || typeof id === 'object' ? id : idMap?.get(id);

	if(node?.type === RType.Argument) {
		return node;
	}
	return undefined;
}
