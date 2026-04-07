
import type { AnyAbstractDomain, ConcreteDomain } from '../domains/abstract-domain';
import { PosIntervalDomain } from '../domains/positive-interval-domain';
import { ProductDomain } from '../domains/product-domain';
import { KnownInitialPositionsDomain } from './known-initial-positions-domain';
import type { DomainFactory } from './known-initial-positions-domain';
import { Bottom, Top } from '../domains/lattice';

export type { DomainFactory } from './known-initial-positions-domain';

/**
 * The abstract product representing the abstraction of an R vector.
 * Following the array segmentation analysis from abstract interpretation literature
 * (e.g., Gopan, Reps, Sagiv 2005 - A Framework for Numeric Analysis of Array Operations),
 * a vector is abstracted as:
 * - length: the possible range of vector lengths [min, max]
 * - values: a sequence of abstract values for the known prefix (positions 0 to k-1)
 * - summary: a single abstract value summarizing ALL positions from k onwards (if any)
 *
 * Invariants maintained by reduce():
 * 1. values.length ≤ length.upper (if length.upper is finite)
 * 2. If length.lower \> values.length, positions [values.length, length.lower-1] are Bottom
 * 3. If values array grows beyond a threshold, excess elements are joined into summary
 * @template Domain - The abstract domain for individual vector elements
 */
export type VectorProduct<Domain extends AnyAbstractDomain> = {
	/** The possible range of vector lengths as [min, max] interval */
	length:  PosIntervalDomain;
	/** Known abstract values for positions 0 to values.length-1 (the prefix) */
	values:  KnownInitialPositionsDomain<Domain>;
	/** Abstract value summarizing all positions from values.length onwards */
	summary: Domain;
};

/**
 * Safety limit for the maximum number of elements to track in the known prefix.
 * This is a fallback to prevent extreme memory usage in pathological cases.
 * Under normal operation, widening should control prefix growth.
 */
const SafetyMaxPrefixLength = 1000;

/**
 * The vector abstract domain as a reduced product of length, known prefix values, and summary.
 *
 * This domain abstracts an R vector by:
 * - Tracking the possible length range
 * - Keeping precise abstract values for an initial segment (prefix)
 * - Using a summary value for all remaining positions
 *
 * The lattice structure follows the component-wise ordering with reduction
 * to maintain consistency between components.
 * @template Domain - The abstract domain for individual vector elements
 */
export class VectorDomain<Domain extends AnyAbstractDomain> extends ProductDomain<VectorProduct<Domain>> {
	private readonly factory: DomainFactory<Domain>;

	constructor(value: VectorProduct<Domain>, factory: DomainFactory<Domain>) {
		super(value);
		this.factory = factory;
	}

	public create(value: VectorProduct<Domain>): this;
	public create(value: VectorProduct<Domain>): VectorDomain<Domain> {
		return new VectorDomain(value, this.factory);
	}

	/**
	 * The current abstract value of the length domain.
	 */
	public get length(): VectorProduct<Domain>['length'] {
		return this.value.length;
	}

	/**
	 * The current abstract values for the known prefix.
	 */
	public get values(): VectorProduct<Domain>['values'] {
		return this.value.values;
	}

	/**
	 * The summary abstract value for all positions beyond the known prefix.
	 */
	public get summary(): VectorProduct<Domain>['summary'] {
		return this.value.summary;
	}

	/**
	 * Creates the top element of the vector domain.
	 * Represents any possible vector: unknown length, empty prefix, summary is top.
	 */
	public static top<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>
	): VectorDomain<Domain> {
		const summaryTop = factory(Top as ReadonlySet<ConcreteDomain<Domain>> | typeof Top);
		return new VectorDomain({
			length:  PosIntervalDomain.top(),
			values:  KnownInitialPositionsDomain.top(factory),
			summary: summaryTop
		}, factory);
	}

	/**
	 * Creates the bottom element of the vector domain.
	 * Represents no possible vector: bottom length, bottom prefix, bottom summary.
	 */
	public static bottom<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>
	): VectorDomain<Domain> {
		const bottomDomain = KnownInitialPositionsDomain.bottom<Domain>(factory);
		const summaryBottom = bottomDomain.create(Bottom) as unknown as Domain;
		return new VectorDomain({
			length:  PosIntervalDomain.bottom(),
			values:  bottomDomain,
			summary: summaryBottom
		}, factory);
	}

	/**
	 * Reduction function maintaining consistency between vector domain components.
	 *
	 * Following the paper's array segmentation analysis, this enforces:
	 *
	 * 1. **Length-Prefix Consistency**: If length has a finite upper bound,
	 *    the values array cannot exceed that bound. Excess elements are
	 *    joined into the summary.
	 *
	 * 2. **Prefix-Summary Gap**: If length.lower \> values.length, the positions
	 *    [values.length, length.lower-1] conceptually contain Bottom (no values possible).
	 *
	 * 3. **Size Limit**: The values array is limited to MAX_KNOWN_PREFIX_LENGTH elements
	 *    to ensure termination. Excess elements are joined into the summary.
	 *
	 * 4. **Summary Propagation**: When the length upper bound is finite and equals
	 *    the values length, the summary should be Bottom (no elements beyond prefix).
	 * @param value - The product value to reduce
	 * @returns The reduced value with maintained invariants
	 */
	protected reduce(value: VectorProduct<Domain>): VectorProduct<Domain> {
		if(value.length.isBottom() || value.values.isBottom()) {
			return value;
		}

		const { length } = value;
		let { values, summary } = value;
		let modified = false;

		if(length.isValue()) {
			const upperBound = length.value[1];

			if(Number.isFinite(upperBound) && values.isValue()) {
				const valuesArray = values.value as readonly Domain[];

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
			const valuesArray = values.value as readonly Domain[];

			if(valuesArray.length > SafetyMaxPrefixLength) {
				for(let i = SafetyMaxPrefixLength; i < valuesArray.length; i++) {
					summary = summary.join(valuesArray[i]);
				}
				values = values.create(valuesArray.slice(0, SafetyMaxPrefixLength));
				modified = true;
			}
		}

		return modified ? { length, values, summary } : value;
	}

	/**
	 * Widening operator for VectorDomain following array segmentation analysis.
	 * Unlike the default ProductDomain.widen(), this implementation handles
	 * the prefix/summary split by collapsing excess positions into the summary
	 * when vector lengths differ, ensuring termination without a hardcoded limit.
	 * @param other - The other vector domain to widen with
	 * @returns The widened vector domain
	 */
	public widen(other: this): this {
		if(this.isBottom()) {
			return this.create(other.value);
		}
		if(other.isBottom()) {
			return this.create(this.value);
		}

		const newLength = this.length.widen(other.length);
		let newSummary = this.summary.widen(other.summary);
		let newValues: KnownInitialPositionsDomain<Domain>;

		if(this.values.isTop() || other.values.isTop()) {
			newValues = KnownInitialPositionsDomain.top(this.factory);
		} else if(this.values.isBottom()) {
			newValues = other.values;
		} else if(other.values.isBottom()) {
			newValues = this.values;
		} else {
			const thisArr = this.values.value as readonly Domain[];
			const otherArr = other.values.value as readonly Domain[];

			const commonLen = Math.min(thisArr.length, otherArr.length);

			const commonPrefix: Domain[] = [];
			for(let i = 0; i < commonLen; i++) {
				commonPrefix.push(thisArr[i].widen(otherArr[i]));
			}

			for(let i = commonLen; i < thisArr.length; i++) {
				newSummary = newSummary.join(thisArr[i]);
			}

			for(let i = commonLen; i < otherArr.length; i++) {
				newSummary = newSummary.join(otherArr[i]);
			}

			newValues = this.values.create(commonPrefix);
		}

		return this.create({
			length:  newLength,
			values:  newValues,
			summary: newSummary
		});
	}
}
