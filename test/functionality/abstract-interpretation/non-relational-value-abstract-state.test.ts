import { describe, it, expect } from 'vitest';
import { NonRelationalValueAbstractState } from '../../../src/abstract-interpretation/analysis/nonrelational/value/non-relational-value-abstract-state';
import { Variable } from '../../../src/abstract-interpretation/analysis/variable';
import type { SignLatticeElement } from '../../../src/abstract-interpretation/analysis/nonrelational/value/sign/sign-lattice';
import { SignLattice } from '../../../src/abstract-interpretation/analysis/nonrelational/value/sign/sign-lattice';
import { Func } from '../../../src/abstract-interpretation/analysis/function';

describe('NonRelationalValueAbstractState test', () => {

	const varX : Variable = new Variable('x');
	const varY : Variable = new Variable('y');
	const varZ : Variable = new Variable('z');

	// Create the NonRelationalValueAbstractState instance
	const nonRelationValueAbstractState : NonRelationalValueAbstractState<Variable, SignLattice> = new NonRelationalValueAbstractState(SignLattice.getInstance());

	describe('when comparing two abstract states using lessOrEqual (\u2264)', () => {

		it('should return true when both states are empty', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 1');
			const state2: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 2');
        
			const result: boolean = nonRelationValueAbstractState.lessOrEqual(state1, state2);
			expect(result).toBe(true);
		});    

		it('should return false when states have disjoint keys', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 1');
			state1.updateElements([varX], [SignLattice.BOTTOM]);
        
			const state2: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 2');
			state2.updateElements([varY], [SignLattice.GEQ0]);
        
			const result: boolean = nonRelationValueAbstractState.lessOrEqual(state1, state2);
			expect(result).toBe(false);
		});
        
        
		it('should return true when the two states are identical', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 1');
			state1.updateElements([varX, varY], [SignLattice.GEQ0, SignLattice.GEQ0]);
        
			const state2: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 2');
			state2.updateElements([varX, varY], [SignLattice.GEQ0, SignLattice.GEQ0]);
        
			const result: boolean = nonRelationValueAbstractState.lessOrEqual(state1, state2);
			expect(result).toBe(true);
		});        

		it('should return false when shared keys in the first state are greater than the corresponding keys in the second state', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 1');
			state1.updateElements([varX], [SignLattice.TOP]); // Shared key: varX
        
			const state2: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 2');
			state2.updateElements([varX, varY], [SignLattice.BOTTOM, SignLattice.GEQ0]); // varX is less in state2
        
			const result: boolean = nonRelationValueAbstractState.lessOrEqual(state1, state2);
			expect(result).toBe(false);
		});
        

		it('should return false when the first state is not less than or equal to the second', () => {
			// Create two Func states with different variable assignments
			const state1 : Func<Variable, SignLatticeElement> = new Func('abstract state at program point 1');
			state1.updateElements([varX], [SignLattice.BOTTOM]);

			const state2 : Func<Variable, SignLatticeElement> = new Func('abstract state at program point 2');
			state2.updateElements([varX], [SignLattice.GEQ0]);

			// Compare the two states using lessOrEqual
			const result: boolean = nonRelationValueAbstractState.lessOrEqual(state1, state2);

			// Verify that the comparison result is true
			expect(result).toBe(true);
		});

		it('should return false when the first state has more keys than the second', () => {
			// Create two Func states: the first has more keys than the second
			const state1: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 1');
			state1.updateElements([varX, varY], [SignLattice.BOTTOM, SignLattice.BOTTOM]); // More keys
        
			const state2: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 2');
			state2.updateElements([varX], [SignLattice.TOP]); // Fewer keys
        
			// Compare the two states using lessOrEqual
			const result: boolean = nonRelationValueAbstractState.lessOrEqual(state1, state2);
        
			// Verify that the comparison result is false
			expect(result).toBe(false);
		});

		it('should return true when the second state has more keys than the first', () => {
			// Create two Func states: the second has more keys than the first
			const state1: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 1');
			state1.updateElements([varX], [SignLattice.BOTTOM]); // Fewer keys
        
			const state2: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 2');
			state2.updateElements([varX, varY], [SignLattice.BOTTOM, SignLattice.TOP]); // More keys
        
			// Compare the two states using lessOrEqual
			const result: boolean = nonRelationValueAbstractState.lessOrEqual(state1, state2);
        
			// Verify that the comparison result is true
			expect(result).toBe(true);
		});        

		it('should return false when the first state has a key with a greater value than the corresponding key in the second state, even if the second state has more keys', () => {
			// Create two Func states: state1 has a key with a greater value, and state2 has more keys
			const state1: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 1');
			state1.updateElements([varX], [SignLattice.TOP]); // Key with a higher value
        
			const state2: Func<Variable, SignLatticeElement> = new Func('abstract state at program point 2');
			state2.updateElements([varX, varY], [SignLattice.GEQ0, SignLattice.BOTTOM]); // More keys, but varX has a lower value
        
			// Compare the two states using lessOrEqual
			const result: boolean = nonRelationValueAbstractState.lessOrEqual(state1, state2);
        
			// Verify that the comparison result is false
			expect(result).toBe(false);
		});

	});

	describe('when combining two states using LUB (Least Upper Bound)', () => {

		it('should return an empty Func state when both states are empty', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('empty state 1');
			const state2: Func<Variable, SignLatticeElement> = new Func('empty state 2');
        
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.lub(state1, state2);
        
			const expected: Func<Variable, SignLatticeElement> = new Func('empty result');
			expect(result.isEqual(expected)).toBe(true);
		});        

		it('should return the non-empty state when one state is empty', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('non-empty state');
			state1.updateElements([varX], [SignLattice.GEQ0]);
        
			const state2: Func<Variable, SignLatticeElement> = new Func('empty state');
        
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.lub(state1, state2);
        
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.GEQ0]);
        
			expect(result.isEqual(expected)).toBe(true);
		});        

		it('should compute the correct LUB for common variables with different values', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.ZERO]);
        
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varX], [SignLattice.GEQ0]);
        
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.lub(state1, state2);
        
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.GEQ0]);
        
			expect(result.isEqual(expected)).toBe(true);
		});
        
		it('should combine variables when there are no common variables', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.GEQ0]);
        
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varY], [SignLattice.LEQ0]);
        
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.lub(state1, state2);
        
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX, varY], [SignLattice.GEQ0, SignLattice.LEQ0]);
        
			expect(result.isEqual(expected)).toBe(true);
		});
        
		it('should return TOP for a variable if it is TOP in either state', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.TOP]);
        
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varX], [SignLattice.LEQ0]);
        
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.lub(state1, state2);
        
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.TOP]);
        
			expect(result.isEqual(expected)).toBe(true);
		});        

		it('should ignore BOT and return the other value for a variable', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.BOTTOM]);
        
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varX], [SignLattice.ZERO]);
        
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.lub(state1, state2);
        
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.ZERO]);
        
			expect(result.isEqual(expected)).toBe(true);
		});        

		it('should correctly compute the LUB for multiple variables with mixed values', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX, varY], [SignLattice.ZERO, SignLattice.ZERO]);
        
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varY, varZ], [SignLattice.GEQ0, SignLattice.LEQ0]);
        
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.lub(state1, state2);
        
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX, varY, varZ], [SignLattice.ZERO, SignLattice.GEQ0, SignLattice.LEQ0]);
        
			expect(result.isEqual(expected)).toBe(true);
		});        

		it('should return the same state when variables have identical values in both states', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.ZERO]);
        
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varX], [SignLattice.ZERO]);
        
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.lub(state1, state2);
        
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.ZERO]);
        
			expect(result.isEqual(expected)).toBe(true);
		});        
        
		it('should correctly compute the LUB of two Func states', () => {
			// Create two Func states with different variable assignments
			const state1 : Func<Variable, SignLatticeElement> = new Func('state at pp 1');
			state1.updateElements([varX], [SignLattice.GEQ0]);

			const state2 : Func<Variable, SignLatticeElement> = new Func('state at pp 2');
			state2.updateElements([varX, varY], [SignLattice.GEQ0, SignLattice.GEQ0]);

			// Compute the LUB of the two states
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.lub(state1, state2);

			// Define the expected result after LUB operation
			const expected: Func<Variable, SignLatticeElement> = new Func('func');
			expected.updateElements([varX, varY], [SignLattice.GEQ0, SignLattice.GEQ0]);

			// Assert that the result is equal to the expected Func state
			expect(result.isEqual(expected)).toBe(true);
		});

		it('should return true if the LUB includes the common variables and the different ones', () => {
			// Create two Func states with some common and some different variables
			const state1 : Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX, varY], [SignLattice.GEQ0, SignLattice.TOP]);
    
			const state2 : Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varY, varZ], [SignLattice.GEQ0, SignLattice.GEQ0]);
    
			// Perform LUB and get the result
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.lub(state1, state2);
    
			// The expected result should contain all three variables with GEQ0
			const expected : Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX, varY, varZ], [SignLattice.GEQ0, SignLattice.TOP, SignLattice.GEQ0]);
    
			// Assert that the LUB result is equal to the expected result
			expect(result.isEqual(expected)).toBe(true);
		});
	});

	describe('when combining two states using GLB (Greatest Lower Bound)', () => {

		it('should return an empty Func state when both states are empty', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('empty state 1');
			const state2: Func<Variable, SignLatticeElement> = new Func('empty state 2');
    
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.glb(state1, state2);
    
			const expected: Func<Variable, SignLatticeElement> = new Func('empty result');
			expect(result.isEqual(expected)).toBe(true);
		});
    
		it('should return an the non-empty state when one state is empty', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('non-empty state');
			state1.updateElements([varX], [SignLattice.GEQ0]);
    
			const state2: Func<Variable, SignLatticeElement> = new Func('empty state');
    
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.glb(state1, state2);
    
			const expected: Func<Variable, SignLatticeElement> = new Func('empty result');
			expected.updateElements([varX], [SignLattice.GEQ0]);
            
			expect(result.isEqual(expected)).toBe(true);
		});
    
		it('should compute the correct GLB for common variables with different values', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.ZERO]);
    
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varX], [SignLattice.GEQ0]);
    
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.glb(state1, state2);
    
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.ZERO]);
    
			expect(result.isEqual(expected)).toBe(true);
		});
    
		it('should return BOT for variables with no common ground', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.GEQ0]);
    
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varX], [SignLattice.LEQ0]);
    
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.glb(state1, state2);
    
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.ZERO]);
    
			expect(result.isEqual(expected)).toBe(true);
		});
    
		it('should correctly compute the GLB when variables have identical values', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.ZERO]);
    
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varX], [SignLattice.ZERO]);
    
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.glb(state1, state2);
    
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.ZERO]);
    
			expect(result.isEqual(expected)).toBe(true);
		});
    
		it('should correctly compute the GLB for multiple variables with mixed values', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX, varY], [SignLattice.ZERO, SignLattice.ZERO]);
    
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varY, varZ], [SignLattice.GEQ0, SignLattice.LEQ0]);
    
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.glb(state1, state2);
    
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX, varY, varZ], [SignLattice.ZERO, SignLattice.ZERO, SignLattice.LEQ0]);
    
			expect(result.isEqual(expected)).toBe(true);
		});
    
		it('should return ZERO for variables in one state but not the other', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.ZERO]);
    
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
    
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.glb(state1, state2);
    
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.ZERO]);
    
			expect(result.isEqual(expected)).toBe(true);
		});
    
		it('should correctly compute the GLB of two Func states', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state at pp 1');
			state1.updateElements([varX], [SignLattice.GEQ0]);
    
			const state2: Func<Variable, SignLatticeElement> = new Func('state at pp 2');
			state2.updateElements([varX, varY], [SignLattice.GEQ0, SignLattice.GEQ0]);
    
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.glb(state1, state2);
    
			const expected: Func<Variable, SignLatticeElement> = new Func('func');
			expected.updateElements([varX, varY], [SignLattice.GEQ0, SignLattice.GEQ0]);
    
			expect(result.isEqual(expected)).toBe(true);
		});
    
		it('should correctly compute the GLB when TOP is involved', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.TOP]);
    
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varX], [SignLattice.LEQ0]);
    
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.glb(state1, state2);
    
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.LEQ0]);
    
			expect(result.isEqual(expected)).toBe(true);
		});
    
		it('should return BOTTOM if one variable is BOTTOM in either state', () => {
			const state1: Func<Variable, SignLatticeElement> = new Func('state 1');
			state1.updateElements([varX], [SignLattice.BOTTOM]);
    
			const state2: Func<Variable, SignLatticeElement> = new Func('state 2');
			state2.updateElements([varX], [SignLattice.ZERO]);
    
			const result: Func<Variable, SignLatticeElement> = nonRelationValueAbstractState.glb(state1, state2);
    
			const expected: Func<Variable, SignLatticeElement> = new Func('expected state');
			expected.updateElements([varX], [SignLattice.BOTTOM]);
    
			expect(result.isEqual(expected)).toBe(true);
		});
	});
    
});
