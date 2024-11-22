import type { Lattice } from './lattice';
import type { LatticeElement } from './lattice-element';
import { type Func, ConstantFunc } from './function';
import type { Identifier } from './identifier';

export abstract class PointWiseLifting<A extends Set<Identifier>, B extends Lattice<LatticeElement>> implements Lattice<Func<Identifier, LatticeElement>> {

	private setId:            A;
	private readonly lattice: B;
	private readonly topFunc: ConstantFunc<Identifier, LatticeElement>;

	constructor(setId: A, lattice: B) {
		this.setId = setId;
		this.lattice = lattice;
		this.topFunc = new ConstantFunc<Identifier, LatticeElement>('PWTop', lattice.top());
	}
	lessOrEqual(_lhs: Func<Identifier, LatticeElement>, _rhs: Func<Identifier, LatticeElement>): boolean {
		throw new Error('Method not implemented.');
	}
	lub(_lhs: Func<Identifier, LatticeElement>, _rhs: Func<Identifier, LatticeElement>): Func<Identifier, LatticeElement> {
		throw new Error('Method not implemented.');
	}
	glb(_lhs: Func<Identifier, LatticeElement>, _rhs: Func<Identifier, LatticeElement>): Func<Identifier, LatticeElement> {
		throw new Error('Method not implemented.');
	}
	bottom(): Func<Identifier, LatticeElement> {
		throw new Error('Method not implemented.');
	}
	top(): Func<Identifier, LatticeElement> {
		return this.topFunc;
	}
	isBottom(_lhs: Func<Identifier, LatticeElement>): boolean {
		throw new Error('Method not implemented.');
	}
	isTop(_lhs: Func<Identifier, LatticeElement>): boolean {
		throw new Error('Method not implemented.');
	}
}
