import type { Lattice } from '../lattice';
import type { LatticeElement } from '../lattice-element';

type AbstractElement = LatticeElement;

/**
 * Represents an abstract domain that provides an abstraction for lattice concepts and algebraic operations on its elements.
 * The interface defines a structure that includes operations for manipulating abstract and concrete elements,
 * as well as algebraic operations for computations on lattice domains.
 *
 * @typeParam T - The type of the lattice associated with the abstract domain, extending the `Lattice<AbstractElement>` type.
 * @typeParam ConcreteElement - The type of the concrete element associated with the abstract domain.
 */
export interface NonRelationalValueAbstractDomain<T extends Lattice<AbstractElement>, ConcreteElement> {

	/**
	 * The name of the abstract domain.
	 */
	name: string;

	/**
	 * The lattice associated with the abstract domain.
	 */
	lattice: T;

	/**
	 * The "top" element (the greatest) of the abstract domain.
	 */
	top: AbstractElement;

	/**
	 * The "bottom" element (the least) of the abstract domain.
	 */
	bottom: AbstractElement;

	/**
	 * Returns the intersection of two abstract elements in the domain.
	 * The intersection is an algebraic operation that returns the most specific common element between the two operands.
	 *
	 * @param lhs - The first abstract element.
	 * @param rhs - The second abstract element.
	 * @returns The intersection of `lhs` and `rhs`.
	 */
	intersection(lhs: AbstractElement, rhs: AbstractElement): AbstractElement;

	/**
	 * Returns the union of two abstract elements in the domain.
	 * The union is an algebraic operation that returns the least specific element that contains both operands.
	 *
	 * @param lhs - The first abstract element.
	 * @param rhs - The second abstract element.
	 * @returns The union of `lhs` and `rhs`.
	 */
	union(lhs: AbstractElement, rhs: AbstractElement): AbstractElement;

	/**
	 * Converts an abstract element to its corresponding concrete element.
	 *
	 * @param abstractElement - The abstract element to be converted.
	 * @returns The corresponding concrete element.
	 */
	getConcrete(abstractElement: AbstractElement): ConcreteElement;

	/**
	 * Converts a concrete element to its corresponding abstract element.
	 *
	 * @param concreteElement - The concrete element to be converted.
	 * @returns The corresponding abstract element.
	 */
	getAbstract(concreteElement: ConcreteElement): AbstractElement;

	/**
	 * Performs a widening operation on two abstract elements.
	 * Widening is an operation that computes a more general element from two less general elements, usually used in abstract interpretation to ensure termination of the analysis.
	 *
	 * @param lhs - The first abstract element.
	 * @param rhs - The second abstract element.
	 * @returns The result of the widening operation.
	 */
	widening(lhs: AbstractElement, rhs: AbstractElement): AbstractElement;

	/**
	 * Performs a narrowing operation on two abstract elements.
	 * Narrowing is an operation that computes a more specific element from two more general elements, typically used to refine the analysis in abstract interpretation.
	 *
	 * @param lhs - The first abstract element.
	 * @param rhs - The second abstract element.
	 * @returns The result of the narrowing operation.
	 */
	narrowing(lhs: AbstractElement, rhs: AbstractElement): AbstractElement;

	/**
	 * Evaluates a binary operator between two abstract elements in the domain.
	 * This method is designed for operations based on an Abstract Syntax Tree (AST).
	 *
	 * @param operator - The binary operator to be applied.
	 * @param lhs - The left-hand side abstract element.
	 * @param rhs - The right-hand side abstract element.
	 * @returns The result of applying the operator to `lhs` and `rhs`.
	 */
	evalBinaryOp(operator: string, lhs: AbstractElement, rhs: AbstractElement): AbstractElement;
}
