import { NonRelationalValueAbstractEnvironment } from '../../../src/abstract-interpretation/analysis/nonrelational/value/non-relational-value-abstract-environment';
import { Variable } from '../../../src/abstract-interpretation/analysis/variable';
import type { SignLatticeElement } from '../../../src/abstract-interpretation/analysis/nonrelational/value/sign/sign-lattice';
import { SignLattice } from '../../../src/abstract-interpretation/analysis/nonrelational/value/sign/sign-lattice';
import { describe, it, expect } from 'vitest';

describe('NonRelationalValueAbstractEnvironment', () => {

	const env: NonRelationalValueAbstractEnvironment<Variable, SignLatticeElement> = new NonRelationalValueAbstractEnvironment('env', SignLattice.getInstance().top());
	const varX: Variable = new Variable('x');
	const varY: Variable = new Variable('y');

	it('should add and retrieve a variable', () => {
		env.updateValue(varX, SignLattice.GEQ0);
		expect(env.getValue(varX)).toEqual(SignLattice.GEQ0);
	});

	it('should overwrite the value of an existing variable', () => {
		env.updateValue(varX, SignLattice.GEQ0);
		env.updateValue(varX, SignLattice.LEQ0);
		expect(env.getValue(varX)).toEqual(SignLattice.LEQ0);
	});

	it('should remove a variable', () => {
		env.updateValue(varX, SignLattice.ZERO);
		const removed = env.removeVariable(varX);
		expect(removed).toBe(true);
		expect(() => env.getValue(varX)).toThrowError();
	});

	it('should return false when trying to remove a non-existent variable', () => {
		const removed = env.removeVariable(varX);
		expect(removed).toBe(false);
	});

	it('should correctly indicate the presence of a variable', () => {
		env.updateValue(varX, SignLattice.GEQ0);
		expect(env.hasVariable(varX)).toBe(true);
		expect(env.hasVariable(varY)).toBe(false);
	});

	it('should throw an error when updating values with mismatched arrays', () => {
		expect(() => env.updateValues([varX], [SignLattice.GEQ0, SignLattice.LEQ0])).toThrowError(
			'The number of variables and values must match.'
		);
	});

	it('should update multiple variables at once', () => {
		env.updateValues([varX, varY], [SignLattice.GEQ0, SignLattice.LEQ0]);
		expect(env.getValue(varX)).toEqual(SignLattice.GEQ0);
		expect(env.getValue(varY)).toEqual(SignLattice.LEQ0);
	});

	it('should retrieve all stored variables', () => {
		env.updateValue(varX, SignLattice.GEQ0);
		env.updateValue(varY, SignLattice.LEQ0);
		const variables = env.getVariables();
		expect(variables).toHaveLength(2);
		expect(variables.map(v => v.getId())).toEqual(expect.arrayContaining(['x', 'y']));
	});

});

describe('NonRelationalValueAbstractEnvironment - Variable Overwriting', () => {

	const env: NonRelationalValueAbstractEnvironment<Variable, SignLatticeElement> = new NonRelationalValueAbstractEnvironment('env', SignLattice.getInstance().top());
	const varX: Variable = new Variable('x');
	const varY: Variable = new Variable('y');

	it('should not duplicate a variable when updated multiple times', () => {
		// Update the same variable multiple times
		env.updateValue(varX, SignLattice.LEQ0);
		env.updateValue(varX, SignLattice.GEQ0);

		// Retrieve all variables from the environment
		const variables = env.getVariables();

		// Ensure only one instance of the variable exists
		expect(variables.length).toBe(1);
		expect(variables[0].getId()).toBe('x');
		expect(env.getValue(varX)).toBe(SignLattice.GEQ0);
	});

	it('should correctly handle multiple variables and overwrite values independently', () => {
		// Add and update variables multiple times
		env.updateValue(varX, SignLattice.LEQ0);
		env.updateValue(varY, SignLattice.GEQ0);
		env.updateValue(varX, SignLattice.ZERO);

		// Retrieve all variables from the environment
		const variables = env.getVariables();

		// Ensure there are two variables, each updated independently
		expect(variables.length).toBe(2);
		expect(variables.some(v => v.getId() === 'x')).toBe(true);
		expect(variables.some(v => v.getId() === 'y')).toBe(true);

		// Ensure their values are correctly updated
		expect(env.getValue(varX)).toBe(SignLattice.ZERO);
		expect(env.getValue(varY)).toBe(SignLattice.GEQ0);
	});
});

