import { type ResolveInfo, resolveIdToValue } from '../../dataflow/eval/resolve/alias-tracking';
import type { RArgument } from '../../r-bridge/lang-4.x/ast/model/nodes/r-argument';
import type { ParentInformation } from '../../r-bridge/lang-4.x/ast/model/processing/decorate';
import type { NodeId } from '../../r-bridge/lang-4.x/ast/model/processing/node-id';
import type { RNode } from '../../r-bridge/lang-4.x/ast/model/model';
import { RType } from '../../r-bridge/lang-4.x/ast/model/type';
import { unliftRValue, unwrapRValue, unwrapRVector } from '../../util/r-value';
import type { AnyAbstractDomain, ConcreteDomain } from '../domains/abstract-domain';
import type { ArithmeticDomain } from '../domains/arithmetic-domain';
import { VectorDomain } from './vector-domain';
import type { DomainFactory } from './known-initial-positions-domain';
import { PosIntervalDomain } from '../domains/positive-interval-domain';
import { VectorAttrDomain } from '../domains/vector-attr-domain';
import { KnownInitialPositionsDomain } from './known-initial-positions-domain';
import { NAAwareDomain } from './na-aware-domain';
import { RNa } from '../../r-bridge/lang-4.x/convert-values';
import { RSymbol } from '../../r-bridge/lang-4.x/ast/model/nodes/r-symbol';
import type { RVectorTypes, RVectorType } from '../domains/vector-type-domain';
import { RVectorTypeDomain } from '../domains/vector-type-domain';
import type { RStringValue, RNumberValue } from '../../r-bridge/lang-4.x/convert-values';
import type { RLogicalValue } from '../../r-bridge/lang-4.x/ast/model/nodes/r-logical';

/**
 * Maps a primitive JavaScript value to its corresponding R vector type.
 * - number -\> 'double' (R treats numeric literals as double by default)
 * - number (markedAsInt=true) -\> 'integer' (R integer literals like 42L)
 * - string -\> 'character'
 * - boolean -\> 'logical'
 * @param value - The primitive value
 * @param isMarkedAsInt - Whether the number is marked as an R integer literal (e.g., 42L)
 */
function primitiveToRType(value: string | number | boolean, isMarkedAsInt = false): RVectorType {
	if(typeof value === 'string') {
		return 'character';
	}
	if(typeof value === 'boolean') {
		return 'logical';
	}
	// number -> integer if marked with L suffix, otherwise double
	return isMarkedAsInt ? 'integer' : 'double';
}

/**
 * Computes the vector type from an array of primitive values.
 * Starts with the first element's type and LUBs (joins) with subsequent types.
 * Returns Top if the array is empty.
 */
function computeVectorTypeFromValues(values: (string | number | boolean | undefined)[]): RVectorTypeDomain {
	if(values.length === 0) {
		return RVectorTypeDomain.top();
	}

	// Filter out undefined values
	const definedValues = values.filter((v): v is string | number | boolean => v !== undefined);
	if(definedValues.length === 0) {
		return RVectorTypeDomain.top();
	}

	// Start with first value's type, then join with subsequent types
	let resultType: RVectorType | typeof RVectorTypes = primitiveToRType(definedValues[0]);
	for(let i = 1; i < definedValues.length; i++) {
		const currentType = primitiveToRType(definedValues[i]);
		resultType = RVectorTypeDomain.of(resultType).join(RVectorTypeDomain.of(currentType)).value;
	}

	return RVectorTypeDomain.of(resultType);
}

/**
 * Converts a primitive value (string, number, boolean) to the domain's concrete type.
 * This function must be provided by the caller based on the specific domain being used.
 * @template Domain - The abstract domain type
 * @param value - The primitive value to convert
 * @returns A set of concrete domain values, or undefined to indicate NA
 */
export type ValueToDomainConverter<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>> = (
	value: string | number | boolean
) => ReadonlySet<ConcreteDomain<Domain>> | undefined;

/**
 * Extracts the R vector type from a lifted R value (RStringValue, RNumberValue, or RLogicalValue).
 * Returns undefined for non-literal values (like 'fn-def' or null).
 */
function extractTypeFromLiftedValue(value: RStringValue | RNumberValue | RLogicalValue | 'fn-def' | null): RVectorType | undefined {
	if(typeof value === 'object' && value !== null && 'str' in value) {
		return 'character';
	}
	if(typeof value === 'object' && value !== null && 'num' in value) {
		const numValue = value;
		return numValue.markedAsInt ? 'integer' : 'double';
	}
	if(typeof value === 'boolean') {
		return 'logical';
	}
	return undefined;
}

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
export function resolveIdToVectorValue<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
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
		// Compute type from the lifted value (preserves markedAsInt info)
		const elementType = extractTypeFromLiftedValue(unliftedValue);
		const vectorType = elementType !== undefined ? RVectorTypeDomain.of(elementType) : undefined;
		return buildVectorFromDomainValues([domainValues], factory, vectorType);
	}

	// unliftedValue is (RStringValue | RNumberValue | RLogicalValue | 'fn-def' | null)[]
	// Filter out non-literal values and extract both primitive values and type info
	const domainValueSets: (ReadonlySet<ConcreteDomain<Domain>> | undefined)[] = [];
	const elementTypes: RVectorType[] = [];

	for(const val of unliftedValue) {
		if(val === null || val === 'fn-def') {
			// Non-literal value - skip
			continue;
		}
		const elementType = extractTypeFromLiftedValue(val);
		if(elementType === undefined) {
			continue;
		}

		// Extract primitive value for valueToDomain
		let primitiveValue: string | number | boolean;
		if(typeof val === 'object' && 'str' in val) {
			primitiveValue = (val).str;
		} else if(typeof val === 'object' && 'num' in val) {
			primitiveValue = (val).num;
		} else {
			primitiveValue = val;
		}

		const domainValues = valueToDomain(primitiveValue);
		domainValueSets.push(domainValues);
		elementTypes.push(elementType);
	}

	// Compute vector type by joining all element types
	const vectorType = elementTypes.length > 0
		? elementTypes.reduce((acc, t) => acc.join(RVectorTypeDomain.of(t)), RVectorTypeDomain.of(elementTypes[0]))
		: undefined;

	return buildVectorFromDomainValues(domainValueSets, factory, vectorType);
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
 * @param vectorType - Optional R vector type (defaults to Bottom if not provided)
 * @returns A VectorDomain with the specified values
 */
export function buildVectorFromDomainValues<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	domainValueSets: (ReadonlySet<ConcreteDomain<Domain>> | undefined)[],
	factory: DomainFactory<Domain>,
	vectorType?: RVectorTypeDomain
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

	const typeDomain = vectorType ?? RVectorTypeDomain.bottom();

	return new VectorDomain({
		length:     new PosIntervalDomain([domainValueSets.length, domainValueSets.length]),
		known:      knownPositions,
		summary:    summaryBottom,
		attributes: VectorAttrDomain.empty(),
		type:       typeDomain
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
export function buildVectorFromLiteral<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
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
			attributes: VectorAttrDomain.empty(),
			type:       RVectorTypeDomain.of('logical')
		}, factory);
	}

	let primitiveValue: string | number | boolean | undefined;
	let isMarkedAsInt = false;

	if(node.type === RType.Number) {
		primitiveValue = node.content.num;
		isMarkedAsInt = node.content.markedAsInt;
	} else if(node.type === RType.String) {
		primitiveValue = node.content.str;
	} else if(node.type === RType.Logical) {
		primitiveValue = node.content;
	}

	if(primitiveValue === undefined) {
		return undefined;
	}

	const domainValues = valueToDomain(primitiveValue);
	const vectorType = RVectorTypeDomain.of(primitiveToRType(primitiveValue, isMarkedAsInt));
	return buildVectorFromDomainValues([domainValues], factory, vectorType);
}

/**
 * Builds a top VectorDomain (unknown vector).
 * @template Domain - The abstract domain type for vector elements
 * @param factory - The domain factory for creating element domain values
 * @returns A VectorDomain representing any possible vector
 */
export function buildVectorTop<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
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
export function buildVectorBottom<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
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
