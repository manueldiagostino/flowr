import type { AbstractDomain } from '../../../../abstract-domain';
import type { SignLatticeElement } from './sign-lattice';
import { SignLattice } from './sign-lattice';

export class Sign implements AbstractDomain<SignLattice>{
     
	readonly name:    string = 'Sign';
	readonly lattice: SignLattice = new SignLattice();
	readonly top:     SignLatticeElement = this.lattice.top();
	readonly bottom:  SignLatticeElement = this.lattice.bottom();

	widening(lhs: SignLatticeElement, rhs: SignLatticeElement): SignLatticeElement {
		return this.lattice.lub(lhs,rhs);
	}

}
