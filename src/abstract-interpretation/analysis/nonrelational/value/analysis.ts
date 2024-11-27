import type { NonRelationalValueAbstractDomain } from './abstract-domain';
import type { Lattice } from '../../lattice';
import type { LatticeElement } from '../../lattice-element';
import { DefaultNormalizedAstFold } from '../../../normalized-ast-fold';
import type { NoInfo } from '../../../../r-bridge/lang-4.x/ast/model/model';
import type { RNumber } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-number';
import type { RBinaryOp } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-binary-op';
import type { RExpressionList } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-expression-list';
import type { RUnaryOp } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-unary-op';
import type { RSymbol } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-symbol';
import { NonRelationalValueAbstractEnviroment } from './non-relational-value-abstract-enviroment';
import type { Variable } from '../../variable';
import { ProgramPoint } from '../../program-point';
import type { SourceRange } from '../../../../util/range';
import type { NonRelationalValueStateAbstractDomain } from './non-relational-value-state-abstract-domain';

type AbstractElement = LatticeElement;
type NonRelationalValueAbstractEnviromentType = NonRelationalValueAbstractEnviroment<Variable, AbstractElement>;

export class ReturnElement {
	id?:                  string;
	abstractElement?:     AbstractElement;
	abstractEnvironment?: NonRelationalValueAbstractEnviroment<Variable, AbstractElement>;


	constructor() {
		this.id = undefined;
		this.abstractElement = undefined;
		this.abstractEnvironment = undefined;
	}
}

export abstract class NonRelationalValueAnalysis<
	T extends NonRelationalValueAbstractDomain<Lattice<AbstractElement>>,
	S extends NonRelationalValueStateAbstractDomain<T>> extends DefaultNormalizedAstFold<ReturnElement> {
	private domain:      T;
	private environment: NonRelationalValueAbstractEnviromentType;
	private invariants:  Map<ProgramPoint, string>;
	private stateDomain: S;

	constructor(domain: T, state: S) {
		const topRet = new ReturnElement();
		topRet.abstractElement = domain.top;
		super(topRet);
		this.domain = domain;
		this.environment = new NonRelationalValueAbstractEnviroment('NonRelationalValueAnalysisEnvironment');
		this.invariants = new Map();
		this.stateDomain = state;
	}

	getInvariants(): Map<ProgramPoint, string> {
		return this.invariants;
	}

	getJSONInvariants(): string {
		return JSON.stringify(
			Array.from(this.invariants.entries()).map(([programPoint, environment]) => ({
				programPoint: programPoint.toString(),
				environment:  environment
			})),
			null,
			2
		);
	}

	updateInvariants(source: SourceRange|undefined, value: ReturnElement): void {
		if(source && value.abstractEnvironment) {
			// console.debug(value.abstractEnvironment);

			this.invariants.set(
				new ProgramPoint(source),
				this.stateDomain.getConcrete(value.abstractEnvironment)
			);
		}
	}

	foldRExpressionList(exprList: RExpressionList<NoInfo>): ReturnElement {
		if(exprList.children.length === 1) {
			const child = exprList.children[0];
			const result: ReturnElement = this.fold(child);
			this.updateInvariants(child.location, result);

			// if(result.abstractEnvironment) {
			// 	this.environment = result.abstractEnvironment;
			// }

			return result;
		}

		for(let i = 0; i < exprList.children.length; i++) {
			const child = exprList.children[i];
			const result: ReturnElement = this.fold(child);
			this.updateInvariants(child.location, result);

			// if(result.abstractEnvironment) {
			// 	this.environment = result.abstractEnvironment;
			// }
		}

		return this.empty;
	}

	foldRNumber(node: RNumber<NoInfo>): ReturnElement {
		const result: ReturnElement = new ReturnElement();
		result.abstractElement = this.domain.getAbstract(node.content.num.toString());

		return result;
	}

	foldRSymbol(node: RSymbol<NoInfo, string>): ReturnElement {
		const result: ReturnElement = new ReturnElement();
		result.id = node.lexeme;

		if(this.environment.hasKey(node.lexeme)){
			result.abstractElement = this.environment.apply(node.lexeme);
		} else {
			result.abstractElement = this.domain.top;
		}
		
		return result;
	}

	foldRUnaryOp(unaryOp: RUnaryOp<NoInfo>): ReturnElement {
		const operand: ReturnElement = this.fold(unaryOp.operand);
		const result: ReturnElement = new ReturnElement();

		result.abstractElement = this.domain.evalUnaryOp(unaryOp.operator, operand.abstractElement as AbstractElement);
		return result;
	}

	foldRBinaryOp(_binaryOp: RBinaryOp<NoInfo>): ReturnElement {
		const lhs: ReturnElement = this.fold(_binaryOp.lhs);
		const rhs: ReturnElement = this.fold(_binaryOp.rhs);
		let result: ReturnElement = new ReturnElement();

		switch(_binaryOp.operator) {
			case '+':
				result.abstractElement = this.domain.evalBinaryOp(_binaryOp.operator, lhs.abstractElement as AbstractElement, rhs.abstractElement as AbstractElement);
				break;
			case '-':
				result.abstractElement = this.domain.evalBinaryOp(_binaryOp.operator, lhs.abstractElement as AbstractElement, rhs.abstractElement as AbstractElement);
				break;
			case '*':
				result.abstractElement = this.domain.evalBinaryOp(_binaryOp.operator, lhs.abstractElement as AbstractElement, rhs.abstractElement as AbstractElement);
				break;
			case '/':
				result.abstractElement = this.domain.evalBinaryOp(_binaryOp.operator, lhs.abstractElement as AbstractElement, rhs.abstractElement as AbstractElement);
				break;
			case '<-':
				result = this.evalLeftAssignment(lhs.id as string, rhs.abstractElement as AbstractElement);
				break;
			default:
				throw new Error(`NonRelationalValueAnalysis::foldRBinaryOp ${_binaryOp.operator} not handled`);
		}

		return result;
	}

	evalLeftAssignment(id: string, value: AbstractElement): ReturnElement {
		this.environment.updateValueFromName(id, value);

		const result: ReturnElement = new ReturnElement();
		result.id = id;
		result.abstractElement = value;
		result.abstractEnvironment = this.environment.clone();

		return result;
	}
}



