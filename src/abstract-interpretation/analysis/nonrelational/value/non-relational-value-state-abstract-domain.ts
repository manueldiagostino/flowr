import type { LatticeElement } from '../../lattice-element';
import type { NonRelationalValueAbstractDomain } from './abstract-domain';
import type { Lattice } from '../../lattice';
import { NonRelationalValueAbstractState } from './non-relational-value-abstract-state';
import { Variable } from '../../variable';
import { BottomNonRelationalValueAbstractEnvironment, NonRelationalValueAbstractEnvironment, TopNonRelationalValueAbstractEnvironment } from './non-relational-value-abstract-environment';
import { EmptySet } from '../../utils';

export type StateLatticeElement = NonRelationalValueAbstractEnvironment<Variable, LatticeElement>;

/**
 * Represents a non-relational abstract domain designed to operate on abstract states and environments.
 * This class implements the `NonRelationalValueAbstractDomain` interface and provides concrete implementations
 * for lattice operations and abstract interpretation on non-relational environments.
 *
 * @typeParam T - A specific non-relational abstract domain extending `NonRelationalValueAbstractDomain` and operating on lattice elements.
 */
export class NonRelationalValueStateAbstractDomain<T extends NonRelationalValueAbstractDomain<Lattice<LatticeElement>>>
implements NonRelationalValueAbstractDomain<NonRelationalValueAbstractState<Variable, Lattice<LatticeElement>>> {

	/**
	 * The name of the abstract domain.
	 */
	readonly name: string = 'NonRelationalValueStateAbstractDomain';

	/**
	 * The lattice associated with the abstract domain, representing abstract states.
	 */
	readonly lattice: NonRelationalValueAbstractState<Variable, Lattice<LatticeElement>>;

	/**
	 * The underlying non-relational value abstract domain.
	 */
	readonly nonRelationalValueAbstractDomain: T;

	/**
	 * The "bottom" environment of the abstract domain, representing the least defined state.
	 */
	readonly bottom: BottomNonRelationalValueAbstractEnvironment;

	readonly top: TopNonRelationalValueAbstractEnvironment<Variable, LatticeElement>;

	/**
	 * Constructs an instance of the non-relational value state abstract domain.
	 *
	 * @param nonRelationalValueAbstractDomain - The specific non-relational value abstract domain to use.
	 */
	public constructor(nonRelationalValueAbstractDomain: T) {
		this.nonRelationalValueAbstractDomain = nonRelationalValueAbstractDomain;
		this.lattice = new NonRelationalValueAbstractState(nonRelationalValueAbstractDomain.lattice);
		this.bottom = BottomNonRelationalValueAbstractEnvironment.getInstance(this.nonRelationalValueAbstractDomain.top);
		this.top = new TopNonRelationalValueAbstractEnvironment('top env', this.lattice.top());
	}

	/**
	 * Computes the intersection of two abstract environments, producing a new environment.
	 *
	 * @param lhs - The first abstract environment.
	 * @param rhs - The second abstract environment.
	 * @returns The intersection of `lhs` and `rhs`.
	 */
	intersection(
		lhs: NonRelationalValueAbstractEnvironment<Variable, LatticeElement>,
		rhs: NonRelationalValueAbstractEnvironment<Variable, LatticeElement>
	): NonRelationalValueAbstractEnvironment<Variable, LatticeElement> {

		if(this.isBottom(lhs) || this.isBottom(rhs)) {
			return this.bottom;
		}

		const newEnv = new NonRelationalValueAbstractEnvironment<Variable, LatticeElement>('NonRelationalValueAbstractEnvironment', this.top);

		const keys : Variable[] = Array.from(new Set([...lhs.getVariables() , ...rhs.getVariables()])); 

		for(const value of keys) {
			const lhsHasKey = lhs.hasVariable(value);
			const rhsHasKey = rhs.hasVariable(value);

			if(lhsHasKey && rhsHasKey) {
				newEnv.updateValue(value, this.nonRelationalValueAbstractDomain.intersection(lhs.getValue(value), rhs.getValue(value)));
			} else if(lhsHasKey) {
				newEnv.updateValue(value, lhs.getValue(value));
			} else if(rhsHasKey) {
				newEnv.updateValue(value, rhs.getValue(value));
			}

		}

		return Array.from(newEnv.getVariables()).every(
			key => newEnv.getValue(key) === this.nonRelationalValueAbstractDomain.bottom
		) ? this.bottom : newEnv;

	}

	/**
	 * Computes the union of two abstract environments, producing a new environment.
	 *
	 * @param lhs - The first abstract environment.
	 * @param rhs - The second abstract environment.
	 * @returns The union of `lhs` and `rhs`.
	 */
	union(
		lhs: NonRelationalValueAbstractEnvironment<Variable, LatticeElement>,
		rhs: NonRelationalValueAbstractEnvironment<Variable, LatticeElement>
	): NonRelationalValueAbstractEnvironment<Variable, LatticeElement> {

		if(this.isBottom(lhs)) {
			return rhs;
		}

		if(this.isBottom(lhs)) {
			return lhs;
		}

		const newEnv = new NonRelationalValueAbstractEnvironment<Variable, LatticeElement>('NonRelationalValueAbstractEnvironment', this.top);
		const keys : Variable[] = Array.from(new Set([...lhs.getVariables() , ...rhs.getVariables()])); 

		for(const value of keys) {
			const lhsHasKey = lhs.hasVariable(value);
			const rhsHasKey = rhs.hasVariable(value);

			if(lhsHasKey && rhsHasKey) {
				newEnv.updateValue(value, this.nonRelationalValueAbstractDomain.union(lhs.getValue(value), rhs.getValue(value)));
			} else if(lhsHasKey) {
				newEnv.updateValue(value, lhs.getValue(value));
			} else if(rhsHasKey) {
				newEnv.updateValue(value, rhs.getValue(value));
			}
		}

		return newEnv;
	}

	/**
	 * Converts an abstract environment into its corresponding concrete representation.
	 *
	 * @param abstractElement - The abstract environment to be converted.
	 * @returns A string representing the concrete state of the environment.
	 */
	getConcrete(abstractElement: NonRelationalValueAbstractEnvironment<Variable, LatticeElement>): string {

		if(this.isBottom(abstractElement)) {
			return EmptySet.getInstance().toString();
		}

		const concreteObject: { [key: string]: string } = {};

		const keys : Variable[] = abstractElement.getVariables(); 

		for(const value of keys) {
			if(abstractElement.hasVariable(value)) {
				const key = value.getId();
				const concreteValue = this.nonRelationalValueAbstractDomain.getConcrete(
					abstractElement.getValue(value)
				);
				concreteObject[key] = concreteValue;
			}
		}

		return JSON.stringify(concreteObject, null, 2);
	}

	/**
	 * Converts a concrete representation into its corresponding abstract environment.
	 *
	 * @param concreteElement - The concrete state to be converted.
	 * @returns A new abstract environment representing the concrete state.
	 */
	getAbstract(concreteElement: string): NonRelationalValueAbstractEnvironment<Variable, LatticeElement> {

		if(concreteElement === EmptySet.getInstance().toString()) {
			return this.bottom;
		}

		const parsedObject: Record<string, string> = JSON.parse(concreteElement) as Record<string, string>;


		const abstractEnv = new NonRelationalValueAbstractEnvironment<Variable, LatticeElement>('NonRelationalValueAbstractEnvironment', this.top);

		for(const key in parsedObject) {
			if(Object.prototype.hasOwnProperty.call(parsedObject, key)) {
				const variable = new Variable(key);
				const latticeElement = this.nonRelationalValueAbstractDomain.getAbstract(parsedObject[key]);
				abstractEnv.updateValues([variable], [latticeElement]);
			}
		}

		return abstractEnv;
	}


	/**
	 * Performs a widening operation on two abstract environments to compute a more general state.
	 *
	 * @param lhs - The first abstract environment.
	 * @param rhs - The second abstract environment.
	 * @returns The result of the widening operation.
	 */
	widening(
		lhs: NonRelationalValueAbstractEnvironment<Variable, LatticeElement>,
		rhs: NonRelationalValueAbstractEnvironment<Variable, LatticeElement>
	): NonRelationalValueAbstractEnvironment<Variable, LatticeElement> {

		if(this.isBottom(lhs)) {
			return rhs;
		}

		if(this.isBottom(lhs)) {
			return lhs;
		}

		const newEnv = new NonRelationalValueAbstractEnvironment<Variable, LatticeElement>('NonRelationalValueAbstractEnvironment', this.top);
		const keys : Variable[] = Array.from(new Set([...lhs.getVariables() , ...rhs.getVariables()])); 

		for(const value of keys) {
			const lhsHasKey = lhs.hasVariable(value);
			const rhsHasKey = rhs.hasVariable(value);

			if(lhsHasKey && rhsHasKey) {
				newEnv.updateValue(value, this.nonRelationalValueAbstractDomain.widening(lhs.getValue(value), rhs.getValue(value)));
			} else if(lhsHasKey) {
				newEnv.updateValue(value, lhs.getValue(value));
			} else if(rhsHasKey) {
				newEnv.updateValue(value, rhs.getValue(value));
			}
		}

		return newEnv;
	}

	isBottom(lhs: StateLatticeElement): boolean {
		return lhs === this.bottom;
	}

	narrowing(_lhs: StateLatticeElement, _rhs: StateLatticeElement): StateLatticeElement {
		throw new Error('Method not implemented.');
	}

	evalBinaryOp(_operator: string, _lhs: StateLatticeElement, _rhs: StateLatticeElement): StateLatticeElement {
		throw new Error('Method not implemented.');
	}

	evalUnaryOp(_operator: string, _operand: StateLatticeElement): StateLatticeElement {
		
		const newEnv = new NonRelationalValueAbstractEnvironment<Variable, LatticeElement>('NonRelationalValueAbstractEnvironment', this.top);
		const keys : Variable[] = _operand.getVariables();

		for(const value of keys) {
			newEnv.updateValue(value, this.nonRelationalValueAbstractDomain.evalUnaryOp(_operator, _operand.getValue(value)));
		}

		return newEnv;
	}
}
