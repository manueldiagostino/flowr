import type { NonRelationalValueAbstractDomain } from './abstract-domain';
import type { Lattice } from '../lattice';
import type { LatticeElement } from '../lattice-element';
import { DefaultNormalizedAstFold } from '../../normalized-ast-fold';
import type { NoInfo } from '../../../r-bridge/lang-4.x/ast/model/model';
import type { RNumber } from '../../../r-bridge/lang-4.x/ast/model/nodes/r-number';
import type { RBinaryOp } from '../../../r-bridge/lang-4.x/ast/model/nodes/r-binary-op';

type AbstractElement = LatticeElement;

export abstract class NonRelationalValueAnalysis<T extends NonRelationalValueAbstractDomain<Lattice<AbstractElement>, unknown>> extends DefaultNormalizedAstFold<AbstractElement> {
	readonly domain: T;

	constructor(domain: T) {
		super(domain.top);
		this.domain = domain;
	}

	foldRNumber(_node: RNumber<NoInfo>): AbstractElement {
		return this.domain.getAbstract(_node.content.num);
	}

	foldRBinaryOp(_binaryOp: RBinaryOp<NoInfo>): AbstractElement {
		const lhs: AbstractElement = this.fold(_binaryOp.lhs);
		const rhs: AbstractElement = this.fold(_binaryOp.rhs);

		return this.domain.evalBinaryOp(_binaryOp.operator, lhs, rhs);
	}
}



