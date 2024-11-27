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
import type { SourceRange } from '../../../../util/range';
import type { NonRelationalValueStateAbstractDomain } from './non-relational-value-state-abstract-domain';
import type { RIfThenElse } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-if-then-else';

type AbstractElement = LatticeElement;
type AbstractEnvironment = NonRelationalValueAbstractEnviroment<Variable, AbstractElement>;

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

export class NonRelationalValueAnalysis<
	T extends NonRelationalValueAbstractDomain<Lattice<AbstractElement>>,
	S extends NonRelationalValueStateAbstractDomain<T>> extends DefaultNormalizedAstFold<ReturnElement> {
	private domain:      T;
	private environment: AbstractEnvironment;
	private invariants:  Map<SourceRange, string>;
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

	getInvariants(): Map<SourceRange, string> {
		return this.invariants;
	}

	getJSONInvariants(): string {
		return JSON.stringify(
			Array.from(this.invariants.entries()).map(([programPoint, environment]) => ({
				programPoint: programPoint.toString(),
				// Parse 'environment' string back to JSON, or use as-is if it's already an object
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				environment:  JSON.parse(environment)
			})),
			null,
			2
		);
	}

	updateInvariant(source: SourceRange|undefined, value: ReturnElement): void {
		if(source && value.abstractEnvironment) {
			// console.debug(value.abstractEnvironment);

			this.invariants.set(
				source,
				this.stateDomain.getConcrete(value.abstractEnvironment)
			);
		}
	}

	updateInvariants(other: Map<SourceRange, string>) {
		other.forEach((value,key) => {
			if(!this.invariants.has(key)) {
				this.invariants.set(key, value);
			}
		});
	}

	foldRExpressionList(exprList: RExpressionList<NoInfo>): ReturnElement {
		if(exprList.children.length === 1) {
			const child = exprList.children[0];
			const result: ReturnElement = this.fold(child);

			return result;
		}

		for(let i = 0; i < exprList.children.length; i++) {
			const child = exprList.children[i];
			const _result: ReturnElement = this.fold(child);
		}

		return this.empty;
	}

	foldRNumber(node: RNumber<NoInfo>): ReturnElement {
		const result: ReturnElement = new ReturnElement();
		result.abstractElement = this.domain.getAbstract(node.content.num.toString());
		result.abstractEnvironment = this.environment;

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
		result.abstractEnvironment = this.environment;
		
		return result;
	}

	foldRUnaryOp(unaryOp: RUnaryOp<NoInfo>): ReturnElement {
		const operand: ReturnElement = this.fold(unaryOp.operand);
		const result: ReturnElement = new ReturnElement();

		switch(unaryOp.operator) {
			case '-':
				result.abstractElement = this.domain.evalUnaryOp(unaryOp.operator, operand.abstractElement as AbstractElement);
				break;
			case '!':
				result.abstractElement = this.domain.evalUnaryOp(unaryOp.operator, operand.abstractElement as AbstractElement);
				result.abstractEnvironment = this.environment;
				break;
			default:
				break;
		}

		this.updateInvariant(unaryOp.info.fullRange, result);
		return result;
	}

	foldRBinaryOp(binaryOp: RBinaryOp<NoInfo>): ReturnElement {
		const lhs: ReturnElement = this.fold(binaryOp.lhs);
		const rhs: ReturnElement = this.fold(binaryOp.rhs);
		let result: ReturnElement = new ReturnElement();

		switch(binaryOp.operator) {
			case '+':
			case '-':
			case '*':
			case '/':
				result.abstractElement = this.domain.evalBinaryOp(binaryOp.operator, lhs.abstractElement as AbstractElement, rhs.abstractElement as AbstractElement);

				if(lhs.abstractEnvironment && rhs.abstractEnvironment) {
					this.environment = this.stateDomain.union(lhs.abstractEnvironment as AbstractEnvironment, rhs.abstractEnvironment as AbstractEnvironment);
				} else if(lhs.abstractEnvironment) {
					this.environment = this.stateDomain.union(lhs.abstractEnvironment as AbstractEnvironment, this.environment);
				} else if(rhs.abstractEnvironment) {
					this.environment = this.stateDomain.union(rhs.abstractEnvironment as AbstractEnvironment, this.environment);
				}
				
				result.abstractEnvironment = this.environment;
				break;
			case '<-':
				result = this.evalLeftAssignment(lhs.id as string, rhs.abstractElement as AbstractElement);
				this.updateInvariant(binaryOp.info.fullRange, result);
				break;
			case '&&': // `AND2` case
				result.abstractEnvironment = this.stateDomain.intersection(lhs.abstractEnvironment as AbstractEnvironment, rhs.abstractEnvironment as AbstractEnvironment);
				break;
			case '||': // `OR2` case
				result.abstractEnvironment = this.stateDomain.union(lhs.abstractEnvironment as AbstractEnvironment, rhs.abstractEnvironment as AbstractEnvironment);
				break;
			default:
				throw new Error(`NonRelationalValueAnalysis::foldRBinaryOp ${binaryOp.operator} not handled`);
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

	foldRIfThenElse(ite: RIfThenElse<NoInfo>): ReturnElement {
		const conditionResult = this.fold(ite.condition);
		if(!conditionResult.abstractEnvironment) {
			throw new Error('NonRelationalValueAnalysis::foldRIfThenElse conditionResult::abstractEnvironment undefined');
		}

		const thenAnalysis = new NonRelationalValueAnalysis<T,S>(this.domain, this.stateDomain);
		thenAnalysis.environment = conditionResult.abstractEnvironment?.clone();
		const _thenResult = thenAnalysis.fold(ite.then);

		this.updateInvariants(thenAnalysis.invariants);

		console.debug(conditionResult.abstractEnvironment);
		const negConditionResult = this.stateDomain.evalUnaryOp('!', conditionResult.abstractEnvironment);
		if(!negConditionResult) {
			throw new Error('NonRelationalValueAnalysis::foldRIfThenElse negConditionResult undefined');
		}
		
		const result = new ReturnElement();

		if(ite.otherwise) {
			const otherwiseAnalysis = new NonRelationalValueAnalysis<T,S>(this.domain, this.stateDomain);
			otherwiseAnalysis.environment = negConditionResult.clone();
			const _otherwiseResult = otherwiseAnalysis.fold(ite.otherwise);

			this.updateInvariants(otherwiseAnalysis.invariants);

			result.abstractEnvironment = this.stateDomain.union(thenAnalysis.environment, otherwiseAnalysis.environment);
		} else {
			result.abstractEnvironment = this.stateDomain.union(thenAnalysis.environment, this.environment);
		}

		this.environment = this.stateDomain.union(this.environment, result.abstractEnvironment);
		result.abstractEnvironment = this.environment;

		this.updateInvariant(ite.info.fullRange, result);
		return result;
	}
}
