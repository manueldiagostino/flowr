import { ConstantFunc, Func } from './function';
import type { LatticeElement } from './lattice-element';

export abstract class Environment<A, B extends LatticeElement> extends Func<A,B> {

	readonly top: B;

	constructor(name : string, top : B) {
		super(name);
		this.top = top;
	}

}

export abstract class ConstEnvironment<A, B extends LatticeElement> extends ConstantFunc<A,B> {
    
}