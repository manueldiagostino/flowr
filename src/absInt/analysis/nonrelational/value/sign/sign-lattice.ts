import type { Lattice } from '../../../../lattice';
import type { LatticeElement } from '../../../../lattice-element';

/**
 * The `SignLatticeElement` class represents an element of the sign lattice. 
 * It encapsulates a name and provides a method to retrieve this name.
 */
export class SignLatticeElement implements LatticeElement {

	/** The name of the lattice element */
	readonly name: string;

	/**
	 * Constructor to create a new `SignLatticeElement` with a given name.
	 *
	 * @param name - The name of the lattice element
	 */
	constructor(name: string) {
		this.name = name;
	}

	/**
	 * Returns the name of the lattice element.
	 *
	 * @returns The name of the lattice element
	 */
	getName(): string {
		return this.name;
	}
}

/**
 * The `SignLattice` class represents a lattice structure for sign values. 
 * It implements the {@link Lattice} interface, where the elements are instances of {@link SignLatticeElement}.
 * This lattice contains elements for zero, top, bottom, less than or equal to zero, and greater than or equal to zero.
 */
export class SignLattice implements Lattice<SignLatticeElement> {

	/** The element representing zero in the sign lattice */
	public static readonly ZERO: SignLatticeElement = new SignLatticeElement('(0)');

	/** The element representing the top of the lattice */
	public static readonly TOP: SignLatticeElement = new SignLatticeElement('(TOP)');

	/** The element representing the bottom of the lattice */
	public static readonly BOTTOM: SignLatticeElement = new SignLatticeElement('(BOTTOM)');

	/** The element representing values less than or equal to zero */
	public static readonly LEQ0: SignLatticeElement = new SignLatticeElement('(<=0)');

	/** The element representing values greater than or equal to zero */
	public static readonly GEQ0: SignLatticeElement = new SignLatticeElement('(>=0)');

	/**
	 * Checks if the first lattice element is less than or equal to the second one.
	 *
	 * @param lhs - The left-hand side lattice element
	 * @param rhs - The right-hand side lattice element
	 * @returns `true` if `lhs` is less than or equal to `rhs`, `false` otherwise
	 */
	lessOrEqual(lhs: SignLatticeElement, rhs: SignLatticeElement): boolean {
		if(lhs === SignLattice.BOTTOM) {
			return true;
		}

		if(rhs === SignLattice.TOP) {
			return true;
		}

		if(lhs === SignLattice.TOP) {
			return false;
		}

		if(rhs === SignLattice.BOTTOM) {
			return false;
		}

		if(lhs === SignLattice.LEQ0 && rhs === SignLattice.GEQ0) {
			return false;
		}
		if(lhs === SignLattice.GEQ0 && rhs === SignLattice.LEQ0) {
			return false;
		}

		if(lhs === SignLattice.LEQ0 && rhs === SignLattice.ZERO) {
			return true;
		}

		if(lhs === SignLattice.ZERO && rhs === SignLattice.LEQ0) {
			return false;
		}

		if(lhs === SignLattice.GEQ0 && rhs === SignLattice.ZERO) {
			return true;
		}

		if(lhs === SignLattice.ZERO && rhs === SignLattice.GEQ0) {
			return false;
		}

		if(lhs === SignLattice.ZERO && rhs === SignLattice.TOP) {
			return true;
		}

		return false;
	}

	/**
	 * Computes the least upper bound (LUB) of two lattice elements.
	 * The LUB is the smallest element in the lattice that is greater than or equal to both input elements.
	 *
	 * @param lhs - The left-hand side lattice element
	 * @param rhs - The right-hand side lattice element
	 * @returns The least upper bound (LUB) of the two lattice elements
	 * @throws Error if an unhandled case is encountered
	 */
	lub(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		if(lhs === SignLattice.TOP || rhs === SignLattice.TOP) {
			return SignLattice.TOP;
		} else if(lhs === SignLattice.BOTTOM) {
			return rhs;
		} else if(rhs === SignLattice.BOTTOM) {
			return lhs;
		} else if(lhs === SignLattice.LEQ0 && rhs === SignLattice.GEQ0) {
			return SignLattice.TOP;
		} else if(lhs === rhs) {
			return lhs;
		} else {
			throw new Error(`[SignLattice::lub()] unhandled case: lhs=${lhs.name}, rhs=${rhs.name}`);
		}
	}

	/**
	 * Computes the greatest lower bound (GLB) of two lattice elements.
	 * The GLB is the largest element in the lattice that is less than or equal to both input elements.
	 *
	 * @param lhs - The left-hand side lattice element
	 * @param rhs - The right-hand side lattice element
	 * @returns The greatest lower bound (GLB) of the two lattice elements
	 * @throws Error if an unhandled case is encountered
	 */
	glb(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		if(lhs === SignLattice.BOTTOM || rhs === SignLattice.BOTTOM) {
			return SignLattice.BOTTOM;
		} else if(lhs === SignLattice.TOP) {
			return rhs;
		} else if(rhs === SignLattice.TOP) {
			return lhs;
		} else if(lhs === SignLattice.LEQ0 && rhs === SignLattice.GEQ0) {
			return SignLattice.BOTTOM;
		} else if(lhs === rhs) {
			return lhs;
		} else {
			throw new Error(`[SignLattice::lub()] unhandled case: lhs=${lhs.name}, rhs=${rhs.name}`);
		}
	}

	/**
	 * Returns the bottom element of the lattice.
	 *
	 * @returns The bottom element
	 */
	bottom(): SignLatticeElement {
		return SignLattice.BOTTOM;
	}

	/**
	 * Returns the top element of the lattice.
	 *
	 * @returns The top element
	 */
	top(): SignLatticeElement {
		return SignLattice.TOP;
	}

	/**
	 * Checks if the given element is the bottom element of the lattice.
	 *
	 * @param elem - The lattice element to check
	 * @returns `true` if the element is the bottom, `false` otherwise
	 */
	isBottom(elem: SignLatticeElement): boolean {
		return elem === SignLattice.BOTTOM;
	}

	/**
	 * Checks if the given element is the top element of the lattice.
	 *
	 * @param elem - The lattice element to check
	 * @returns `true` if the element is the top, `false` otherwise
	 */
	isTop(elem: SignLatticeElement): boolean {
		return elem === SignLattice.TOP;
	}
}
