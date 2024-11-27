import { ConstantFunc, Func } from './function';
import type { LatticeElement } from './lattice-element';

export abstract class Enviroment<A, B extends LatticeElement> extends Func<A,B> {

}

export abstract class ConstEnviroment<A, B extends LatticeElement> extends ConstantFunc<A,B> {
    
}