import { Enviroment } from '../../enviroment';
import type { LatticeElement } from '../../lattice-element';
import { Variable } from '../../variable';

/**
 * The `NonRelationalValueAbstractEnviroment` class represents an abstract environment for managing 
 * non-relational abstract values during the analysis. It extends the generic `Enviroment` class and 
 * provides additional functionalities tailored for variables and their associated lattice elements.
 *
 * This class allows the storage, retrieval, and manipulation of variables and their corresponding 
 * abstract values in a non-relational manner. It includes operations for checking the existence of variables, 
 * updating their values, and removing them from the environment.
 *
 * @typeParam V - The type of the variables managed by the environment. Must extend `Variable`.
 * @typeParam L - The type of the lattice elements associated with the variables. Must extend `LatticeElement`.
 */
export class NonRelationalValueAbstractEnviroment<V extends Variable, L extends LatticeElement> extends Enviroment<string, L> {

	/**
     * Checks if the given variable exists in the environment.
     *
     * @param variable - The variable to check for existence.
     * @returns `true` if the variable exists in the environment, `false` otherwise.
     */
	hasVariable(variable: V): boolean {
		const id = variable.getId();  
		return super.hasKey(id);  
	}

	/**
     * Retrieves the value associated with the given variable.
     *
     * @param variable - The variable whose value is to be retrieved.
     * @returns The abstract value associated with the variable.
     */
	getValue(variable: V): L {
		const id = variable.getId();
		return super.apply(id);  
	}

	/**
     * Updates the value of the given variable in the environment.
     *
     * @param variable - The variable to update.
     * @param value - The new abstract value to associate with the variable.
     */
	updateValue(variable: V, value: L): void {
		const id = variable.getId();  
		super.updateElement(id, value);  
	}

	updateValueFromName(name: string, value: L) {
		super.updateElement(name, value);
	}

	/**
     * Updates the values of multiple variables in the environment.
     *
     * @param variables - An array of variables to update.
     * @param values - An array of new abstract values to associate with the variables.
     * @throws An error if the number of variables does not match the number of values.
     */
	updateValues(variables: V[], values: L[]): void {
		if(variables.length !== values.length) {
			throw new Error('The number of variables and values must match.');
		}
		for(let i = 0; i < variables.length; i++) {
			const id = variables[i].getId();  
			super.updateElement(id, values[i]);  
		}
	}

	/**
     * Removes the given variable from the environment.
     *
     * @param variable - The variable to remove.
     * @returns `true` if the variable was successfully removed, `false` otherwise.
     */
	removeVariable(variable: V): boolean {
		const id = variable.getId();  
		return super.remove(id);  
	}

	/**
     * Retrieves all variables currently stored in the environment.
     *
     * @returns An array of all variables in the environment.
     */
	getVariables(): V[] {
		const elements: V[] = [];
		const ids = super.getElements();  
		for(const id of ids) {
			elements.push(new Variable(id) as V);  
		}
		return elements;
	}

}

export class BottomNonRelationalValueAbstractEnviroment extends NonRelationalValueAbstractEnviroment<Variable, LatticeElement> {
	private static instance: BottomNonRelationalValueAbstractEnviroment;

	private constructor() {
		super('BottomNonRelationalValueAbstractEnviroment'); 
	}

	static getInstance(): BottomNonRelationalValueAbstractEnviroment {
		if(!BottomNonRelationalValueAbstractEnviroment.instance) {
			BottomNonRelationalValueAbstractEnviroment.instance = new BottomNonRelationalValueAbstractEnviroment();
		}
		return BottomNonRelationalValueAbstractEnviroment.instance;
	}

	toString(): string {
		return 'BOTTOM_NON_RELATIONAL_VALUE_ABSTRACT_ENVIROMENT';
	}
}
