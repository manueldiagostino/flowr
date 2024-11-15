import type { Lattice } from '../../../../lattice';
import type { LatticeElement } from '../../../../lattice-element';

// Private class for this file
class SignLatticeElement implements LatticeElement {

	readonly name: string;

	constructor(name: string) {
		this.name = name;
	}

	getName(): string {
		return this.name;
	}
}

export class SignLattice implements Lattice<SignLatticeElement> {

	public static readonly ZERO:   SignLatticeElement = new SignLatticeElement('(0)');
	public static readonly TOP:    SignLatticeElement = new SignLatticeElement('(TOP)');
	public static readonly BOTTOM: SignLatticeElement = new SignLatticeElement('(BOTTOM)');
	public static readonly LEQ0:   SignLatticeElement = new SignLatticeElement('(<=0)');
	public static readonly GEQ0:   SignLatticeElement = new SignLatticeElement('(>=0)');

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

	lub(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		if(lhs === SignLattice.TOP || rhs === SignLattice.TOP) {
			return SignLattice.TOP;
		} else if(lhs === SignLattice.BOTTOM) {
			return rhs;
		} else if(rhs === SignLattice.BOTTOM) {
			return lhs;
		} else if(lhs === SignLattice.LEQ0 && rhs === SignLattice.GEQ0) {
			return SignLattice.TOP;
		} else {
			throw new Error(`[SignLattice::lub()] unhandled case: lhs=${lhs.name}, rhs=${rhs.name}`);
		}
	}

	glb(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		if(lhs === SignLattice.BOTTOM || rhs === SignLattice.BOTTOM) {
			return SignLattice.BOTTOM;
		} else if(lhs === SignLattice.TOP) {
			return rhs;
		} else if(rhs === SignLattice.TOP) {
			return lhs;
		} else if(lhs === SignLattice.LEQ0 && rhs === SignLattice.GEQ0) {
			return SignLattice.BOTTOM;
		} else {
			throw new Error(`[SignLattice::lub()] unhandled case: lhs=${lhs.name}, rhs=${rhs.name}`);
		}
	}

	widening(_lhs: SignLatticeElement, _rhs: SignLatticeElement): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	narrowing(_lhs: SignLatticeElement, _rhs: SignLatticeElement): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	bottom(): SignLatticeElement {
		return SignLattice.BOTTOM;
	}

	top(): SignLatticeElement {
		return SignLattice.TOP;
	}

	isBottom(elem: SignLatticeElement): boolean {
		return elem === SignLattice.BOTTOM;
	}

	isTop(elem: SignLatticeElement): boolean {
		return elem === SignLattice.TOP;
	}
}
