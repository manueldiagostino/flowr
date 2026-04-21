/* eslint-disable tsdoc/syntax */
/* eslint-disable @typescript-eslint/unified-signatures */
import type { AnyAbstractDomain } from '../domains/abstract-domain';
import { PosIntervalDomain } from '../domains/positive-interval-domain';
import { ProductDomain } from '../domains/product-domain';
import { KnownInitialPositionsDomain } from './known-initial-positions-domain';
import type { DomainFactory } from './known-initial-positions-domain';
import { VectorAttrDomain } from '../domains/vector-attr-domain';
import { NAAwareDomain } from './na-aware-domain';
import { RVectorTypeDomain } from '../domains/vector-type-domain';
import { IntervalDomain } from '../domains/interval-domain';

export type { DomainFactory } from './known-initial-positions-domain';

/**
 * The result of classifying positions in a selector vector into
 * positive and negative groups for abstract filtering (paper Section 4.7).
 *
 * - `positive`: positions where γ(p) ⊆ Z≥0 ∪ {NA} (used for positive indexing like `x[c]` where c ≥ 0)
 * - `negative`: positions where γ(p) ⊆ Z≤0 (used for negative indexing like `x[c]` where c ≤ 0, excluding NA)
 * - `positiveHasBottom`: true if any position was bottom and omitted from the positive array
 * - `negativeHasBottom`: true if any position was bottom and omitted from the negative array
 */
export interface AbstractFilterResult {
	/** Positions classified as positive (Z≥0 ∪ {NA}) */
	positive:          NAAwareDomain<IntervalDomain>[];
	/** Positions classified as negative (Z≥0 ∪ {NA}) */
	negative:          NAAwareDomain<IntervalDomain>[];
	/** Whether any bottom position was omitted from the positive group */
	positiveHasBottom: boolean;
	/** Whether any bottom position was omitted from the negative group */
	negativeHasBottom: boolean;
}

/**
 * Splits an ambiguous NA-aware interval position into its positive and negative components.
 *
 * Splitting rules (paper Section 4.7):
 * - NA always goes to the positive part (NA ∈ Z≥0 ∪ {NA})
 * - Positive interval part: [max(0, lower), upper] if upper ≥ 0
 * - Negative interval part: [lower, min(0, upper)] if lower ≤ 0
 * @param pos - The NA-aware interval position to split (must be classified as 'ambiguous')
 * @param factory - Domain factory for creating NAAwareDomain values
 * @returns Object with positive and/or negative components (null if that component would be empty)
 */
export function splitNAAwarePosition(
	pos: NAAwareDomain<IntervalDomain>,
	factory: DomainFactory<IntervalDomain>
): { positive: NAAwareDomain<IntervalDomain> | null; negative: NAAwareDomain<IntervalDomain> | null } {
	// Case 10: Top splits into [0, +∞] with NA and [-∞, 0] without NA
	if(pos.isTop()) {
		const positiveInterval = new IntervalDomain([0, Infinity]);
		const negativeInterval = new IntervalDomain([-Infinity, 0]);

		if(positiveInterval.isBottom() && negativeInterval.isBottom()) {
			return { positive: null, negative: null };
		}

		const positive = positiveInterval.isBottom()
			? null
			: new NAAwareDomain({ inner: positiveInterval, hasNA: true }, factory);
		const negative = negativeInterval.isBottom()
			? null
			: new NAAwareDomain({ inner: negativeInterval, hasNA: false }, factory);

		return { positive, negative };
	}

	if(pos.isBottom() || pos.isNA()) {
		if(pos.isNA()) {
			return { positive: NAAwareDomain.na(factory), negative: null };
		}
		return { positive: null, negative: null };
	}

	let inner: AnyAbstractDomain = pos.inner;
	let hasNA = pos.containsNA();

	while(inner instanceof NAAwareDomain) {
		hasNA = hasNA || (inner as NAAwareDomain<AnyAbstractDomain>).containsNA();
		if(inner.isBottom()) {
			return { positive: null, negative: null };
		}
		if(inner.isTop()) {
			const positiveInterval = new IntervalDomain([0, Infinity]);
			const negativeInterval = new IntervalDomain([-Infinity, 0]);
			const positive = positiveInterval.isBottom()
				? null
				: new NAAwareDomain({ inner: positiveInterval, hasNA }, factory);
			const negative = negativeInterval.isBottom()
				? null
				: new NAAwareDomain({ inner: negativeInterval, hasNA: false }, factory);
			return { positive, negative };
		}
		if(inner instanceof NAAwareDomain && inner.isNA()) {
			return { positive: NAAwareDomain.na(factory), negative: null };
		}
		inner = (inner as NAAwareDomain<AnyAbstractDomain>).inner;
	}

	// inner is now guaranteed to be IntervalDomain (or PosIntervalDomain)
	const interval = inner as IntervalDomain;

	if(interval.isBottom()) {
		return { positive: null, negative: null };
	}

	// Case: inner is Top (but hasNA is false, so pos itself is not Top)
	// Top interval spans everything → split like Top case
	if(interval.isTop()) {
		const positiveInterval = new IntervalDomain([0, Infinity]);
		const negativeInterval = new IntervalDomain([-Infinity, 0]);
		const positive = positiveInterval.isBottom()
			? null
			: new NAAwareDomain({ inner: positiveInterval, hasNA: false }, factory);
		const negative = negativeInterval.isBottom()
			? null
			: new NAAwareDomain({ inner: negativeInterval, hasNA: false }, factory);
		return { positive, negative };
	}


	const [lower, upper] = interval.value as readonly [number, number];

	const positiveParts: NAAwareDomain<IntervalDomain>[] = [];
	const negativeParts: NAAwareDomain<IntervalDomain>[] = [];

	// Case 1/5/6/8: NA always goes to the positive part (NA ∈ Z≥0 ∪ {NA})
	if(hasNA) {
		positiveParts.push(NAAwareDomain.na(factory));
	}

	if(upper >= 0 && lower >= 0) {
		positiveParts.push(new NAAwareDomain({ inner: interval, hasNA: false }, factory));
	} else if(upper >= 0) {
		// Positive half: [0, upper]
		const positiveInterval = new IntervalDomain([0, upper]);
		if(!positiveInterval.isBottom()) {
			positiveParts.push(new NAAwareDomain({ inner: positiveInterval, hasNA: false }, factory));
		}
	}

	if(lower <= 0 && upper <= 0) {
		negativeParts.push(new NAAwareDomain({ inner: interval, hasNA: false }, factory));
	} else if(lower <= 0) {
		// Negative half: [lower, 0]
		const negativeInterval = new IntervalDomain([lower, 0]);
		if(!negativeInterval.isBottom()) {
			negativeParts.push(new NAAwareDomain({ inner: negativeInterval, hasNA: false }, factory));
		}
	}

	const positive = positiveParts.length === 0
		? null
		: positiveParts.length === 1
			? positiveParts[0]
			: positiveParts.reduce((a, b) => a.join(b));
	const negative = negativeParts.length === 0
		? null
		: negativeParts.length === 1
			? negativeParts[0]
			: negativeParts.reduce((a, b) => a.join(b));

	return { positive, negative };
}

/**
 * The abstract product representing the abstraction of an R vector.
 * - length: the possible range of vector lengths [min, max]
 * - known: a sequence of abstract values for the known positions (positions 0 to k-1)
 * - summary: a single abstract value summarizing ALL positions from k onwards (if any)
 * - attributes: abstraction of the R vector attributes (names, dim, class, other)
 * - type: the R vector type (logical, integer, double, complex, character)
 *
 * Invariants maintained by reduce():
 * 1. known.length ≤ length.upper (if length.upper is finite)
 * 2. If length.lower \> known.length, positions [known.length, length.lower-1] are Bottom
 * 3. If values array grows beyond a threshold, excess elements are joined into summary
 * @template Domain - The abstract domain for individual vector elements
 */
export type VectorProduct<Domain extends AnyAbstractDomain> = {
	/** The possible range of vector lengths as [min, max] interval */
	length:     PosIntervalDomain;
	/** Known abstract values for positions 0 to known.length-1 (NAAware wrapped) */
	known:      KnownInitialPositionsDomain<NAAwareDomain<Domain>>;
	/** Abstract value summarizing all positions from known.length onwards */
	summary:    NAAwareDomain<Domain>;
	/** Abstraction of R vector attributes (names, dim, class, other) */
	attributes: VectorAttrDomain;
	/** The R vector type (logical, integer, double, complex, character) */
	type:       RVectorTypeDomain;
};

/**
 * Safety limit for the maximum number of elements to track in the known positions.
 * This is a fallback to prevent extreme memory usage in pathological cases.
 * Under normal operation, widening should control growth of known positions.
 */
const SafetyMaxKnownLength = 1000;

/**
 * The vector abstract domain as a reduced product of length, known positions, and summary.
 *
 * The lattice structure follows the component-wise ordering with reduction
 * to maintain consistency between components.
 * @template Domain - The abstract domain for individual vector elements
 */
export class VectorDomain<Domain extends AnyAbstractDomain> extends ProductDomain<VectorProduct<Domain>> {
	private readonly _factory: DomainFactory<Domain>;

	/**
	 * Creates a VectorDomain from input values.
	 * @param value - The already-normalized product value
	 * @param factory - The domain factory for creating element domain values
	 */
	constructor(value: VectorProduct<Domain>, factory: DomainFactory<Domain>) {
		super(value);
		this._factory = factory;
	}

	public create(value: VectorProduct<Domain>): this;
	public create(value: VectorProduct<Domain>): VectorDomain<Domain> {
		return new VectorDomain(value, this._factory);
	}

	/**
	 * The current abstract value of the length domain.
	 */
	public get length(): VectorProduct<Domain>['length'] {
		return this.value.length;
	}

	/**
	 * The current abstract values for the known positions.
	 */
	public get known(): VectorProduct<Domain>['known'] {
		return this.value.known;
	}

	/**
	 * The summary abstract value for all positions beyond the known positions.
	 */
	public get summary(): VectorProduct<Domain>['summary'] {
		return this.value.summary;
	}

	/**
	 * The attribute abstraction representing the set of attributes the vector may possess.
	 */
	public get attributes(): VectorProduct<Domain>['attributes'] {
		return this.value.attributes;
	}

	/**
	 * The type abstraction representing the R vector type (logical, integer, double, complex, character).
	 */
	public get type(): VectorProduct<Domain>['type'] {
		return this.value.type;
	}

	/**
	 * The plain factory for creating inner domain values (without NA wrapping).
	 * This is the factory originally provided by the user.
	 */
	public get plainFactory(): DomainFactory<Domain> {
		return this._factory;
	}

	/**
	 * The NA-aware factory for creating NAAwareDomain-wrapped values.
	 * Derived from the plain factory using createSmartFactory.
	 */
	public get naAwareFactory(): DomainFactory<NAAwareDomain<Domain>> {
		return NAAwareDomain.createSmartFactory(this._factory);
	}

	/**
	 * @deprecated Use plainFactory or naAwareFactory explicitly
	 */
	public get factory(): DomainFactory<NAAwareDomain<Domain>> {
		return this.naAwareFactory;
	}

	/**
	 * Factory method to create a VectorDomain with explicit NAAwareDomain wrapping.
	 *
	 * All values and summary must be explicitly wrapped in NAAwareDomain, making NA-awareness
	 * part of the type system and eliminating the need for implicit wrapping.
	 * @template Domain - The abstract domain for individual vector elements
	 * @param factory - The domain factory for creating element domain values
	 * @param length - The possible range of vector lengths
	 * @param values - Known abstract values for positions 0 to known.length-1 (NAAware wrapped)
	 * @param summary - Abstract value summarizing all positions from known.length onwards (NAAware wrapped)
	 * @param attributes - Abstraction of R vector attributes
	 * @returns A new VectorDomain instance
	 * @example
	 * ```typescript
	 * const vector = VectorDomain.create(
	 *   intervalFactory,
	 *   new PosIntervalDomain([0, 10]),
	 *   new KnownInitialPositionsDomain([
	 *     new NAAwareDomain({ inner: new IntervalDomain([1, 1]), hasNA: false }, factory)
	 *   ], factory),
	 *   new NAAwareDomain({ inner: new IntervalDomain([5, 10]), hasNA: false }, factory),
	 *   VectorAttrDomain.top()
	 * );
	 * ```
	 */
	public static create<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>,
		length: PosIntervalDomain,
		known: KnownInitialPositionsDomain<NAAwareDomain<Domain>>,
		summary: NAAwareDomain<Domain>,
		attributes: VectorAttrDomain,
		type: RVectorTypeDomain
	): VectorDomain<Domain> {
		return new VectorDomain({
			length,
			known,
			summary,
			attributes,
			type
		}, factory);
	}

	/**
	 * Alternative create method that accepts raw domain values array.
	 * Wraps them in KnownInitialPositionsDomain internally.
	 * @template Domain - The abstract domain for individual vector elements
	 * @param factory - The domain factory for creating element domain values
	 * @param length - The possible range of vector lengths
	 * @param values - Array of domain values for positions 0 to known.length-1
	 * @param summary - Abstract value summarizing all positions from known.length onwards
	 * @param attributes - Abstraction of R vector attributes
	 * @returns A new VectorDomain instance
	 * @example
	 * ```typescript
	 * const vector = VectorDomain.fromValues(
	 *   intervalFactory,
	 *   new PosIntervalDomain([0, 10]),
	 *   [new IntervalDomain([1, 1]), new IntervalDomain([2, 2])],
	 *   new IntervalDomain([5, 10]),
	 *   VectorAttrDomain.top()
	 * );
	 * ```
	 */
	public static fromValues<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>,
		length: PosIntervalDomain,
		known: readonly NAAwareDomain<Domain>[],
		summary: NAAwareDomain<Domain>,
		attributes: VectorAttrDomain,
		type: RVectorTypeDomain
	): VectorDomain<Domain> {
		const smartFactory = NAAwareDomain.createSmartFactory(factory);
		const knownPositions = new KnownInitialPositionsDomain(
			known,
			smartFactory
		);
		return VectorDomain.create(factory, length, knownPositions, summary, attributes, type);
	}

	/**
	 * Creates the top element of the vector domain.
	 * Represents any possible vector: unknown length, empty content, summary is top, attributes is top.
	 */
	public static top<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>
	): VectorDomain<Domain> {
		const smartFactory = NAAwareDomain.createSmartFactory(factory);
		const summaryTop = NAAwareDomain.top(factory);
		return new VectorDomain({
			length: PosIntervalDomain.top(),
			known:  KnownInitialPositionsDomain.top<NAAwareDomain<Domain>>(
				smartFactory
			),
			summary:    summaryTop,
			attributes: VectorAttrDomain.top(),
			type:       RVectorTypeDomain.top()
		}, factory);
	}

	/**
	 * Creates an empty vector element.
	 * Represents the empty R vector: length [0,0], empty prefix ε, bottom summary, bottom attributes.
	 *
	 * Paper reference (03-abstract.tex:106-111):
	 * genvecalpha(rEmpty) def= ([0,0], ε, genvalbot, attrbot)
	 *
	 * This differs from bottom() which has bottom length (no values possible).
	 */
	public static empty<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>
	): VectorDomain<Domain> {
		const smartFactory = NAAwareDomain.createSmartFactory(factory);
		// ε: empty prefix - no guaranteed positions (represented by top() with empty array)
		const emptyPrefix = KnownInitialPositionsDomain.top<NAAwareDomain<Domain>>(
			smartFactory
		);
		const summaryBottom = NAAwareDomain.bottom(factory);
		return new VectorDomain({
			length:     new PosIntervalDomain([0, 0]),
			known:      emptyPrefix,
			summary:    summaryBottom,
			attributes: VectorAttrDomain.bottom(),
			type:       RVectorTypeDomain.bottom()
		}, factory);
	}

	/**
	 * Creates the bottom element of the vector domain.
	 * Represents no possible vector: bottom length, bottom known positions, bottom summary, bottom attributes.
	 */
	public static bottom<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>
	): VectorDomain<Domain> {
		const smartFactory = NAAwareDomain.createSmartFactory(factory);
		const valuesBottom = KnownInitialPositionsDomain.bottom<NAAwareDomain<Domain>>(
			smartFactory
		);
		const summaryBottom = NAAwareDomain.bottom(factory);
		return new VectorDomain({
			length:     PosIntervalDomain.bottom(),
			known:      valuesBottom,
			summary:    summaryBottom,
			attributes: VectorAttrDomain.bottom(),
			type:       RVectorTypeDomain.bottom()
		}, factory);
	}

	/**
	 * Reduction function maintaining consistency between vector domain components.
	 *
	 * Following the paper's array segmentation analysis, this enforces:
	 *
	 * 1. **Length-Content Consistency**: If length has a finite upper bound,
	 *    the values array cannot exceed that bound. Excess elements are
	 *    joined into the summary.
	 *
	 * 2. **Known-Summary Gap**: If length.lower \> known.length, the positions
	 *    [known.length, length.lower-1] conceptually contain Bottom (no values possible).
	 *
	 * 3. **Size Limit**: The values array is limited to `SafetyMaxKnownLength` elements
	 *    to ensure termination. Excess elements are joined into the summary.
	 *
	 * 4. **Summary Propagation**: When the length upper bound is finite and equals
	 *    the values length, the summary should be Bottom (no elements beyond known positions).
	 * @param value - The product value to reduce
	 * @returns The reduced value with maintained invariants
	 */
	protected reduce(value: VectorProduct<Domain>): VectorProduct<Domain> {
		if(value.length.isBottom() || value.known.isBottom()) {
			return value;
		}

		const { length, attributes, type } = value;
		let { known, summary } = value;
		let modified = false;

		if(length.isValue()) {
			const upperBound = length.value[1];

			if(Number.isFinite(upperBound) && known.isValue()) {
				const valuesArray = known.value as readonly NAAwareDomain<Domain>[];

				if(valuesArray.length > upperBound) {
					for(let i = upperBound; i < valuesArray.length; i++) {
						summary = summary.join(valuesArray[i]);
					}
					known = known.create(valuesArray.slice(0, upperBound));
					modified = true;
				}

				const lowerBound = length.value[0];
				if(lowerBound === upperBound && valuesArray.length === upperBound) {
					summary = summary.bottom();
					modified = true;
				}
			}
		}

		if(known.isValue()) {
			const valuesArray = known.value as readonly NAAwareDomain<Domain>[];

			if(valuesArray.length > SafetyMaxKnownLength) {
				for(let i = SafetyMaxKnownLength; i < valuesArray.length; i++) {
					summary = summary.join(valuesArray[i]);
				}
				known = known.create(valuesArray.slice(0, SafetyMaxKnownLength));
				modified = true;
			}
		}

		return modified ? { length, known, summary, attributes, type } : value;
	}

	/**
	 * Widening operator for VectorDomain.
	 * Unlike the default ProductDomain.widen(), this implementation handles
	 * the known/summary split by collapsing excess positions into the summary
	 * when vector lengths differ, ensuring termination without a hardcoded limit.
	 * @param other - The other vector domain to widen with
	 * @returns The widened vector domain
	 */
	public widen(other: VectorDomain<Domain>): this;
	public widen(other: this): this;
	public widen(other: this | VectorDomain<Domain>): this {
		if(this.isBottom()) {
			return this.create(other.value);
		}
		if(other.isBottom()) {
			return this.create(this.value);
		}

		const newLength = this.length.widen(other.length);
		let newSummary = this.summary.join(other.summary);
		const newAttributes = this.attributes.join(other.attributes);
		const newType = this.type.join(other.type);
		let newValues: KnownInitialPositionsDomain<NAAwareDomain<Domain>>;

		if(this.known.isTop() || other.known.isTop()) {
			const smartFactory = NAAwareDomain.createSmartFactory(this._factory);
			newValues = KnownInitialPositionsDomain.top<NAAwareDomain<Domain>>(
				smartFactory
			);
		} else if(this.known.isBottom()) {
			newValues = other.known;
		} else if(other.known.isBottom()) {
			newValues = this.known;
		} else {
			const thisArr = this.known.value as readonly NAAwareDomain<Domain>[];
			const otherArr = other.known.value as readonly NAAwareDomain<Domain>[];

			const commonLen = Math.min(thisArr.length, otherArr.length);

			const commonKnown: NAAwareDomain<Domain>[] = [];
			for(let i = 0; i < commonLen; i++) {
				commonKnown.push(thisArr[i].widen(otherArr[i]));
			}

			for(let i = commonLen; i < thisArr.length; i++) {
				newSummary = newSummary.join(thisArr[i]);
			}

			for(let i = commonLen; i < otherArr.length; i++) {
				newSummary = newSummary.join(otherArr[i]);
			}

			newValues = this.known.create(commonKnown);
		}

		return this.create({
			length:     newLength,
			known:      newValues,
			summary:    newSummary,
			attributes: newAttributes,
			type:       newType
		});
	}

	/**
	 * Abstract filtering of selector positions into positive and negative groups
	 * per paper Section 4.7.
	 *
	 * Given a sequence of NA-aware interval positions (representing a selector vector),
	 * classifies each position as positive (Z≥0 ∪ {NA}), negative (Z≤0), or ambiguous,
	 * and splits ambiguous positions into their positive and negative components.
	 *
	 * Result: `selectSharp(ν₁, ν₂) = selectSharp_pos(ν₁, ν₂⁺) ⊔ selectSharp_neg(ν₁, ν₂⁻)`
	 * where ν₂⁺ = positions in positive and ν₂⁻ = positions in negative.
	 * @param positions - The selector vector positions to filter
	 * @param factory - Domain factory for creating IntervalDomain values
	 * @returns The filtered positive and negative position arrays, with bottom flags
	 */
	public static abstractFilter(
		positions: readonly NAAwareDomain<IntervalDomain>[],
		factory: DomainFactory<IntervalDomain>
	): AbstractFilterResult {
		const positive: NAAwareDomain<IntervalDomain>[] = [];
		const negative: NAAwareDomain<IntervalDomain>[] = [];
		let positiveHasBottom = false;
		let negativeHasBottom = false;

		for(const pos of positions) {
			const hasNA = pos.containsNA();

			if(!pos.isValue()) {
				negativeHasBottom = positiveHasBottom = true;
				break;
			}

			if(!pos.value.inner.isValue()) {
				const naVal = new NAAwareDomain({
					inner: IntervalDomain.bottom(), hasNA: hasNA
				}, factory);

				negative.push(naVal);
				positive.push(naVal);
				continue;
			}

			const [l, u] = pos.value.inner.value;

			const innerNeg = new IntervalDomain([l, u>0 ? 0 : u]);
			let naNeg: NAAwareDomain<IntervalDomain> = new NAAwareDomain({
				inner: innerNeg, hasNA: hasNA
			}, factory);

			if(l > 0) {
				negativeHasBottom = true;
				naNeg = NAAwareDomain.bottom(factory);
			}

			const innerPos = new IntervalDomain([l<0 ? 0 : l, u]);
			let naPos: NAAwareDomain<IntervalDomain> = new NAAwareDomain({
				inner: innerPos, hasNA: hasNA
			}, factory);

			if(u < 0) {
				positiveHasBottom = true;
				naPos = NAAwareDomain.bottom(factory);
			}

			positive.push(naPos);
			negative.push(naNeg);
		}

		return { positive, negative, positiveHasBottom, negativeHasBottom };
	}
}
