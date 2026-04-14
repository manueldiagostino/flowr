/* eslint-disable @typescript-eslint/unified-signatures */
import type { AnyAbstractDomain } from '../domains/abstract-domain';
import { PosIntervalDomain } from '../domains/positive-interval-domain';
import { ProductDomain } from '../domains/product-domain';
import { KnownInitialPositionsDomain } from './known-initial-positions-domain';
import type { DomainFactory } from './known-initial-positions-domain';
import { VectorAttrDomain } from '../domains/vector-attr-domain';
import { NAAwareDomain } from './na-aware-domain';

export type { DomainFactory } from './known-initial-positions-domain';

/**
 * The abstract product representing the abstraction of an R vector.
 * - length: the possible range of vector lengths [min, max]
 * - values: a sequence of abstract values for the known positions (positions 0 to k-1)
 * - summary: a single abstract value summarizing ALL positions from k onwards (if any)
 * - attributes: abstraction of the R vector attributes (names, dim, class, other)
 *
 * Invariants maintained by reduce():
 * 1. values.length ≤ length.upper (if length.upper is finite)
 * 2. If length.lower \> values.length, positions [values.length, length.lower-1] are Bottom
 * 3. If values array grows beyond a threshold, excess elements are joined into summary
 * @template Domain - The abstract domain for individual vector elements
 */
export type VectorProduct<Domain extends AnyAbstractDomain> = {
	/** The possible range of vector lengths as [min, max] interval */
	length:     PosIntervalDomain;
	/** Known abstract values for positions 0 to values.length-1 (NAAware wrapped) */
	values:     KnownInitialPositionsDomain<NAAwareDomain<Domain>>;
	/** Abstract value summarizing all positions from values.length onwards */
	summary:    NAAwareDomain<Domain>;
	/** Abstraction of R vector attributes (names, dim, class, other) */
	attributes: VectorAttrDomain;
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
	public get values(): VectorProduct<Domain>['values'] {
		return this.value.values;
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
	 * Factory method to create a VectorDomain with explicit NAAwareDomain wrapping.
	 *
	 * All values and summary must be explicitly wrapped in NAAwareDomain, making NA-awareness
	 * part of the type system and eliminating the need for implicit wrapping.
	 * @template Domain - The abstract domain for individual vector elements
	 * @param factory - The domain factory for creating element domain values
	 * @param length - The possible range of vector lengths
	 * @param values - Known abstract values for positions 0 to values.length-1 (NAAware wrapped)
	 * @param summary - Abstract value summarizing all positions from values.length onwards (NAAware wrapped)
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
		values: KnownInitialPositionsDomain<NAAwareDomain<Domain>>,
		summary: NAAwareDomain<Domain>,
		attributes: VectorAttrDomain
	): VectorDomain<Domain> {
		return new VectorDomain({
			length,
			values,
			summary,
			attributes
		}, factory);
	}

	/**
	 * Alternative create method that accepts raw domain values array.
	 * Wraps them in KnownInitialPositionsDomain internally.
	 * @template Domain - The abstract domain for individual vector elements
	 * @param factory - The domain factory for creating element domain values
	 * @param length - The possible range of vector lengths
	 * @param values - Array of domain values for positions 0 to values.length-1
	 * @param summary - Abstract value summarizing all positions from values.length onwards
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
		values: readonly NAAwareDomain<Domain>[],
		summary: NAAwareDomain<Domain>,
		attributes: VectorAttrDomain
	): VectorDomain<Domain> {
		const smartFactory = NAAwareDomain.createSmartFactory(factory);
		const knownPositions = new KnownInitialPositionsDomain(
			values,
			smartFactory
		);
		return VectorDomain.create(factory, length, knownPositions, summary, attributes);
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
			values: KnownInitialPositionsDomain.top<NAAwareDomain<Domain>>(
				smartFactory
			),
			summary:    summaryTop,
			attributes: VectorAttrDomain.top()
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
			values:     valuesBottom,
			summary:    summaryBottom,
			attributes: VectorAttrDomain.bottom()
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
	 * 2. **Known-Summary Gap**: If length.lower \> values.length, the positions
	 *    [values.length, length.lower-1] conceptually contain Bottom (no values possible).
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
		if(value.length.isBottom() || value.values.isBottom()) {
			return value;
		}

		const { length, attributes } = value;
		let { values, summary } = value;
		let modified = false;

		if(length.isValue()) {
			const upperBound = length.value[1];

			if(Number.isFinite(upperBound) && values.isValue()) {
				const valuesArray = values.value as readonly NAAwareDomain<Domain>[];

				if(valuesArray.length > upperBound) {
					for(let i = upperBound; i < valuesArray.length; i++) {
						summary = summary.join(valuesArray[i]);
					}
					values = values.create(valuesArray.slice(0, upperBound));
					modified = true;
				}

				const lowerBound = length.value[0];
				if(lowerBound === upperBound && valuesArray.length === upperBound) {
					summary = summary.bottom();
					modified = true;
				}
			}
		}

		if(values.isValue()) {
			const valuesArray = values.value as readonly NAAwareDomain<Domain>[];

			if(valuesArray.length > SafetyMaxKnownLength) {
				for(let i = SafetyMaxKnownLength; i < valuesArray.length; i++) {
					summary = summary.join(valuesArray[i]);
				}
				values = values.create(valuesArray.slice(0, SafetyMaxKnownLength));
				modified = true;
			}
		}

		return modified ? { length, values, summary, attributes } : value;
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
		let newValues: KnownInitialPositionsDomain<NAAwareDomain<Domain>>;

		if(this.values.isTop() || other.values.isTop()) {
			const smartFactory = NAAwareDomain.createSmartFactory(this._factory);
			newValues = KnownInitialPositionsDomain.top<NAAwareDomain<Domain>>(
				smartFactory
			);
		} else if(this.values.isBottom()) {
			newValues = other.values;
		} else if(other.values.isBottom()) {
			newValues = this.values;
		} else {
			const thisArr = this.values.value as readonly NAAwareDomain<Domain>[];
			const otherArr = other.values.value as readonly NAAwareDomain<Domain>[];

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

			newValues = this.values.create(commonKnown);
		}

		return this.create({
			length:     newLength,
			values:     newValues,
			summary:    newSummary,
			attributes: newAttributes
		});
	}
}
