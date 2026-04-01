import { IntervalDomain, type IntervalValue } from './interval-domain';
import { Bottom, Top } from './lattice';

/** The Top element of the strictly positive interval domain as interval [1, +∞] */
export const StrictlyPosIntervalTop: IntervalValue = [1, +Infinity];

/** The type of the Top element of the strictly positive interval domain as interval [1, +∞] */
type StrictlyPosIntervalTop = typeof StrictlyPosIntervalTop;
/** The type of the Bottom element of the strictly positive interval domain as {@link Bottom} symbol */
type StrictlyPosIntervalBottom = typeof Bottom;
/** The type of the abstract values of the strictly positive interval domain that are Top, Bottom, or actual values */
type StrictlyPosIntervalLift = IntervalValue | StrictlyPosIntervalBottom;

/**
 * The strictly positive interval abstract domain for intervals [l, u] where l \> 0.
 *
 * This domain is used for vector lengths where the lower bound must be at least 1
 * (vectors cannot have length 0 in this domain).
 *
 * The Bottom element is defined as {@link Bottom} symbol and the Top element is defined as the interval [1, +∞].
 * @template Value - Type of the constraint in the abstract domain (Top, Bottom, or an actual value)
 */
export class StrictlyPosIntervalDomain<Value extends StrictlyPosIntervalLift = StrictlyPosIntervalLift>
	extends IntervalDomain<Value> {

	constructor(value: Value) {
		if(Array.isArray(value) && value[0] <= 0) {
			super(Bottom as Value);
		} else {
			super(value);
		}
	}

	public create(value: StrictlyPosIntervalLift): this;
	public create(value: StrictlyPosIntervalLift): StrictlyPosIntervalDomain {
		return new StrictlyPosIntervalDomain(value);
	}

	public static top(): StrictlyPosIntervalDomain<StrictlyPosIntervalTop> {
		return new StrictlyPosIntervalDomain(StrictlyPosIntervalTop);
	}

	public static bottom(): StrictlyPosIntervalDomain<StrictlyPosIntervalBottom> {
		return new StrictlyPosIntervalDomain(Bottom);
	}

	public static abstract(concrete: ReadonlySet<number> | typeof Top): StrictlyPosIntervalDomain {
		if(concrete === Top) {
			return StrictlyPosIntervalDomain.top();
		} else if(concrete.size === 0 || concrete.values().some(value => isNaN(value) || value <= 0)) {
			return StrictlyPosIntervalDomain.bottom();
		}
		return new StrictlyPosIntervalDomain([Math.min(...concrete), Math.max(...concrete)]);
	}

	public top(): this & StrictlyPosIntervalDomain<StrictlyPosIntervalTop>;
	public top(): StrictlyPosIntervalDomain<StrictlyPosIntervalTop> {
		return StrictlyPosIntervalDomain.top();
	}

	public bottom(): this & StrictlyPosIntervalDomain<StrictlyPosIntervalBottom>;
	public bottom(): StrictlyPosIntervalDomain<StrictlyPosIntervalBottom> {
		return StrictlyPosIntervalDomain.bottom();
	}

	public widen(other: this): this {
		if(this.value === Bottom) {
			return this.create(other.value);
		} else if(other.value === Bottom) {
			return this.create(this.value);
		} else {
			return this.create([
				this.value[0] <= other.value[0] ? this.value[0] : 1,
				this.value[1] >= other.value[1] ? this.value[1] : +Infinity
			]);
		}
	}

	public narrow(other: this): this {
		if(this.value === Bottom || other.value === Bottom) {
			return this.bottom();
		} else if(Math.max(this.value[0], other.value[0]) > Math.min(this.value[1], other.value[1])) {
			return this.bottom();
		}
		return this.create([
			this.value[0] === 1 ? other.value[0] : this.value[0],
			this.value[1] === +Infinity ? other.value[1] : this.value[1]
		]);
	}

	public abstract(concrete: ReadonlySet<number> | typeof Top): this;
	public abstract(concrete: ReadonlySet<number> | typeof Top): StrictlyPosIntervalDomain {
		return StrictlyPosIntervalDomain.abstract(concrete);
	}

	public subtract(other: this | StrictlyPosIntervalLift): this {
		const otherValue = other instanceof StrictlyPosIntervalDomain ? other.value : other;

		if(this.value === Bottom || otherValue === Bottom) {
			return this.bottom();
		} else {
			return this.create([Math.max(this.value[0] - otherValue[0], 1), Math.max(this.value[1] - otherValue[1], 1)]);
		}
	}

	/**
	 * Computes the cardinality (number of integers) in this interval.
	 * Returns +Infinity if the upper bound is +Infinity.
	 */
	public card(): number {
		if(this.value === Bottom) {
			return 0;
		}
		const [l, u] = this.value;
		if(u === +Infinity) {
			return +Infinity;
		}
		return u - l + 1;
	}

	/**
	 * Checks if this interval is enumerable (cardinality is finite and ≤ threshold).
	 * @param threshold - The maximum cardinality to consider enumerable (default: 50)
	 */
	public isEnumerable(threshold = 50): boolean {
		const c = this.card();
		return c !== +Infinity && c <= threshold;
	}

	public isTop(): this is StrictlyPosIntervalDomain<StrictlyPosIntervalTop> {
		return this.value !== Bottom && this.value[0] === 1 && this.value[1] === +Infinity;
	}

	/**
	 * Gets the lower bound of the interval.
	 * Returns Bottom if this is Bottom.
	 */
	public lower(): number | typeof Bottom {
		if(this.value === Bottom) {
			return Bottom;
		}
		return this.value[0];
	}

	/**
	 * Gets the upper bound of the interval.
	 * Returns Bottom if this is Bottom.
	 */
	public upper(): number | typeof Bottom {
		if(this.value === Bottom) {
			return Bottom;
		}
		return this.value[1];
	}
}
