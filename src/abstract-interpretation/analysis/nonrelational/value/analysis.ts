import type { NonRelationalValueAbstractDomain } from './abstract-domain';
import type { Lattice } from '../../lattice';
import type { LatticeElement } from '../../lattice-element';
import { DefaultNormalizedAstFold } from '../../../normalized-ast-fold';
import type { NoInfo } from '../../../../r-bridge/lang-4.x/ast/model/model';
import type { RNumber } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-number';
import type { RBinaryOp } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-binary-op';
import type { RExpressionList } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-expression-list';
import type { RUnaryOp } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-unary-op';

type AbstractElement = LatticeElement;

export abstract class NonRelationalValueAnalysis<T extends NonRelationalValueAbstractDomain<Lattice<AbstractElement>, unknown>> extends DefaultNormalizedAstFold<AbstractElement> {
	readonly domain: T;

	constructor(domain: T) {
		super(domain.top);
		this.domain = domain;
	}

	foldRExpressionList(exprList: RExpressionList<NoInfo>): AbstractElement {
		if(exprList.children.length === 1) {
			return this.fold(exprList.children[0]);
		}

		for(let i = 0; i < exprList.children.length; i++) {
			const child = exprList.children[i];

			const result: AbstractElement = this.fold(child);
			console.log(`[Child ${i}] ${result.name}`);
		}

		return this.domain.top;
	}

	foldRNumber(_node: RNumber<NoInfo>): AbstractElement {
		return this.domain.getAbstract(_node.content.num);
	}

	foldRUnaryOp(unaryOp: RUnaryOp<NoInfo>): AbstractElement {
		const operand: AbstractElement = this.fold(unaryOp.operand);
		return this.domain.evalUnaryOp(unaryOp.operator, operand);
	}

	foldRBinaryOp(_binaryOp: RBinaryOp<NoInfo>): AbstractElement {
		const lhs: AbstractElement = this.fold(_binaryOp.lhs);
		const rhs: AbstractElement = this.fold(_binaryOp.rhs);

		return this.domain.evalBinaryOp(_binaryOp.operator, lhs, rhs);
	}
}



