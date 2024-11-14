import type { Lattice } from '../../../../lattice';
import type { LatticeElement } from '../../../../lattice-element';

class SignLatticeElement implements LatticeElement {

	readonly name: string;

	constructor(name: string) {
		this.name = name;
	}

	getName() : string {
		return this.name;
	}
}

class SignLattice implements Lattice<SignLatticeElement> {

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
		throw new Error('Method not implemented.');
	}

	glb(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	widening(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	narrowing(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	bottom(): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	top(): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	isBottom(lhs: SignLatticeElement): boolean {
		throw new Error('Method not implemented.');
	}
    
	isTop(lhs: SignLatticeElement): boolean {
		throw new Error('Method not implemented.');
	}

}
