import type { Lattice } from '../../lattice';
import type { LatticeElement } from '../../lattice-element';
import { PointWiseLifting } from '../../point-wise-lifting';
import type { Variable } from '../../variable';

export class NonRelationValueAbstractState<T extends Variable, L extends Lattice<LatticeElement>> extends PointWiseLifting<T,L> { }