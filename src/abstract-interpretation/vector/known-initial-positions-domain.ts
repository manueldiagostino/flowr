/* eslint-disable @typescript-eslint/unified-signatures */
import type {
	AnyAbstractDomain,
	ConcreteDomain,
} from '../domains/abstract-domain';
import { AbstractDomain } from '../domains/abstract-domain';
import type { NA } from '../domains/lattice';
import { guard } from '../../util/assert';
import { Top, Bottom, BottomSymbol } from '../domains/lattice';

type KnownInitialPositionsValue<Domain extends AnyAbstractDomain> =
	readonly Domain[];
type KnownInitialPositionsTop = readonly [];
type KnownInitialPositionsBottom = typeof Bottom;
type KnownInitialPositionsLift<Domain extends AnyAbstractDomain> =
	| KnownInitialPositionsValue<Domain>
	| KnownInitialPositionsTop
	| KnownInitialPositionsBottom;

/**
 * Factory function to create domain values from a set of concrete values.
 * Supports concrete values, Top (all values), NA (Not Available), or undefined (NA when converter returns undefined).
 */
export type DomainFactory<Domain extends AnyAbstractDomain> = (
	concrete: ReadonlySet<ConcreteDomain<Domain>> | typeof Top | typeof Bottom | typeof NA | undefined,
) => Domain;

export class KnownInitialPositionsDomain<
	Domain extends AnyAbstractDomain,
	Value extends KnownInitialPositionsLift<Domain> =
		KnownInitialPositionsLift<Domain>,
> extends AbstractDomain<
		readonly ConcreteDomain<Domain>[],
		KnownInitialPositionsValue<Domain>,
		KnownInitialPositionsTop,
		KnownInitialPositionsBottom,
		Value
	> {
	private readonly _factory: DomainFactory<Domain>;

	constructor(value: Value, factory: DomainFactory<Domain>) {
		super(value);
		this._factory = factory;
	}

	/**
	 * Gets the domain factory used to create this KnownInitialPositionsDomain.
	 */
	public get factory(): DomainFactory<Domain> {
		return this._factory;
	}

	public create(value: KnownInitialPositionsLift<Domain>): this {
		return new KnownInitialPositionsDomain(value, this._factory) as this;
	}

	public static top<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>,
	): KnownInitialPositionsDomain<Domain, KnownInitialPositionsTop> {
		return new KnownInitialPositionsDomain([], factory);
	}

	public static bottom<Domain extends AnyAbstractDomain>(
		factory: DomainFactory<Domain>,
	): KnownInitialPositionsDomain<Domain, KnownInitialPositionsBottom> {
		return new KnownInitialPositionsDomain(Bottom, factory);
	}

	public top(): this &
		AbstractDomain<
			readonly ConcreteDomain<Domain>[],
			KnownInitialPositionsValue<Domain>,
			KnownInitialPositionsTop,
			KnownInitialPositionsBottom,
			KnownInitialPositionsTop
		> {
		return KnownInitialPositionsDomain.top(this._factory) as this &
			AbstractDomain<
				readonly ConcreteDomain<Domain>[],
				KnownInitialPositionsValue<Domain>,
				KnownInitialPositionsTop,
				KnownInitialPositionsBottom,
				KnownInitialPositionsTop
			>;
	}

	public bottom(): this &
		AbstractDomain<
			readonly ConcreteDomain<Domain>[],
			KnownInitialPositionsValue<Domain>,
			KnownInitialPositionsTop,
			KnownInitialPositionsBottom,
			KnownInitialPositionsBottom
		> {
		return KnownInitialPositionsDomain.bottom(this._factory) as this &
			AbstractDomain<
				readonly ConcreteDomain<Domain>[],
				KnownInitialPositionsValue<Domain>,
				KnownInitialPositionsTop,
				KnownInitialPositionsBottom,
				KnownInitialPositionsBottom
			>;
	}

	public equals(other: KnownInitialPositionsDomain<Domain>): boolean;
	public equals(other: this): boolean;
	public equals(other: this | KnownInitialPositionsDomain<Domain>): boolean {
		if(this.value === other.value) {
			return true;
		}
		if(this.isBottom() || other.isBottom()) {
			return false;
		}
		if(this.isTop() || other.isTop()) {
			return false;
		}
		const thisValue = this.value as KnownInitialPositionsValue<Domain>;
		const otherValue = other.value as KnownInitialPositionsValue<Domain>;
		if(thisValue.length !== otherValue.length) {
			return false;
		}
		return thisValue.every((elem, i) => elem.equals(otherValue[i]));
	}

	public leq(other: KnownInitialPositionsDomain<Domain>): boolean;
	public leq(other: this): boolean;
	public leq(other: this | KnownInitialPositionsDomain<Domain>): boolean {
		if(this.equals(other)) {
			return true;
		}
		if(this.isBottom() || other.isTop()) {
			return true;
		}
		if(other.isBottom() || this.isTop()) {
			return false;
		}
		const thisValue = this.value as KnownInitialPositionsValue<Domain>;
		const otherValue = other.value as KnownInitialPositionsValue<Domain>;
		if(thisValue.length > otherValue.length) {
			return false;
		}
		return thisValue.every((elem, i) => elem.leq(otherValue[i]));
	}

	public join(other: KnownInitialPositionsDomain<Domain>): this;
	public join(other: this): this;
	public join(other: this | KnownInitialPositionsDomain<Domain>): this {
		if(this.isBottom()) {
			return this.create(other.value);
		}
		if(other.isBottom()) {
			return this.create(this.value);
		}
		if(this.isTop()) {
			return this.create(this.value);
		}
		if(other.isTop()) {
			return this.create(other.value);
		}
		const thisValue = this.value as KnownInitialPositionsValue<Domain>;
		const otherValue = other.value as KnownInitialPositionsValue<Domain>;
		const m = Math.min(thisValue.length, otherValue.length);
		const common = [];
		for(let i = 0; i < m; i++) {
			common.push(thisValue[i].join(otherValue[i]));
		}
		if(thisValue.length > otherValue.length) {
			return this.create([...common, ...thisValue.slice(m)]);
		} else if(otherValue.length > thisValue.length) {
			return this.create([...common, ...otherValue.slice(m)]);
		}
		return this.create(common);
	}

	public meet(other: KnownInitialPositionsDomain<Domain>): this;
	public meet(other: this): this;
	public meet(other: this | KnownInitialPositionsDomain<Domain>): this {
		if(this.isBottom() || other.isBottom()) {
			return this.bottom();
		}
		if(this.isTop()) {
			return this.create(other.value);
		}
		if(other.isTop()) {
			return this.create(this.value);
		}
		const thisValue = this.value as KnownInitialPositionsValue<Domain>;
		const otherValue = other.value as KnownInitialPositionsValue<Domain>;
		const m = Math.min(thisValue.length, otherValue.length);
		const result = [];
		for(let i = 0; i < m; i++) {
			result.push(thisValue[i].meet(otherValue[i]));
		}
		return this.create(result);
	}

	public widen(other: KnownInitialPositionsDomain<Domain>): this;
	public widen(other: this): this;
	public widen(other: this | KnownInitialPositionsDomain<Domain>): this {
		if(this.isBottom()) {
			return this.create(other.value);
		}
		if(other.isBottom()) {
			return this.create(this.value);
		}
		if(this.isTop() || other.isTop()) {
			return this.top();
		}
		const thisValue = this.value as KnownInitialPositionsValue<Domain>;
		const otherValue = other.value as KnownInitialPositionsValue<Domain>;
		const m = Math.min(thisValue.length, otherValue.length);
		const result = [];
		for(let i = 0; i < m; i++) {
			result.push(thisValue[i].widen(otherValue[i]));
		}
		return this.create(result);
	}

	public narrow(other: KnownInitialPositionsDomain<Domain>): this;
	public narrow(other: this): this;
	public narrow(other: this | KnownInitialPositionsDomain<Domain>): this {
		return this.meet(other);
	}

	// Not computable
	public concretize(
		_limit: number,
	): ReadonlySet<readonly ConcreteDomain<Domain>[]> | typeof Top {
		if(this.isTop()) {
			return Top;
		}
		if(this.isBottom()) {
			return new Set();
		}
		return Top;
	}

	public abstract(
		concrete: ReadonlySet<readonly ConcreteDomain<Domain>[]> | typeof Top,
	): this {
		if(concrete === Top) {
			return this.top();
		}
		if(concrete.size === 0) {
			return this.bottom();
		}
		const arrays = [...concrete];
		if(arrays.length === 1) {
			// Single array: abstract each element individually
			const result = arrays[0].map((elem) => this._factory(new Set([elem])));
			return this.create(result as KnownInitialPositionsValue<Domain>);
		}

		let maxLen = arrays[0].length;
		for(let i = 1; i < arrays.length; i++) {
			if(arrays[i].length > maxLen) {
				maxLen = arrays[i].length;
			}
		}
		const result = [];
		for(let i = 0; i < maxLen; i++) {
			const valuesAtPos = new Set<ConcreteDomain<Domain>>();
			for(const arr of arrays) {
				if(i < arr.length) {
					valuesAtPos.add(arr[i]);
				}
			}
			// Use the factory to abstract all values at this position
			result.push(this._factory(valuesAtPos));
		}
		return this.create(result as KnownInitialPositionsValue<Domain>);
	}

	public toJson(): unknown {
		if(this.value === Bottom) {
			return this.value.description;
		}
		return this.value.map((entry) => entry.toJson());
	}

	public toString(): string {
		if(this.value === Bottom) {
			return BottomSymbol;
		}
		return '[' + this.value.map((value) => value.toString()).join(', ') + ']';
	}

	public isTop(): this is AbstractDomain<
		readonly ConcreteDomain<Domain>[],
		KnownInitialPositionsValue<Domain>,
		KnownInitialPositionsTop,
		KnownInitialPositionsBottom,
		KnownInitialPositionsTop
	> {
		return this.value !== Bottom && this.value.length === 0;
	}

	public isBottom(): this is AbstractDomain<
		readonly ConcreteDomain<Domain>[],
		KnownInitialPositionsValue<Domain>,
		KnownInitialPositionsTop,
		KnownInitialPositionsBottom,
		KnownInitialPositionsBottom
	> {
		return this.value === Bottom;
	}

	public isValue(): this is AbstractDomain<
		readonly ConcreteDomain<Domain>[],
		KnownInitialPositionsValue<Domain>,
		KnownInitialPositionsTop,
		KnownInitialPositionsBottom,
		KnownInitialPositionsValue<Domain>
	> {
		return this.value !== Bottom;
	}

	public toArray(): Domain[] {
		return this.value as Domain[];
	}

	/**
	 * Gets the number of known initial positions.
	 * Returns undefined for Bottom, 0 for Top (unknown), array length for value.
	 */
	public get length(): number | undefined {
		if(this.isBottom()) {
			return undefined;
		}
		if(this.isTop()) {
			return 0;
		}
		guard(this.isValue(), 'KnownInitialPositionsDomain.length: not a value');
		return this.value.length;
	}
}
