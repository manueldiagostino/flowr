import { Func } from './function';
import type { LatticeElement } from './lattice-element';

export abstract class Enviroment<A, B extends LatticeElement> extends Func<A,B> {

}