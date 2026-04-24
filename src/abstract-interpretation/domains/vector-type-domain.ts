/* eslint-disable tsdoc/syntax */
/* eslint-disable @typescript-eslint/unified-signatures */
import { AbstractDomain } from './abstract-domain';
import { Bottom, BottomSymbol, Top, TopSymbol } from './lattice';

/**
 * The set of possible R vector types in coercion order (chain lattice).
 * Order: logical < integer < double < complex < character
 * This represents R's type coercion hierarchy where types can be implicitly
 * converted to "wider" types (e.g., logical → integer → double → character).
 */
export const RVectorTypes = ['logical', 'integer', 'double', 'complex', 'character'] as const;

/**
 * The type of a single R vector type.
 */
export type RVectorType = typeof RVectorTypes[number];

/**
 * Gets the index of a type in the coercion chain (for lattice operations).
 * logical=0, integer=1, double=2, complex=3, character=4
 */
function typeIndex(type: RVectorType): number {
	return RVectorTypes.indexOf(type);
}

/**
 * The Top element for R vector types: represents unknown/any type.
 */
export const RVectorTypeTop: unique symbol = Symbol('RVectorTypeTop');

/**
 * The type of the Top element.
 */
export type RVectorTypeTop = typeof RVectorTypeTop;

/**
 * The type of the Bottom element.
 */
export type RVectorTypeBottom = typeof Bottom;

/**
 * The lift type for R vector types: a concrete type, Top, or Bottom.
 */
type RVectorTypeLift = RVectorType | RVectorTypeTop | RVectorTypeBottom;

/**
 * The R vector type abstract domain.
 *
 * This domain tracks the type of R vectors using a chain lattice where:
 * - logical ⊑ integer ⊑ double ⊑ complex ⊑ character
 * - join(a, b) = max(a, b) in the chain (wider type wins)
 * - meet(a, b) = min(a, b) in the chain (narrower type wins)
 *
 * This models R's type coercion behavior: c(TRUE, 1) produces double,
 * c(1L, 1.5) produces double, c(1, "a") produces character.
 *
 * The Top element (⊤) represents an unknown type (could be any).
 * The Bottom element (⊥) represents an inconsistent/no type state.
 * @template Value - Type of the value held (Top, Bottom, or an actual type)
 */
export class RVectorTypeDomain<Value extends RVectorTypeLift = RVectorTypeLift>
	extends AbstractDomain<RVectorType, RVectorType, RVectorTypeTop, typeof Bottom, Value> {

	public create(value: RVectorTypeLift): this;
	public create(value: RVectorTypeLift): RVectorTypeDomain {
		return new RVectorTypeDomain(value);
	}

	public static top(): RVectorTypeDomain<RVectorTypeTop> {
		return new RVectorTypeDomain(RVectorTypeTop);
	}

	public static bottom(): RVectorTypeDomain<RVectorTypeBottom> {
		return new RVectorTypeDomain(Bottom);
	}

	/**
	 * Creates an element representing a specific R vector type.
	 */
	public static of(type: RVectorType): RVectorTypeDomain<RVectorType> {
		return new RVectorTypeDomain(type);
	}

	public top(): this & RVectorTypeDomain<RVectorTypeTop>;
	public top(): RVectorTypeDomain<RVectorTypeTop> {
		return RVectorTypeDomain.top();
	}

	public bottom(): this & RVectorTypeDomain<RVectorTypeBottom>;
	public bottom(): RVectorTypeDomain<RVectorTypeBottom> {
		return RVectorTypeDomain.bottom();
	}

	/**
	 * Gets the concrete type value if this is a concrete type (not Top or Bottom).
	 * Returns undefined if Top or Bottom.
	 */
	public getType(): RVectorType | undefined {
		if(this.isTop() || this.isBottom()) {
			return undefined;
		}
		return this.value as RVectorType;
	}

	public equals(other: RVectorTypeDomain): boolean;
	public equals(other: this): boolean;
	public equals(other: this | RVectorTypeDomain): boolean {
		return this.value === other.value;
	}

	/**
	 * Partial order: a ⊑ b iff a can be coerced to b (a ≤ b in chain).
	 * logical ⊑ integer, integer ⊑ double, etc.
	 */
	public leq(other: RVectorTypeDomain): boolean;
	public leq(other: this): boolean;
	public leq(other: this | RVectorTypeDomain): boolean {
		if(this.isBottom()) {
			return true;
		}
		if(other.isBottom()) {
			return false;
		}
		if(other.isTop()) {
			return true;
		}
		if(this.isTop()) {
			return false;
		}
		const thisType = this.value as RVectorType;
		const otherType = (other as RVectorTypeDomain).value as RVectorType;
		return typeIndex(thisType) <= typeIndex(otherType);
	}

	/**
	 * Join (LUB): the wider type that can hold both.
	 * join(logical, double) = double, join(integer, character) = character
	 */
	public join(other: RVectorTypeLift): this;
	public join(other: RVectorTypeDomain): this;
	public join(other: this): this;
	public join(other: this | RVectorTypeLift | RVectorTypeDomain): this {
		const otherValue = other instanceof RVectorTypeDomain ? other.value : other;

		if(this.isBottom()) {
			return this.create(otherValue);
		}
		if(otherValue === Bottom) {
			return this.create(this.value);
		}
		const otherDomain = other instanceof RVectorTypeDomain ? other : null;
		if(this.isTop() || otherValue === RVectorTypeTop || (otherDomain?.isTop())) {
			return this.create(RVectorTypeTop as RVectorTypeLift);
		}
		const thisType = this.value as RVectorType;
		const otherType = otherValue;
		const thisIdx = typeIndex(thisType);
		const otherIdx = typeIndex(otherType);
		const result = thisIdx >= otherIdx ? this.value : otherValue;
		return this.create(result);
	}

	/**
	 * Meet (GLB): the narrower type that both can be coerced to.
	 * meet(logical, double) = logical, meet(integer, character) = integer
	 */
	public meet(other: RVectorTypeLift): this;
	public meet(other: RVectorTypeDomain): this;
	public meet(other: this): this;
	public meet(other: this | RVectorTypeLift | RVectorTypeDomain): this {
		const otherValue = other instanceof RVectorTypeDomain ? other.value : other;
		const otherDomain = other instanceof RVectorTypeDomain ? other : null;

		if(this.isBottom() || otherValue === Bottom) {
			return this.create(Bottom);
		}
		if(this.isTop()) {
			return this.create(otherValue as RVectorTypeLift);
		}
		if(otherValue === RVectorTypeTop || (otherDomain?.isTop())) {
			return this.create(this.value);
		}
		const thisType = this.value as RVectorType;
		const otherType = otherValue;
		const thisIdx = typeIndex(thisType);
		const otherIdx = typeIndex(otherType);
		const result = thisIdx <= otherIdx ? this.value : otherValue;
		return this.create(result);
	}

	/**
	 * Widening: for chain lattice, join is sufficient (finite height).
	 */
	public widen(other: this): this {
		return this.join(other);
	}

	/**
	 * Narrowing: for chain lattice, meet is sufficient.
	 */
	public narrow(other: this): this {
		return this.meet(other);
	}

	/**
	 * Concretization: returns singleton set for concrete types.
	 */
	public concretize(): ReadonlySet<RVectorType> | typeof Top {
		if(this.isTop()) {
			return Top;
		}
		if(this.isBottom()) {
			return new Set<RVectorType>();
		}
		return new Set<RVectorType>([this.value as RVectorType]);
	}

	/**
	 * Abstraction: singleton set becomes that type, multi-type set joins them.
	 */
	public abstract(concrete: ReadonlySet<RVectorType> | typeof Top): this;
	public abstract(concrete: ReadonlySet<RVectorType> | typeof Top): RVectorTypeDomain {
		if(concrete === Top) {
			return RVectorTypeDomain.top();
		}
		if(concrete.size === 0) {
			return RVectorTypeDomain.bottom();
		}
		let result: RVectorType | RVectorTypeTop = RVectorTypeTop;
		for(const type of concrete) {
			if(result === RVectorTypeTop) {
				result = type;
			} else if(typeIndex(type) > typeIndex(result)) {
				result = type;
			}
		}
		return new RVectorTypeDomain((result === RVectorTypeTop ? Bottom : result) as RVectorTypeLift);
	}

	public toJson(): unknown {
		if(this.isTop()) {
			return TopSymbol;
		}
		if(this.isBottom()) {
			return BottomSymbol;
		}
		return this.value;
	}

	public toString(): string {
		if(this.isTop()) {
			return TopSymbol;
		}
		if(this.isBottom()) {
			return BottomSymbol;
		}
		return this.value as string;
	}

	public isTop(): this is RVectorTypeDomain<RVectorTypeTop> {
		return (this.value as unknown) === RVectorTypeTop;
	}

	public isBottom(): this is RVectorTypeDomain<RVectorTypeBottom> {
		return this.value === Bottom;
	}

	public isValue(): this is RVectorTypeDomain<RVectorType> {
		return !this.isTop() && !this.isBottom();
	}
}
