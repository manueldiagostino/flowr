import type { AbstractElement, NonRelationalValueAbstractDomain } from '../abstract-domain';
import { EmptySet } from '../../../utils';
import type { SignLatticeElement } from './sign-lattice';
import { SignLattice } from './sign-lattice';


/**
 * The `Sign` class implements the `NonRelationalValueAbstractDomain` interface for the `SignLattice`, 
 * which represents a specific abstract domain for analyzing and manipulating 
 * sign-related information. This domain is used to model the sign of numbers 
 * (positive, negative, zero) and provides operations for abstract interpretation.
 * 
 * It uses the `SignLattice` to manage lattice elements and provides operations
 * such as intersection, union, widening, narrowing, and binary operations
 * (addition, subtraction, multiplication, division).
 */
export class Sign implements NonRelationalValueAbstractDomain<SignLattice> {
	public static instance: Sign;

	private constructor() { }

	static getInstance(): Sign {
		if(!Sign.instance) {
			Sign.instance = new Sign();
		}
		return Sign.instance;
	}

	/**
	 * The name of the abstract domain.
	 * 
	 * @example "Sign"
	 */
	readonly name: string = 'Sign';

	/**
	 * The lattice associated with this abstract domain, which is a `SignLattice` object.
	 */
	readonly lattice: SignLattice = SignLattice.getInstance();

	/**
	 * The top element of the lattice, representing the most general sign information.
	 * In the context of `SignLattice`, this corresponds to the "TOP" element.
	 */
	readonly top: SignLatticeElement = this.lattice.top();

	/**
	 * The bottom element of the lattice, representing the least specific or bottom sign information.
	 * In the context of `SignLattice`, this corresponds to the "BOTTOM" element.
	 */
	readonly bottom: SignLatticeElement = this.lattice.bottom();

	/**
	 * Computes the intersection (greatest lower bound) of two abstract elements.
	 * 
	 * @param lhs - The left-hand side abstract element.
	 * @param rhs - The right-hand side abstract element.
	 * @returns The intersection of `lhs` and `rhs`, which is the greatest lower bound.
	 */
	intersection(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		return this.lattice.glb(lhs, rhs);
	}

	/**
	 * Computes the union (least upper bound) of two abstract elements.
	 * 
	 * @param lhs - The left-hand side abstract element.
	 * @param rhs - The right-hand side abstract element.
	 * @returns The union of `lhs` and `rhs`, which is the least upper bound.
	 */
	union(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		return this.lattice.lub(lhs, rhs);
	}

	/**
	 * Computes the widening of two abstract elements, which is typically used to ensure 
	 * termination in abstract interpretation by generalizing elements.
	 * 
	 * @param lhs - The left-hand side abstract element.
	 * @param rhs - The right-hand side abstract element.
	 * @returns The widening of `lhs` and `rhs`, which is the least upper bound.
	 */
	widening(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		return this.lattice.lub(lhs, rhs);
	}

	/**
	 * Computes the narrowing of two abstract elements, which refines the analysis by
	 * specializing elements, but this operation is not yet implemented in this class.
	 * 
	 * @throws Error if called, as narrowing is not yet implemented for `Sign`.
	 */
	narrowing(_lhs: SignLatticeElement, _rhs: SignLatticeElement): SignLatticeElement {
		throw new Error('Sign::narrowing not yet implemented');
	}

	/**
	 * Converts an abstract element to its corresponding concrete element (a string representation).
	 * 
	 * @param abstractElement - The abstract element to be converted.
	 * @returns The concrete element as a string, representing the sign of the element.
	 */
	getConcrete(abstractElement: SignLatticeElement): string {
		if(abstractElement.isEqual(SignLattice.BOTTOM)) {
			return EmptySet.getInstance().toString();
		}
		return abstractElement.getName();
	}

	/**
	 * Converts a concrete element (a string) to its corresponding abstract element.
	 * 
	 * @param concreteElement - The concrete element to be converted, represented as a string.
	 * @returns The corresponding abstract element from the `SignLattice`.
	 */
	getAbstract(concreteElement: string): SignLatticeElement {
		switch(concreteElement) {
			case EmptySet.toString():
				return SignLattice.BOTTOM;
			case SignLattice.ZERO.toString():
				return SignLattice.ZERO;
			case SignLattice.LEQ0.toString():
				return SignLattice.LEQ0;
			case SignLattice.GEQ0.toString():
				return SignLattice.GEQ0;
			default:
				break;
		}

		const num: number = Number(concreteElement);
		if(num === 0) {
			return SignLattice.ZERO;
		} else if(num >= 0) {
			return SignLattice.GEQ0;
		}

		return SignLattice.TOP;
	}

	/**
	 * Evaluates the addition operation between two abstract elements in the `SignLattice`.
	 * 
	 * @param lhs - The left-hand side element.
	 * @param rhs - The right-hand side element.
	 * @returns The result of the addition operation.
	 * @throws Error if an unhandled case occurs.
	 */
	evalAddOp(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		if(this.lattice.isBottom(lhs) || this.lattice.isBottom(rhs)) {
			return SignLattice.BOTTOM;
		} else if(this.lattice.isTop(lhs) || this.lattice.isTop(rhs)) {
			return SignLattice.TOP;
		} else if(lhs.isEqual(rhs)) {
			return lhs;
		} else if(lhs.isEqual(SignLattice.LEQ0) && rhs.isEqual(SignLattice.GEQ0)) {
			return SignLattice.TOP;
		} else if(lhs.isEqual(SignLattice.GEQ0) && rhs.isEqual(SignLattice.LEQ0)) {
			return SignLattice.TOP;
		} else if(lhs.isEqual(SignLattice.ZERO)) {
			return rhs;
		} else if(rhs.isEqual(SignLattice.ZERO)) {
			return lhs;
		}

		throw new Error(`Sign::evalAddOp unhandled case <${lhs.toString()},${rhs.toString()}>`);
	}

	/**
	 * Evaluates the subtraction operation between two abstract elements in the `SignLattice`.
	 * 
	 * @param lhs - The left-hand side element.
	 * @param rhs - The right-hand side element.
	 * @returns The result of the subtraction operation.
	 * @throws Error if an unhandled case occurs.
	 */
	evalDifOp(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		if(this.lattice.isBottom(lhs) || this.lattice.isBottom(rhs)) {
			return SignLattice.BOTTOM;
		} else if(this.lattice.isTop(lhs) || this.lattice.isTop(rhs)) {
			return SignLattice.TOP;
		} else if(lhs.isEqual(rhs) && !lhs.isEqual(SignLattice.ZERO)) {
			return SignLattice.TOP;
		} else if(lhs.isEqual(SignLattice.LEQ0) && rhs.isEqual(SignLattice.GEQ0)) {
			return SignLattice.LEQ0;
		} else if(lhs.isEqual(SignLattice.GEQ0) && rhs.isEqual(SignLattice.LEQ0)) {
			return SignLattice.GEQ0;
		} else if(lhs.isEqual(SignLattice.ZERO)) {
			return this.evalUnaryOp('-', rhs);
		} else if(rhs.isEqual(SignLattice.ZERO)) {
			return lhs;
		}

		throw new Error(`Sign::evalDifOp unhandled case <${lhs.toString()},${rhs.toString()}>`);
	}

	/**
	 * Evaluates the multiplication operation between two abstract elements in the `SignLattice`.
	 * 
	 * @param lhs - The left-hand side element.
	 * @param rhs - The right-hand side element.
	 * @returns The result of the multiplication operation.
	 * @throws Error if an unhandled case occurs.
	 */
	evalMulOp(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		if(this.lattice.isBottom(lhs) || this.lattice.isBottom(rhs)) {
			return SignLattice.BOTTOM;
		} else if(lhs.isEqual(SignLattice.ZERO) || rhs.isEqual(SignLattice.ZERO)) {
			return SignLattice.ZERO;
		} else if(lhs.isEqual(SignLattice.TOP) || rhs.isEqual(SignLattice.TOP)) {
			return SignLattice.TOP;
		} else if(lhs.isEqual(SignLattice.LEQ0) && rhs.isEqual(SignLattice.GEQ0)) {
			return SignLattice.LEQ0;
		} else if(lhs.isEqual(SignLattice.GEQ0) && rhs.isEqual(SignLattice.LEQ0)) {
			return SignLattice.LEQ0;
		} else if(lhs.isEqual(rhs)) {
			return SignLattice.GEQ0;
		}

		throw new Error(`Sign::evalMulOp unhandled case <${lhs.toString()},${rhs.toString()}>`);
	}

	/**
	 * Evaluates the division operation between two abstract elements in the `SignLattice`.
	 * 
	 * @param lhs - The left-hand side element.
	 * @param rhs - The right-hand side element.
	 * @returns The result of the division operation.
	 * @throws Error if an unhandled case occurs or if division by zero occurs.
	 */
	evalDivOp(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		if(this.lattice.isBottom(lhs) || this.lattice.isBottom(rhs) || rhs.isEqual(SignLattice.ZERO)) {
			return SignLattice.BOTTOM;
		} else if(lhs.isEqual(SignLattice.TOP)) {
			return SignLattice.TOP;
		} else if(lhs.isEqual(SignLattice.ZERO)) {
			return SignLattice.ZERO;
		} else if(rhs.isEqual(SignLattice.TOP)) {
			return SignLattice.TOP;
		} else if(lhs.isEqual(SignLattice.LEQ0) && rhs.isEqual(SignLattice.GEQ0)) {
			return SignLattice.LEQ0;
		} else if(lhs.isEqual(SignLattice.GEQ0) && rhs.isEqual(SignLattice.LEQ0)) {
			return SignLattice.LEQ0;
		} else if(lhs.isEqual(rhs)) {
			return SignLattice.GEQ0;
		}

		throw new Error(`Sign::evalDivOp unhandled case <${lhs.toString()},${rhs.toString()}>`);
	}

	/**
	 * Evaluates a binary operator between two abstract elements.
	 * 
	 * @param operator - The operator to apply ("+", "-", "*", "/").
	 * @param lhs - The left-hand side element.
	 * @param rhs - The right-hand side element.
	 * @returns The result of applying the binary operation.
	 * @throws Error if an unhandled operator is provided.
	 */
	evalBinaryOp(operator: string, lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		// console.debug(`${lhs.getName()} ${operator} ${rhs.getName()}`);

		switch(operator) {
			case '+':
				return this.evalAddOp(lhs, rhs);
			case '-':
				return this.evalDifOp(lhs, rhs);
			case '*':
				return this.evalMulOp(lhs, rhs);
			case '/':
				return this.evalDivOp(lhs, rhs);
			default:
				throw new Error(`Sign::evalBinaryOp unhandled operator <${operator}>`);
		}
	}

	evalUnaryOp(operator: string, operand: AbstractElement): AbstractElement {
		if(operator === '-') {
			if(operand.isEqual(SignLattice.TOP) || operand.isEqual(SignLattice.BOTTOM) || operand.isEqual(SignLattice.ZERO)) {
				return operand;
			} else if(operand.isEqual(SignLattice.LEQ0)) {
				return SignLattice.GEQ0;
			} else {
				return SignLattice.LEQ0;
			}
		}
		return operand;
	}

}
