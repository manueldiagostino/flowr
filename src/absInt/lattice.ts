export interface Lattice<T> {
	/**
	 * Checks if `lhs` is less than or equal to `rhs` according to the partial order relation.
	 * @param lhs - The left-hand side element.
	 * @param rhs - The right-hand side element.
	 * @returns `true` if `lhs` is less than or equal to `rhs`, `false` otherwise.
	 */
	lessOrEqual(lhs: T, rhs: T): boolean;

	/**
	 * Computes the least upper bound (lub) of `lhs` and `rhs`.
	 * @param lhs - The left-hand side element.
	 * @param rhs - The right-hand side element.
	 * @returns The least upper bound of `lhs` and `rhs`.
	 */
	lub(lhs: T, rhs: T): T;

	/**
	 * Computes the greatest lower bound (glb) of `lhs` and `rhs`.
	 * @param lhs - The left-hand side element.
	 * @param rhs - The right-hand side element.
	 * @returns The greatest lower bound of `lhs` and `rhs`.
	 */
	glb(lhs: T, rhs: T): T;

	/**
	 * Returns the bottom element of the lattice, representing the least defined or minimum value.
	 * @returns The bottom element of the lattice.
	 */
	bottom(): T;

	/**
	 * Returns the top element of the lattice, representing the most defined or maximum value.
	 * @returns The top element of the lattice.
	 */
	top(): T;

	/**
	 * Checks if `lhs` is the bottom element.
	 * @param lhs - The element to check.
	 * @returns `true` if `lhs` is the bottom element, `false` otherwise.
	 */
	isBottom(lhs: T): boolean;

	/**
	 * Checks if `lhs` is the top element.
	 * @param lhs - The element to check.
	 * @returns `true` if `lhs` is the top element, `false` otherwise.
	 */
	isTop(lhs: T): boolean;
}
