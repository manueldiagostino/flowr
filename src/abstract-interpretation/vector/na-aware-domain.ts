/* eslint-disable tsdoc/syntax */
import type {
	AbstractDomainTop,
	AnyAbstractDomain,
	ConcreteDomain,
} from '../domains/abstract-domain';
import { AbstractDomain } from '../domains/abstract-domain';
import { Top, Bottom, NA, BottomSymbol, NASymbol } from '../domains/lattice';
import type { DomainFactory } from './known-initial-positions-domain';

/**
 * Type for the inner value stored in NAAwareDomain.
 */
export type NAAwareInnerValue<Domain extends AnyAbstractDomain> = {
	/** The wrapped inner domain value */
	readonly inner: Domain;
	/** Whether this abstract value contains NA */
	readonly hasNA: boolean;
};

/**
 * The Top element type for NAAwareDomain.
 */
export type NAAwareTop<Domain extends AnyAbstractDomain> = {
	/** The wrapped inner domain value */
	readonly inner: Domain & AbstractDomainTop<Domain>;
	/** Whether this abstract value contains NA */
	readonly hasNA: true;
};

/**
 * The Bottom element type for NAAwareDomain.
 * Bottom is represented as {inner: Domain.bottom(), hasNA: false}
 */
export type NAAwareBottom<Domain extends AnyAbstractDomain> = {
	readonly inner: Domain;
	readonly hasNA: false;
};

/**
 * The value type for NAAwareDomain - either a concrete inner value, Top, or Bottom.
 */
export type NAAwareValue<Domain extends AnyAbstractDomain> =
  | NAAwareInnerValue<Domain>
  | NAAwareTop<Domain>
  | NAAwareBottom<Domain>;

/**
 * A wrapper domain that tracks NA (Not Available) values separately from concrete values.
 *
 * Design invariants:
 * 1. If inner.isBottom() && hasNA === true → This is PURE NA (isNA() returns true)
 * 2. If inner.isBottom() && hasNA === false → This is lattice Bottom (no values at all)
 * 3. If inner.isValue() || inner.isTop() → This may have concrete values, hasNA indicates NA presence
 * @template Domain - The inner abstract domain being wrapped
 * @template Value  - The type of the abstract value (Top, Bottom, or inner value)
 */
export class NAAwareDomain<
	Domain extends AnyAbstractDomain,
	Value extends NAAwareValue<Domain> = NAAwareValue<Domain>
>
	extends AbstractDomain<
		ConcreteDomain<Domain> | typeof NA,
		NAAwareInnerValue<Domain>,
		NAAwareTop<Domain>,
		NAAwareBottom<Domain>,
		Value
	> {
	private readonly _factory: DomainFactory<Domain>;

	constructor(value: Value, factory: DomainFactory<Domain>) {
		super(value);
		this._factory = factory;
	}

	public create(value: NAAwareValue<Domain>): this;
	public create(value: NAAwareValue<Domain>): NAAwareDomain<Domain> {
		return new NAAwareDomain(value, this._factory);
	}

	/**
	 * Creates the Top element - represents all possible values (including NA potentially).
	 */
	public static top<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>
	): NAAwareDomain<Domain, NAAwareTop<Domain>> {
		return new NAAwareDomain({ inner: factory(Top) as AbstractDomainTop<Domain>, hasNA: true }, factory);
	}

	/**
	 * Gets the domain factory used to create this NAAwareDomain.
	 */
	public get factory(): DomainFactory<Domain> {
		return this._factory;
	}

	/**
	 * Creates the Bottom element - represents no possible values (lattice bottom, not NA).
	 */
	public static bottom<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>
	): NAAwareDomain<Domain, NAAwareBottom<Domain>> {
		const innerBottom = factory(new Set<ConcreteDomain<Domain>>());
		return new NAAwareDomain({ inner: innerBottom, hasNA: false }, factory);
	}

	/**
	 * Creates a pure NA value - represents exactly the NA value.
	 * This is NOT the same as Bottom. NA is a concrete value in R.
	 */
	public static na<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>
	): NAAwareDomain<Domain, NAAwareInnerValue<Domain>> {
		const innerBottom = factory(new Set<ConcreteDomain<Domain>>());
		return new NAAwareDomain({ inner: innerBottom, hasNA: true }, factory);
	}

	/**
	 * Creates a smart factory that properly handles NA values in concrete sets.
	 *
	 * This factory detects when NA is present in the concrete representation and
	 * automatically sets the hasNA flag accordingly. It handles:
	 * - typeof NA (pure NA value)
	 * - undefined (treated as NA)
	 * - Sets containing NA (NA separated from concrete values)
	 * - Sets without NA (hasNA: false)
	 * @param innerFactory - Factory for creating the inner domain values
	 * @returns A factory that creates NAAwareDomain values with proper NA detection
	 * @example
	 * ```typescript
	 * const smartFactory = NAAwareDomain.createSmartFactory(IntervalDomain.abstract);
	 *
	 * // Creates NAAwareDomain with hasNA: false
	 * const noNA = smartFactory(new Set([1, 2, 3]));
	 *
	 * // Creates NAAwareDomain with hasNA: true
	 * const withNA = smartFactory(new Set([1, NA, 3]));
	 *
	 * // Creates pure NA value
	 * const pureNA = smartFactory(NA);
	 * ```
	 */
	public static createSmartFactory<Inner extends AnyAbstractDomain>(
		innerFactory: DomainFactory<Inner>
	): DomainFactory<NAAwareDomain<Inner>> {
		return (
			concrete: ReadonlySet<ConcreteDomain<Inner> | typeof NA> | typeof Top | typeof Bottom | typeof NA | undefined
		): NAAwareDomain<Inner> => {
			// Handle Top
			if(concrete === Top) {
				return NAAwareDomain.top(innerFactory);
			}

			// Handle pure NA or undefined
			if(concrete === NA || concrete === undefined) {
				return NAAwareDomain.na(innerFactory);
			}

			// Handle Bottom (empty set)
			if(concrete === Bottom || (concrete instanceof Set && concrete.size === 0)) {
				return NAAwareDomain.bottom(innerFactory);
			}

			// Handle sets - separate NA from concrete values
			if(concrete instanceof Set) {
				let hasNA = false;
				const concreteValues = new Set<ConcreteDomain<Inner>>();

				for(const value of concrete) {
					if(value === NA) {
						hasNA = true;
					} else {
						// TypeScript doesn't narrow the union type in the else branch,
						// but we know value is ConcreteDomain<Inner> since it's not NA
						concreteValues.add(value as ConcreteDomain<Inner>);
					}
				}

				// Create inner domain from concrete values (or Bottom if only NA)
				const inner = concreteValues.size > 0
					? innerFactory(concreteValues)
					: innerFactory(Bottom);

				return new NAAwareDomain({ inner, hasNA }, innerFactory);
			}

			// Should not reach here with valid inputs
			throw new Error(`Invalid concrete value for NAAwareDomain: ${String(concrete)}`);
		};
	}

	public top(): this & NAAwareDomain<Domain, NAAwareTop<Domain>>;
	public top(): NAAwareDomain<Domain, NAAwareTop<Domain>> {
		return NAAwareDomain.top(this._factory);
	}

	public bottom(): this & NAAwareDomain<Domain, NAAwareBottom<Domain>>;
	public bottom(): NAAwareDomain<Domain, NAAwareBottom<Domain>> {
		return NAAwareDomain.bottom(this._factory);
	}

	/**
	 * Checks if this abstract value IS exactly NA (pure NA, no other values).
	 */
	public isNA(): boolean {
		// Pure NA: inner domain is Bottom (no concrete values) but hasNA is true
		return this.value.inner.isBottom() && this.value.hasNA;
	}

	/**
	 * Checks if this abstract value contains NA (may also contain other values).
	 */
	public containsNA(): boolean {
		return this.value.hasNA;
	}

	/**
	 * Gets the inner domain value (excluding NA tracking).
	 * Always returns a valid Domain value.
	 */
	public get inner(): Domain {
		return this.value.inner;
	}

	public equals(other: this): boolean {
		return this.value.inner.equals(other.value.inner) &&
			this.value.hasNA === other.value.hasNA;
	}

	public leq(other: this): boolean {
		if(this.equals(other)) {
			return true;
		}
		if(this.isBottom()) {
			return true;
		}
		if(other.isTop()) {
			return true;
		}
		if(other.isBottom() || this.isTop()) {
			return false;
		}
		// Component-wise ordering
		return this.value.inner.leq(other.value.inner) &&
			(!this.value.hasNA || other.value.hasNA); // If this has NA, other must have NA
	}

	/**
	 * Join operation: combines two abstract values.
	 * - pureValue.join(pureNA) = value with hasNA=true
	 * - valueWithNA.join(pureNA) = valueWithNA
	 * - pureNA.join(pureNA) = pureNA
	 */
	public join(other: this): this {
		if(this.isBottom()) {
			return this.create(other.value);
		}
		if(other.isBottom()) {
			return this.create(this.value);
		}
		if(this.isTop() || other.isTop()) {
			return this.top();
		}

		const thisValue = this.value as NAAwareInnerValue<Domain>;
		const otherValue = other.value as NAAwareInnerValue<Domain>;

		// Join the inner domains
		const joinedInner = thisValue.inner.join(otherValue.inner);

		// Merge NA flags
		const mergedHasNA = thisValue.hasNA || otherValue.hasNA;

		// Special case: if result is pure NA (inner is Bottom and hasNA is true),
		// check if we should collapse to pure NA
		if(joinedInner.isBottom() && mergedHasNA) {
			// This is pure NA
			return this.create({ inner: joinedInner, hasNA: true });
		}

		return this.create({ inner: joinedInner, hasNA: mergedHasNA });
	}

	public meet(other: this): this {
		if(this.isBottom() || other.isBottom()) {
			return this.bottom();
		}
		if(this.isTop()) {
			return this.create(other.value);
		}
		if(other.isTop()) {
			return this.create(this.value);
		}

		const thisValue = this.value as NAAwareInnerValue<Domain>;
		const otherValue = other.value as NAAwareInnerValue<Domain>;

		// Meet the inner domains
		const metInner = thisValue.inner.meet(otherValue.inner);

		// NA flags: both must have NA for result to have NA
		const metHasNA = thisValue.hasNA && otherValue.hasNA;

		return this.create({ inner: metInner, hasNA: metHasNA });
	}

	public widen(other: this): this {
		if(this.isBottom()) {
			return this.create(other.value);
		}
		if(other.isBottom()) {
			return this.create(this.value);
		}
		if(this.isTop() || other.isTop()) {
			return this.top();
		}

		const thisValue = this.value as NAAwareInnerValue<Domain>;
		const otherValue = other.value as NAAwareInnerValue<Domain>;

		// Widen the inner domains
		const widenedInner = thisValue.inner.widen(otherValue.inner);

		// Merge NA flags (widening is like join for flags)
		const mergedHasNA = thisValue.hasNA || otherValue.hasNA;

		return this.create({ inner: widenedInner, hasNA: mergedHasNA });
	}

	public narrow(other: this): this {
		if(this.isBottom() || other.isBottom()) {
			return this.bottom();
		}
		if(this.isTop()) {
			return this.create(other.value);
		}
		if(other.isTop()) {
			return this.create(this.value);
		}

		const thisValue = this.value as NAAwareInnerValue<Domain>;
		const otherValue = other.value as NAAwareInnerValue<Domain>;

		// Narrow the inner domains
		const narrowedInner = thisValue.inner.narrow(otherValue.inner);

		// NA flags: both must have NA for result to have NA
		const metHasNA = thisValue.hasNA && otherValue.hasNA;

		return this.create({ inner: narrowedInner, hasNA: metHasNA });
	}

	/**
	 * Concretize: returns set of concrete values.
	 * - pure NA → Set([NA])
	 * - value with NA → inner values + NA (if within limit)
	 * - Top → Top
	 * - Bottom → empty set
	 */
	public concretize(limit: number): ReadonlySet<ConcreteDomain<Domain> | typeof NA> | typeof Top {
		const { inner, hasNA } = this.value;
		const innerConcretized = inner.concretize(limit);

		if(innerConcretized === Top) {
			return Top;
		}

		const result = new Set<ConcreteDomain<Domain> | typeof NA>();
		for(const value of innerConcretized as ReadonlySet<ConcreteDomain<Domain>>) {
			result.add(value);
		}

		if(hasNA) {
			if(result.size >= limit) {
				return Top;
			}
			result.add(NA);
		}

		return result;
	}

	/**
	 * Abstract: creates an abstract value from concrete values.
	 * - Set containing NA → value with hasNA=true
	 * - Set without NA → value with hasNA=false
	 * - Top → Top
	 */
	public abstract(
		concrete: ReadonlySet<ConcreteDomain<Domain> | typeof NA> | typeof Top
	): this {
		if(concrete === Top) {
			return this.top();
		}

		// Separate NA from concrete values
		const hasNA = concrete.has(NA as unknown as ConcreteDomain<Domain> | typeof NA);
		const concreteValues = new Set<ConcreteDomain<Domain>>();

		for(const value of concrete) {
			if(value !== NA) {
				concreteValues.add(value);
			}
		}

		// Create inner domain from concrete values (empty set → Bottom)
		const inner = this.factory(concreteValues.size > 0 ? concreteValues : Top);

		return this.create({ inner, hasNA });
	}

	public toJson(): unknown {
		return {
			inner: this.value.inner.toJson(),
			hasNA: this.value.hasNA
		};
	}

	public toString(): string {
		if(this.isNA()) {
			return NASymbol;
		}
		if(this.isBottom()) {
			return BottomSymbol;
		}
		const innerStr = this.value.inner.toString();
		const naMarker = this.value.hasNA ? `+${NASymbol}` : '';
		return `${innerStr}${naMarker}`;
	}

	public isTop(): this is NAAwareDomain<Domain, NAAwareTop<Domain>> {
		return this.value.inner.isTop() && this.value.hasNA;
	}

	public isBottom(): this is NAAwareDomain<Domain, NAAwareBottom<Domain>> {
		return this.value.inner.isBottom() && !this.value.hasNA;
	}

	public isValue(): this is NAAwareDomain<Domain, NAAwareInnerValue<Domain>> {
		return !this.isBottom() && !this.isTop();
	}
}
