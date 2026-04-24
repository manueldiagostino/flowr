/* eslint-disable @typescript-eslint/unified-signatures */
import { setEquals } from '../../util/collections/set';
import { AbstractDomain } from './abstract-domain';
import { Bottom, BottomSymbol, Top } from './lattice';

/**
 * The set of possible R vector attributes.
 * Attr = \{names, dim, class, other\}
 */
export const VectorAttrs = ['names', 'dim', 'class', 'other'] as const;

/**
 * The type of a single R vector attribute.
 */
export type VectorAttr = typeof VectorAttrs[number];

/**
 * The type of a set of vector attributes.
 */
export type VectorAttrSet = ReadonlySet<VectorAttr>;

/**
 * The Top element of the vector attribute domain: (∅, Attr)
 * Represents the least precise information where any attribute may be present.
 */
export const VectorAttrTop: VectorAttrValue = { must: new Set<VectorAttr>(), may: new Set<VectorAttr>(VectorAttrs) };

/**
 * The empty attributes element: (∅, ∅)
 * Represents vectors with no attributes.
 */
export const VectorAttrEmpty: VectorAttrValue = { must: new Set<VectorAttr>(), may: new Set<VectorAttr>() };

/**
 * The all attributes element: (Attr, Attr)
 * Represents vectors that definitely have all attributes.
 */
export const VectorAttrAll: VectorAttrValue = { must: new Set<VectorAttr>(VectorAttrs), may: new Set<VectorAttr>(VectorAttrs) };

/**
 * The type of the actual values of the vector attribute domain.
 * A pair (must, may) where must ⊆ may.
 * - must: attributes that are definitely present
 * - may: attributes that may be present
 */
export type VectorAttrValue = { readonly must: VectorAttrSet; readonly may: VectorAttrSet };

/**
 * The type of the Top element of the vector attribute domain.
 */
type VectorAttrTop = typeof VectorAttrTop;

/**
 * The type of the Bottom element of the vector attribute domain.
 */
type VectorAttrBottom = typeof Bottom;

/**
 * The type of the abstract values of the vector attribute domain.
 */
type VectorAttrLift = VectorAttrValue | VectorAttrBottom;

/**
 * Checks if the must/may invariant holds: must ⊆ may.
 */
function isValidAttrValue(value: VectorAttrValue): boolean {
	return value.must.isSubsetOf(value.may);
}

/**
 * The vector attribute abstract domain.
 *
 * This domain tracks which R vector attributes are definitely present (must) versus
 * possibly present (may). The partial order is defined as:
 *   (must₁, may₁) ⊑ (must₂, may₂) ⟺ must₂ ⊆ must₁ ∧ may₁ ⊆ may₂
 *
 * The Bottom element (⊥) represents no possible attribute sets (inconsistent state).
 * The Top element (⊤) is (∅, Attr), representing the least precise information.
 * @template Value - Type of the constraint in the abstract domain (Top, Bottom, or an actual value)
 */
export class VectorAttrDomain<Value extends VectorAttrLift = VectorAttrLift>
	extends AbstractDomain<VectorAttrSet, VectorAttrValue, VectorAttrTop, VectorAttrBottom, Value> {

	constructor(value: Value) {
		if(value !== Bottom && !isValidAttrValue(value)) {
			// Invalid invariant (must ⊈ may) → Bottom
			super(Bottom as Value);
		} else {
			super(value);
		}
	}

	public create(value: VectorAttrLift): this;
	public create(value: VectorAttrLift): VectorAttrDomain {
		return new VectorAttrDomain(value);
	}

	/**
	 * Gets the must set (definitely present attributes).
	 */
	public must(): Value extends VectorAttrValue ? VectorAttrSet : VectorAttrSet | typeof Bottom {
		if(this.value === Bottom) {
			return Bottom as Value extends VectorAttrValue ? VectorAttrSet : VectorAttrSet | typeof Bottom;
		}
		return this.value.must;
	}

	/**
	 * Gets the may set (possibly present attributes).
	 */
	public may(): Value extends VectorAttrValue ? VectorAttrSet : VectorAttrSet | typeof Bottom {
		if(this.value === Bottom) {
			return Bottom as Value extends VectorAttrValue ? VectorAttrSet : VectorAttrSet | typeof Bottom;
		}
		return this.value.may;
	}

	public static top(): VectorAttrDomain<VectorAttrTop> {
		return new VectorAttrDomain(VectorAttrTop);
	}

	public static bottom(): VectorAttrDomain<VectorAttrBottom> {
		return new VectorAttrDomain(Bottom);
	}

	/**
	 * Creates an element representing vectors with no attributes.
	 * attrEmpty = (∅, ∅)
	 */
	public static empty(): VectorAttrDomain {
		return new VectorAttrDomain(VectorAttrEmpty);
	}

	/**
	 * Creates an element representing vectors that definitely have all attributes.
	 * attrAll = (Attr, Attr)
	 */
	public static all(): VectorAttrDomain {
		return new VectorAttrDomain(VectorAttrAll);
	}

	/**
	 * Creates an element with specific must and may sets.
	 * Automatically enforces the must ⊆ may invariant.
	 */
	public static from(must: VectorAttrSet | VectorAttr[], may: VectorAttrSet | VectorAttr[]): VectorAttrDomain {
		const mustSet = Array.isArray(must) ? new Set(must) : must;
		const maySet = Array.isArray(may) ? new Set(may) : may;
		return new VectorAttrDomain({ must: mustSet, may: maySet });
	}

	/**
	 * Maps an attribute name string to the appropriate VectorAttr.
	 * Known attributes ('names', 'dim', 'class') map to themselves.
	 * Unknown attributes map to 'other'.
	 * @param attrName - The attribute name string (e.g., 'names', 'description', 'custom')
	 * @returns The corresponding VectorAttr
	 */
	public static fromAttributeName(attrName: string): VectorAttr {
		if(attrName === 'names' || attrName === 'dim' || attrName === 'class') {
			return attrName;
		}
		return 'other';
	}

	public static abstract(concrete: ReadonlySet<VectorAttrSet> | typeof Top): VectorAttrDomain {
		if(concrete === Top) {
			return VectorAttrDomain.top();
		} else if(concrete.size === 0) {
			return VectorAttrDomain.bottom();
		}
		// Compute intersection of all sets for must
		const must = concrete.values().reduce((result, set) => {
			const newResult = new Set<VectorAttr>();
			for(const attr of result) {
				if(set.has(attr)) {
					newResult.add(attr);
				}
			}
			return newResult;
		}, new Set<VectorAttr>(VectorAttrs));

		// Compute union of all sets for may
		const may = concrete.values().reduce((result, set) => {
			const newResult = new Set(result);
			for(const attr of set) {
				newResult.add(attr);
			}
			return newResult;
		}, new Set<VectorAttr>());

		return new VectorAttrDomain({ must, may });
	}

	public top(): this & VectorAttrDomain<VectorAttrTop>;
	public top(): VectorAttrDomain<VectorAttrTop> {
		return VectorAttrDomain.top();
	}

	public bottom(): this & VectorAttrDomain<VectorAttrBottom>;
	public bottom(): VectorAttrDomain<VectorAttrBottom> {
		return VectorAttrDomain.bottom();
	}

	/**
	 * Checks if the current value represents vectors with no attributes.
	 */
	public isEmpty(): boolean {
		return this.isValue() && this.value.must.size === 0 && this.value.may.size === 0;
	}

	/**
	 * Checks if the current value represents vectors that definitely have all attributes.
	 */
	public isAll(): boolean {
		return this.isValue() && this.value.must.size === VectorAttrs.length;
	}

	public equals(other: VectorAttrDomain): boolean;
	public equals(other: this): boolean;
	public equals(other: this | VectorAttrDomain): boolean {
		if(this.value === other.value) {
			return true;
		}
		if(this.value === Bottom || other.value === Bottom) {
			return false;
		}
		return setEquals(this.value.must, other.value.must) && setEquals(this.value.may, other.value.may);
	}

	/**
	 * Partial order: (must₁, may₁) ⊑ (must₂, may₂) ⟺ must₂ ⊆ must₁ ∧ may₁ ⊆ may₂
	 *
	 * Note the reversed subset direction for must:
	 * - Larger must set = more definite information = lower in lattice
	 * - Larger may set = more possible information = higher in lattice
	 */
	public leq(other: VectorAttrDomain): boolean;
	public leq(other: this): boolean;
	public leq(other: this | VectorAttrDomain): boolean {
		if(this.value === Bottom) {
			return true;
		}
		if(other.value === Bottom) {
			return false;
		}
		// must₂ ⊆ must₁ (other.must ⊆ this.must)
		// may₁ ⊆ may₂ (this.may ⊆ other.may)
		return other.value.must.isSubsetOf(this.value.must) && this.value.may.isSubsetOf(other.value.may);
	}

	/**
	 * Join (LUB): (must₁ ∩ must₂, may₁ ∪ may₂)
	 */
	public join(other: VectorAttrLift): this;
	public join(other: VectorAttrDomain): this;
	public join(other: this): this;
	public join(other: this | VectorAttrLift | VectorAttrDomain): this {
		const otherValue = other instanceof VectorAttrDomain ? other.value : other;

		if(this.value === Bottom) {
			return this.create(otherValue);
		} else if(otherValue === Bottom) {
			return this.create(this.value);
		}
		return this.create({
			must: intersectSets(this.value.must, otherValue.must),
			may:  unionSets(this.value.may, otherValue.may)
		});
	}

	/**
	 * Meet (GLB): (must₁ ∪ must₂, may₁ ∩ may₂)
	 */
	public meet(other: VectorAttrLift): this;
	public meet(other: VectorAttrDomain): this;
	public meet(other: this): this;
	public meet(other: this | VectorAttrLift | VectorAttrDomain): this {
		const otherValue = other instanceof VectorAttrDomain ? other.value : other;

		if(this.value === Bottom || otherValue === Bottom) {
			return this.bottom();
		}
		const must = unionSets(this.value.must, otherValue.must);
		const may = intersectSets(this.value.may, otherValue.may);

		// Check if result is valid (must ⊆ may)
		if(!must.isSubsetOf(may)) {
			return this.bottom();
		}
		return this.create({ must, may });
	}

	/**
	 * Widening is the same as join for this finite lattice.
	 */
	public widen(other: VectorAttrDomain): this;
	public widen(other: this): this;
	public widen(other: this | VectorAttrDomain): this {
		return this.join(other);
	}

	/**
	 * Narrowing is the same as meet for this finite lattice.
	 */
	public narrow(other: VectorAttrDomain): this;
	public narrow(other: this): this;
	public narrow(other: this | VectorAttrDomain): this {
		return this.meet(other);
	}

	public concretize(limit: number): ReadonlySet<VectorAttrSet> | typeof Top {
		if(this.value === Bottom) {
			return new Set();
		}
		const { must, may } = this.value;

		// All subsets of may that include must
		const optionalAttrs = [...may].filter(attr => !must.has(attr));
		const numSubsets = 2 ** optionalAttrs.length;

		if(numSubsets > limit) {
			return Top;
		}

		const result = new Set<VectorAttrSet>();
		for(let i = 0; i < numSubsets; i++) {
			const subset = new Set<VectorAttr>(must);
			for(let j = 0; j < optionalAttrs.length; j++) {
				if(i & (1 << j)) {
					subset.add(optionalAttrs[j]);
				}
			}
			result.add(subset);
		}
		return result;
	}

	public abstract(concrete: ReadonlySet<VectorAttrSet> | typeof Top): this;
	public abstract(concrete: ReadonlySet<VectorAttrSet> | typeof Top): VectorAttrDomain {
		return VectorAttrDomain.abstract(concrete);
	}

	public toJson(): unknown {
		if(this.value === Bottom) {
			return this.value.description;
		}
		return {
			must: [...this.value.must],
			may:  [...this.value.may]
		};
	}

	public toString(): string {
		if(this.value === Bottom) {
			return BottomSymbol;
		}
		const mustStr = this.value.must.size === 0 ? '∅' : `{${[...this.value.must].join(', ')}}`;
		const mayStr = this.value.may.size === VectorAttrs.length ? 'Attr' : `{${[...this.value.may].join(', ')}}`;
		return `(${mustStr}, ${mayStr})`;
	}

	public isTop(): this is VectorAttrDomain<VectorAttrTop> {
		return this.value !== Bottom && this.value.must.size === 0 && this.value.may.size === VectorAttrs.length;
	}

	public isBottom(): this is VectorAttrDomain<VectorAttrBottom> {
		return this.value === Bottom;
	}

	public isValue(): this is VectorAttrDomain<VectorAttrValue> {
		return this.value !== Bottom;
	}
}

/**
 * Helper: Set intersection.
 */
function intersectSets<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
	const result = new Set<T>();
	for(const item of a) {
		if(b.has(item)) {
			result.add(item);
		}
	}
	return result;
}

/**
 * Helper: Set union.
 */
function unionSets<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
	const result = new Set<T>(a);
	for(const item of b) {
		result.add(item);
	}
	return result;
}
