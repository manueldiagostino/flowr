import type { Lattice } from './lattice';
import type { LatticeElement } from './lattice-element';
import { Func, ConstantFunc } from './function';
import type { Identifier } from './identifier';

/**
 * The PointWiseLifting class provides a pointwise lifting abstraction for lattice operations over functions.
 * It defines a framework for creating and manipulating lattice-based functions where the domain is a set of identifiers,
 * and the values of the lattice are applied to these identifiers.
 * 
 * This class implements lattice operations for `Func<A, LatticeElement>`, including:
 * - Less-than-or-equal comparison (`lessOrEqual`)
 * - Least upper bound (join) (`lub`)
 * - Greatest lower bound (meet) (`glb`)
 * - Bottom and top functions (`bottom`, `top`)
 * 
 * The lattice operations are performed pointwise over the set of identifiers, meaning that each identifier
 * has an associated lattice element that is operated on individually.
 *
 * @typeParam A - The type of the set of identifiers over which the lattice operations are defined.
 * @typeParam B - The type of the lattice used in the operations.
 */


export abstract class PointWiseLifting<A extends Identifier, B extends Lattice<LatticeElement>> implements Lattice<Func<A, LatticeElement>> {

	/**
	 * The lattice structure that provides the algebraic operations for the lattice elements
	 */
	private readonly lattice: B;

	/**
	 * The constant top function, representing the greatest element in the lattice for all identifiers
	 */
	public readonly topFunc: ConstantFunc<A, LatticeElement>;

	/**
	 * The constant bottom function, representing the least element in the lattice for all identifiers
	 */ 
	private readonly bottomFunc: ConstantFunc<A, LatticeElement>;

	/**
   * Constructor for creating a PointWiseLifting instance.
   * Initializes the set of identifiers, lattice, and constant top and bottom functions.
   * 
   * @param setId - The set of identifiers to operate on.
   * @param lattice - The lattice structure used for the lattice operations.
   */
	constructor(lattice: B) {
		this.lattice = lattice;
		// Initialize the constant top and bottom functions for the lattice
		this.topFunc = new ConstantFunc<A, LatticeElement>('PWTop', lattice.top());
		this.bottomFunc = new ConstantFunc<A, LatticeElement>('PWBottom', lattice.bottom());
	}

	/**
   * Performs a less-than-or-equal comparison between two lattice functions.
   * Compares the lattice values pointwise for each identifier in the set.
   * 
   * @param lhs - The left-hand side function to compare.
   * @param rhs - The right-hand side function to compare.
   * @returns `true` if `lhs` is less than or equal to `rhs` pointwise, `false` otherwise.
   */
	lessOrEqual(lhs: Func<A, LatticeElement>, rhs: Func<A, LatticeElement>): boolean {

		const keys : A[] = lhs.getElements(); 

		for(const value of keys) {
			const lhsHasKey = lhs.hasKey(value);
			const rhsHasKey = rhs.hasKey(value);

			if(lhsHasKey && rhsHasKey) {
				// Compare the lattice values of the same identifier
				if(!this.lattice.lessOrEqual(lhs.apply(value), rhs.apply(value))) {
					return false; // Return false if any value is not less or equal
				}
			} else if(lhsHasKey) {
				// If lhs has the identifier but rhs doesn't, return false
				return false;
			}
		}
		return true;
	}

	/**
   * Computes the least upper bound (join) of two lattice functions pointwise.
   * For each identifier, the least upper bound of the lattice values is computed.
   * 
   * @param lhs - The first lattice function.
   * @param rhs - The second lattice function.
   * @returns A new function representing the least upper bound of `lhs` and `rhs`.
   */
	lub(lhs: Func<A, LatticeElement>, rhs: Func<A, LatticeElement>): Func<A, LatticeElement> {
		
		const newFunc = new Func<A, LatticeElement>('func');
		const keys : A[] = Array.from(new Set([...lhs.getElements() , ...rhs.getElements()])); 

		for(const value of keys) {
			const lhsHasKey = lhs.hasKey(value);
			const rhsHasKey = rhs.hasKey(value);

			if(lhsHasKey && rhsHasKey) {
				// Compute the least upper bound for the value of the current identifier
				newFunc.updateElement(value, this.lattice.lub(lhs.apply(value), rhs.apply(value)));
			} else if(lhsHasKey) {
				newFunc.updateElement(value, lhs.apply(value));
			} else if(rhsHasKey) {
				newFunc.updateElement(value, rhs.apply(value));
			}
		}

		return newFunc;
	}

	/**
   * Computes the greatest lower bound (meet) of two lattice functions pointwise.
   * For each identifier, the greatest lower bound of the lattice values is computed.
   * 
   * @param lhs - The first lattice function.
   * @param rhs - The second lattice function.
   * @returns A new function representing the greatest lower bound of `lhs` and `rhs`.
   */
	glb(lhs: Func<A, LatticeElement>, rhs: Func<A, LatticeElement>): Func<A, LatticeElement> {
		const newFunc = new Func<A, LatticeElement>('func');
		const keys : A[] = Array.from(new Set([...lhs.getElements() , ...rhs.getElements()])); 

		for(const value of keys) {
			const lhsHasKey = lhs.hasKey(value);
			const rhsHasKey = rhs.hasKey(value);

			if(lhsHasKey && rhsHasKey) {
				// Compute the greatest lower bound for the value of the current identifier
				newFunc.updateElement(value, this.lattice.glb(lhs.apply(value), rhs.apply(value)));
			} else if(lhsHasKey) {
				newFunc.updateElement(value, lhs.apply(value));
			} else if(rhsHasKey) {
				newFunc.updateElement(value, rhs.apply(value));
			}
		}

		return newFunc;
	}

	/**
   * Returns the bottom function (the least element) for the lattice.
   * 
   * @returns The bottom function.
   */
	bottom(): ConstantFunc<A, LatticeElement> {
		return this.bottomFunc;
	}

	/**
   * Returns the top function (the greatest element) for the lattice.
   * 
   * @returns The top function.
   */
	top(): ConstantFunc<A, LatticeElement> {
		return this.topFunc;
	}

	/**
   * Checks if a given function is the bottom function.
   * 
   * @param lhs - The function to check.
   * @returns `true` if the function is the bottom function, `false` otherwise.
   */
	isBottom(lhs: Func<A, LatticeElement>): boolean {
		return lhs.name === this.bottomFunc.name;
	}

	/**
   * Checks if a given function is the top function.
   * 
   * @param lhs - The function to check.
   * @returns `true` if the function is the top function, `false` otherwise.
   */
	isTop(lhs: Func<A, LatticeElement>): boolean {
		return lhs.name === this.topFunc.name;
	}
}
