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

export class SignLattice implements Lattice<SignLatticeElement> {

	public static readonly ZERO:   SignLatticeElement = new SignLatticeElement('(0)');
	public static readonly TOP:    SignLatticeElement = new SignLatticeElement('(TOP)');
	public static readonly BOTTOM: SignLatticeElement = new SignLatticeElement('(BOTTOM)');
	public static readonly LEQ0:   SignLatticeElement = new SignLatticeElement('(<=0)');
	public static readonly GEQ0:   SignLatticeElement = new SignLatticeElement('(>=0)');

	lessOrEqual(_lhs: SignLatticeElement, _rhs: SignLatticeElement): boolean {
		if(_lhs === SignLattice.BOTTOM) {
			return true;
		}
        
		if(_rhs === SignLattice.TOP) {
			return true;
		}
        
		if(_lhs === SignLattice.TOP) {
			return false;
		}
        
		if(_rhs === SignLattice.BOTTOM) {
			return false;
		}
        
		if(_lhs === SignLattice.LEQ0 && _rhs === SignLattice.GEQ0) {
			return false;
		}
		if(_lhs === SignLattice.GEQ0 && _rhs === SignLattice.LEQ0) {
			return false;
		}
        
		if(_lhs === SignLattice.LEQ0 && _rhs === SignLattice.ZERO) {
			return true;
		}
        
		if(_lhs === SignLattice.ZERO && _rhs === SignLattice.LEQ0) {
			return false;
		}
        
		if(_lhs === SignLattice.GEQ0 && _rhs === SignLattice.ZERO) {
			return true;
		}
        
		if(_lhs === SignLattice.ZERO && _rhs === SignLattice.GEQ0) {
			return false;
		}
        
		if(_lhs === SignLattice.ZERO && _rhs === SignLattice.TOP) {
			return true;
		}
        
		return false;
	}
    
	lub(_lhs: SignLatticeElement, _rhs: SignLatticeElement): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	glb(_lhs: SignLatticeElement, _rhs: SignLatticeElement): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	widening(_lhs: SignLatticeElement, _rhs: SignLatticeElement): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	narrowing(_lhs: SignLatticeElement, _rhs: SignLatticeElement): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	bottom(): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	top(): SignLatticeElement {
		throw new Error('Method not implemented.');
	}

	isBottom(_lhs: SignLatticeElement): boolean {
		throw new Error('Method not implemented.');
	}
    
	isTop(_lhs: SignLatticeElement): boolean {
		throw new Error('Method not implemented.');
	}

}
