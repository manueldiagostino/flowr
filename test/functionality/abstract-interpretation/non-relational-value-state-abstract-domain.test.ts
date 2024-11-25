import { describe, it, expect } from 'vitest';
import { Variable } from '../../../src/abstract-interpretation/analysis/variable';
import type { SignLatticeElement } from '../../../src/abstract-interpretation/analysis/nonrelational/value/sign/sign-lattice';
import { SignLattice } from '../../../src/abstract-interpretation/analysis/nonrelational/value/sign/sign-lattice';
import { BottomNonRelationalValueAbstractEnviroment, NonRelationalValueAbstractEnviroment } from '../../../src/abstract-interpretation/analysis/nonrelational/value/non-relational-value-abstract-enviroment';
import { Sign } from '../../../src/abstract-interpretation/analysis/nonrelational/value/sign/sign-domain';
import { NonRelationalValueStateAbstractDomain } from '../../../src/abstract-interpretation/analysis/nonrelational/value/non-relational-value-state-abstract-domain';
import { NonRelationValueAbstractState } from '../../../src/abstract-interpretation/analysis/nonrelational/value/non-relation-value-abstract-state';
describe('NonRelationalValueAbstractDomain test', () => {

	const nonRelationalValueAbstractDomain : NonRelationalValueStateAbstractDomain<Sign> = new NonRelationalValueStateAbstractDomain(Sign.getInstance());

	const varX : Variable = new Variable('x');
	const varY : Variable = new Variable('y');
	const varZ : Variable = new Variable('z');

	nonRelationalValueAbstractDomain.lattice.addIdentifier(varX);
	nonRelationalValueAbstractDomain.lattice.addIdentifier(varY);
	nonRelationalValueAbstractDomain.lattice.addIdentifier(varZ);

	describe('NonRelationalValueAbstractDomain properties', () => {
		it('should have the correct name', () => {
			expect(nonRelationalValueAbstractDomain.name).toBe('NonRelationalValueStateAbstractDomain');
		});

		it('should return the correct lattice', () => {
			expect(nonRelationalValueAbstractDomain.lattice).toBeInstanceOf(NonRelationValueAbstractState);
		});

		it('should return the correct top and bottom elements', () => {
			expect(nonRelationalValueAbstractDomain.bottom).toBeInstanceOf(BottomNonRelationalValueAbstractEnviroment);
		});

	});

	describe('Union operation', () => {
		it('should return the union of two environments with non-overlapping variables', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.LEQ0]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varY], [SignLattice.GEQ0]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX], [SignLattice.LEQ0]);
			expected.updateValues([varY], [SignLattice.GEQ0]);
    
			const result = nonRelationalValueAbstractDomain.union(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
    
		it('should return the union of two environments with overlapping variables', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.LEQ0]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varX], [SignLattice.GEQ0]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX], [SignLattice.TOP]);
    
			const result = nonRelationalValueAbstractDomain.union(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
    
		it('should handle the union of environments where one is empty', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.LEQ0]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('empty enviroment');
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX], [SignLattice.LEQ0]);
    
			const result = nonRelationalValueAbstractDomain.union(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
    
		it('should handle the union of environments where one contains TOP', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.TOP]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varX], [SignLattice.LEQ0]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX], [SignLattice.TOP]);
    
			const result = nonRelationalValueAbstractDomain.union(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
    
		it('should handle the union of environments with multiple variables', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX, varY], [SignLattice.LEQ0, SignLattice.BOTTOM]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varY, varZ], [SignLattice.GEQ0, SignLattice.ZERO]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX], [SignLattice.LEQ0]);
			expected.updateValues([varY], [SignLattice.GEQ0]);
			expected.updateValues([varZ], [SignLattice.ZERO]);
    
			const result = nonRelationalValueAbstractDomain.union(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
    
		it('should handle the union of identical environments', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.LEQ0]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varX], [SignLattice.LEQ0]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX], [SignLattice.LEQ0]);
    
			const result = nonRelationalValueAbstractDomain.union(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
	});

	describe('Intersection operation', () => {
		it('should return the intersection of two environments with non-overlapping variables', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.LEQ0]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varY], [SignLattice.GEQ0]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX, varY], [SignLattice.LEQ0, SignLattice.GEQ0]);

			const result = nonRelationalValueAbstractDomain.intersection(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
    
		it('should return the intersection of two environments with overlapping variables', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.LEQ0]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varX], [SignLattice.GEQ0]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX], [SignLattice.ZERO]);
    
			const result = nonRelationalValueAbstractDomain.intersection(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
    
		it('should handle the intersection of environments where one is empty', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.LEQ0]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('empty enviroment');
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX], [SignLattice.LEQ0]);

			const result = nonRelationalValueAbstractDomain.intersection(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
    
		it('should handle the intersection of environments where one contains TOP', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.TOP]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varX], [SignLattice.LEQ0]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX], [SignLattice.LEQ0]);
    
			const result = nonRelationalValueAbstractDomain.intersection(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
    
		it('should handle the intersection of environments with multiple variables', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX, varY], [SignLattice.LEQ0, SignLattice.BOTTOM]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varY, varZ], [SignLattice.GEQ0, SignLattice.ZERO]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX, varY, varZ], [SignLattice.LEQ0, SignLattice.BOTTOM, SignLattice.ZERO]);
    
			const result = nonRelationalValueAbstractDomain.intersection(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});
    
		it('should handle the intersection of identical environments', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.LEQ0]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varX], [SignLattice.LEQ0]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX], [SignLattice.LEQ0]);
    
			const result = nonRelationalValueAbstractDomain.intersection(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});

		it('should return bottom when all variables in the environments are bottom', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX], [SignLattice.BOTTOM]); 
      
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varX], [SignLattice.BOTTOM]); 
      
			const result = nonRelationalValueAbstractDomain.intersection(env1, env2);
      
			expect(result).toBe(nonRelationalValueAbstractDomain.bottom);
		});

		it('should return bottom when all variables in the environments are bottom', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varY], [SignLattice.BOTTOM]); 
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varX], [SignLattice.BOTTOM]);
    
			const result = nonRelationalValueAbstractDomain.intersection(env1, env2);
    
			expect(result).toBe(nonRelationalValueAbstractDomain.bottom);
		});

	});

	describe('Widening operation', () => {
		
		it('should return TOP if lhs or rhs is TOP', () => {
			
			const env1: NonRelationalValueAbstractEnviroment<Variable, SignLatticeElement> = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX],[SignLattice.TOP]);
            
			const env2: NonRelationalValueAbstractEnviroment<Variable, SignLatticeElement> = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varY],[SignLattice.GEQ0]);

			const expected : NonRelationalValueAbstractEnviroment<Variable, SignLatticeElement> = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX, varY],[SignLattice.TOP ,SignLattice.GEQ0]);

			const resultLhsIsTop = nonRelationalValueAbstractDomain.widening(env1, env2);
			const resulRLhsIsTop = nonRelationalValueAbstractDomain.widening(env2, env1);

			expect(expected.isEqual(resultLhsIsTop)).toBe(true);
			expect(expected.isEqual(resulRLhsIsTop)).toBe(true);
		});

		it('should correctly widen environments with partially overlapping variables', () => {
			const env1 = new NonRelationalValueAbstractEnviroment('enviroment at program point 1');
			env1.updateValues([varX, varY], [SignLattice.LEQ0, SignLattice.ZERO]);
    
			const env2 = new NonRelationalValueAbstractEnviroment('enviroment at program point 2');
			env2.updateValues([varY, varZ], [SignLattice.GEQ0, SignLattice.BOTTOM]);
    
			const expected = new NonRelationalValueAbstractEnviroment('expected enviroment');
			expected.updateValues([varX, varY, varZ], [SignLattice.LEQ0, SignLattice.GEQ0, SignLattice.BOTTOM]);
    
			const result = nonRelationalValueAbstractDomain.widening(env1, env2);
    
			expect(expected.isEqual(result)).toBe(true);
		});

	});

	describe('getConcrete method', () => {
		it('should return the correct concrete string for the environment', () => {
			const env = new NonRelationalValueAbstractEnviroment<Variable, SignLatticeElement>('env');
			env.updateValues([varX, varY, varZ], [SignLattice.LEQ0, SignLattice.GEQ0, SignLattice.ZERO]);
    
			const concrete = nonRelationalValueAbstractDomain.getConcrete(env);
			const expectedConcrete = JSON.stringify({
				x: '(<=0)',
				y: '(>=0)',
				z: '(0)',
			}, null, 2);
    
			expect(concrete).toBe(expectedConcrete);
		});
    
		it('should return an empty object for an environment with no elements', () => {
			const emptyEnv = new NonRelationalValueAbstractEnviroment<Variable, SignLatticeElement>('emptyEnv');
			const concrete = nonRelationalValueAbstractDomain.getConcrete(emptyEnv);
			const expectedConcrete = JSON.stringify({}, null, 2);
    
			expect(concrete).toBe(expectedConcrete);
		});
    
		it('should return the correct concrete string when elements have TOP', () => {
			const env = new NonRelationalValueAbstractEnviroment<Variable, SignLatticeElement>('env');
			env.updateValues([varX], [SignLattice.TOP]);
			env.updateValues([varY], [SignLattice.GEQ0]);
			env.updateValues([varZ], [SignLattice.ZERO]);
    
			const concrete = nonRelationalValueAbstractDomain.getConcrete(env);
			const expectedConcrete = JSON.stringify({
				x: '(TOP)',
				y: '(>=0)',
				z: '(0)',
			}, null, 2);
    
			expect(concrete).toBe(expectedConcrete);
		});
    
		it('should handle non-existent keys gracefully', () => {
			const env = new NonRelationalValueAbstractEnviroment<Variable, SignLatticeElement>('env');
			env.updateValues([varX], [SignLattice.LEQ0]);
			const concrete = nonRelationalValueAbstractDomain.getConcrete(env);
    
			expect(concrete).not.toContain('nonExistentKey');
		});
	});
    
	describe('getAbstract method', () => {
		it('should return the correct abstract environment from a concrete string', () => {
			const concreteStr = JSON.stringify({
				'x': '(<=0)',
				'y': '(>=0)',
				'z': '(0)',
			}, null, 2);
    
			const resultEnv = nonRelationalValueAbstractDomain.getAbstract(concreteStr);

			expect(resultEnv.hasVariable(varX)).toBe(true);
			expect(resultEnv.hasVariable(varY)).toBe(true);
			expect(resultEnv.hasVariable(varZ)).toBe(true);
			expect(resultEnv.getValue(varX)).toBe(SignLattice.LEQ0);
			expect(resultEnv.getValue(varY)).toBe(SignLattice.GEQ0);
			expect(resultEnv.getValue(varZ)).toBe(SignLattice.ZERO);
		});
    
		it('should return an empty environment for an empty concrete string', () => {
			const concreteStr = JSON.stringify({}, null, 2);
			const resultEnv = nonRelationalValueAbstractDomain.getAbstract(concreteStr);
    
			expect(resultEnv.hasVariable(varX)).toBe(false);
			expect(resultEnv.hasVariable(varY)).toBe(false);
			expect(resultEnv.hasVariable(varZ)).toBe(false);
		});
    
		it('should correctly handle concrete string with TOP', () => {
			const concreteStr = JSON.stringify({
				x: '(TOP)',
				y: '(>=0)',
			}, null, 2);
    
			const resultEnv = nonRelationalValueAbstractDomain.getAbstract(concreteStr);
    
			expect(resultEnv.getValue(varX)).toBe(SignLattice.TOP);
			expect(resultEnv.getValue(varY)).toBe(SignLattice.GEQ0);
		});
    
		it('should throw an error for invalid concrete string format', () => {
			const invalidConcreteStr = '{x: "invalid"}';
          
			expect(() => {
				nonRelationalValueAbstractDomain.getAbstract(invalidConcreteStr);
			}).toThrowError();
		});

		it('should ensure all variables in top have SignLattice.TOP', () => {
			const topEnv = nonRelationalValueAbstractDomain.top;

			expect(topEnv).toBeInstanceOf(NonRelationalValueAbstractEnviroment);

			const variables = topEnv.getVariables();

			variables.forEach((varName) => {
				expect(topEnv.getValue(varName)).toBe(SignLattice.TOP);
			});

		});

		it('should return true when value is SignLattice.TOP', () => {
			const env = new NonRelationalValueAbstractEnviroment<Variable, SignLatticeElement>('env');
			env.updateValues([varX], [SignLattice.TOP]);
			env.updateValues([varY], [SignLattice.TOP]);
			env.updateValues([varZ], [SignLattice.TOP]);

			expect(nonRelationalValueAbstractDomain.top.isEqual(env)).toBe(true);
		});



	});
   

});