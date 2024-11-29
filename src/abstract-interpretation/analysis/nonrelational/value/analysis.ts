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
import { NonRelationalValueAbstractEnvironment } from './non-relational-value-abstract-environment';
import type { Variable } from '../../variable';
import type { SourceRange } from '../../../../util/range';
import type { NonRelationalValueStateAbstractDomain } from './non-relational-value-state-abstract-domain';
import type { RIfThenElse } from '../../../../r-bridge/lang-4.x/ast/model/nodes/r-if-then-else';

type AbstractElement = LatticeElement;
type AbstractEnvironment = NonRelationalValueAbstractEnvironment<Variable, AbstractElement>;

export class ReturnElement {
	id?:                  string;
	abstractElement?:     AbstractElement;
	abstractEnvironment?: AbstractEnvironment;


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
		this.environment = new NonRelationalValueAbstractEnvironment('NonRelationalValueAnalysisEnvironment', this.domain.top);
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

	updateInvariantFromEnvironment(source: SourceRange|undefined, value: AbstractEnvironment): void {
		if(source && value) {
			// console.debug(value.abstractEnvironment);

			this.invariants.set(
				source,
				this.stateDomain.getConcrete(value)
			);
		}
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
		result.abstractEnvironment = new NonRelationalValueAbstractEnvironment('', this.domain.top);
		return result;
	}

	foldRSymbol(node: RSymbol<NoInfo, string>): ReturnElement {
		const result: ReturnElement = new ReturnElement();
		result.id = node.lexeme;

		if(node.lexeme === 'true'){
			result.abstractElement = this.domain.top;
			result.abstractEnvironment = this.environment;
			return result;
		} else if(node.lexeme === 'false') {
			result.abstractElement = this.domain.bottom;
			result.abstractEnvironment = this.stateDomain.bottom;
			return result;
		}

		result.abstractEnvironment = new NonRelationalValueAbstractEnvironment('', this.domain.top);
		if(this.environment.hasKey(node.lexeme)){
			result.abstractElement = this.environment.apply(node.lexeme);
			result.abstractEnvironment.updateValueFromName(node.lexeme, result.abstractElement);
		} else {
			result.abstractElement = this.domain.top;
			result.abstractEnvironment.updateValueFromName(node.lexeme, this.domain.top);
		}

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
				break;
			default:
				break;
		}

		result.abstractEnvironment = new NonRelationalValueAbstractEnvironment('', this.domain.top);
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
				console.debug('lhs.abstractEnvironment');
				console.debug(lhs.abstractEnvironment);
				console.debug('rhs.abstractEnvironment');
				console.debug(rhs.abstractEnvironment);
				if(lhs.abstractEnvironment && rhs.abstractEnvironment) {
					this.environment = this.stateDomain.union(lhs.abstractEnvironment, rhs.abstractEnvironment);
				} else if(lhs.abstractEnvironment) {
					this.environment = this.stateDomain.union(lhs.abstractEnvironment, this.environment);
				} else if(rhs.abstractEnvironment) {
					this.environment = this.stateDomain.union(rhs.abstractEnvironment, this.environment);
				}
				console.debug(this.environment);
				break;
			case '<-':
				result = this.evalLeftAssignment(lhs.id as string, rhs.abstractElement as AbstractElement);
				this.environment.updateValueFromName(lhs.id as string, rhs.abstractElement as AbstractElement);
				this.updateInvariantFromEnvironment(binaryOp.info.fullRange, this.environment);
				break;
			case '&&': // `AND2` case
				if(!lhs.abstractElement){
					throw new Error('evalBinaryOp::&& lhs.abstractElement is undefined');
				}
				if(this.domain.evalCondition(lhs.abstractElement)) {
					lhs.abstractEnvironment = this.environment.clone();
				} else {
					lhs.abstractEnvironment = this.stateDomain.bottom;
				}


				if(!rhs.abstractElement){
					throw new Error('evalBinaryOp::&& rhs.abstractElement is undefined');
				}
				if(this.domain.evalCondition(rhs.abstractElement)) {
					rhs.abstractEnvironment = this.environment.clone();
				} else {
					rhs.abstractEnvironment = this.stateDomain.bottom;
				}

				result.abstractEnvironment = this.stateDomain.intersection(rhs.abstractEnvironment, lhs.abstractEnvironment);
				console.debug('result of intersection:');
				console.debug(result.abstractEnvironment);
				result.abstractElement = this.domain.evalBinaryOp(binaryOp.operator, rhs.abstractElement, lhs.abstractElement);
				break;
			case '||': // `OR2` case
			default:
				throw new Error(`NonRelationalValueAnalysis::foldRBinaryOp ${binaryOp.operator} not handled`);
		}
		
		// console.debug(`${binaryOp.info.fullLexeme}`);
		// console.debug('result');
		// console.debug(result);
		// console.debug('this.environment');
		// console.debug(this.environment);
		return result;
	}

	evalLeftAssignment(id: string, value: AbstractElement): ReturnElement {

		const result: ReturnElement = new ReturnElement();
		result.id = id;
		result.abstractElement = value;
		result.abstractEnvironment = new NonRelationalValueAbstractEnvironment('', this.domain.top);
		result.abstractEnvironment.updateValueFromName(id, value);

		return result;
	}

	foldRIfThenElse(ite: RIfThenElse<NoInfo>): ReturnElement {
		const conditionResult = this.fold(ite.condition);
		if(!conditionResult.abstractEnvironment) {
			throw new Error('NonRelationalValueAnalysis::foldRIfThenElse conditionResult::abstractEnvironment undefined');
		}

		console.debug('condition.assume:');
		console.debug(conditionResult.abstractEnvironment);

		const thenAnalysis = new NonRelationalValueAnalysis<T,S>(this.domain, this.stateDomain);
		thenAnalysis.environment = this.assume(conditionResult.abstractEnvironment, this.environment);
		console.debug('thenAnalysis.environment:');
		console.debug(thenAnalysis.environment);
		const _thenResult = thenAnalysis.fold(ite.then);

		this.updateInvariants(thenAnalysis.invariants);

		const negConditionAssume = this.stateDomain.evalUnaryOp('!', conditionResult.abstractEnvironment);
		if(!negConditionAssume) {
			throw new Error('NonRelationalValueAnalysis::foldRIfThenElse negConditionResult undefined');
		}
		console.debug('negConditionAssume:');
		console.debug(negConditionAssume);
		
		const result = new ReturnElement();

		if(ite.otherwise) {
			const otherwiseAnalysis = new NonRelationalValueAnalysis<T,S>(this.domain, this.stateDomain);

			otherwiseAnalysis.environment = this.assume(negConditionAssume, this.environment);
			console.debug('otherwiseAnalysis.environment:');
			console.debug(otherwiseAnalysis.environment);

			const _otherwiseResult = otherwiseAnalysis.fold(ite.otherwise);

			this.updateInvariants(otherwiseAnalysis.invariants);

			result.abstractEnvironment = this.stateDomain.union(thenAnalysis.environment, otherwiseAnalysis.environment);
			console.debug('result of then union otherwise:');
			console.debug(result.abstractEnvironment);
		} else {
			result.abstractEnvironment = this.stateDomain.union(thenAnalysis.environment, this.environment);
			console.debug('result of then union this.environment:');
			console.debug(result.abstractEnvironment);
		}

		console.debug('result of if-then-else:');
		console.debug(result.abstractEnvironment);
		this.environment = result.abstractEnvironment;

		this.updateInvariant(ite.info.fullRange, result);
		return result;
	}

	assume(condition: AbstractEnvironment, environment: AbstractEnvironment): AbstractEnvironment {
		return this.stateDomain.assume(condition, environment);
	}
}
