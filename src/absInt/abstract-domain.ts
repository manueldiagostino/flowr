import type { Lattice } from './lattice';
import type { LatticeElement } from './lattice-element';

export interface AbstractDomain<T extends Lattice<LatticeElement>> {

    name:    string;
    lattice: T;
    top:     LatticeElement;
    bottom:  LatticeElement;
    widening(lhs : LatticeElement, rhs : LatticeElement) : LatticeElement;

}