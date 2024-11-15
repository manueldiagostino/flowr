import { describe, it, expect } from 'vitest';
import { SignLattice } from '../../../src/absInt/analysis/nonrelational/value/sign/sign-lattice';

describe('SignLattice Tests', () => {
	const lattice = new SignLattice();

	describe('Lattice elements', () => {
		it('should have the correct names', () => {
			expect(SignLattice.TOP.getName()).toBe('(TOP)');
			expect(SignLattice.BOTTOM.getName()).toBe('(BOTTOM)');
			expect(SignLattice.LEQ0.getName()).toBe('(<=0)');
			expect(SignLattice.GEQ0.getName()).toBe('(>=0)');
			expect(SignLattice.ZERO.getName()).toBe('(0)');
		});
	});

	describe('LUB (Least Upper Bound) operation', () => {
		it('should return TOP if one of the elements is TOP', () => {
			expect(lattice.lub(SignLattice.TOP, SignLattice.LEQ0)).toBe(SignLattice.TOP);
			expect(lattice.lub(SignLattice.GEQ0, SignLattice.TOP)).toBe(SignLattice.TOP);
		});

		it('should return the other element if one element is BOTTOM', () => {
			expect(lattice.lub(SignLattice.BOTTOM, SignLattice.LEQ0)).toBe(SignLattice.LEQ0);
			expect(lattice.lub(SignLattice.GEQ0, SignLattice.BOTTOM)).toBe(SignLattice.GEQ0);
		});

		it('should return TOP when lub is called with LEQ0 and GEQ0', () => {
			expect(lattice.lub(SignLattice.LEQ0, SignLattice.GEQ0)).toBe(SignLattice.TOP);
		});

		it('should return ZERO when lub is called with LEQ0 and GEQ0', () => {
			expect(lattice.lub(SignLattice.LEQ0, SignLattice.GEQ0)).toBe(SignLattice.TOP);
		});

		it('should return BOTTOM when lub is called with ZERO and GEQ0', () => {
			expect(lattice.lub(SignLattice.ZERO, SignLattice.GEQ0)).toBe(SignLattice.GEQ0);
		});

		it('should return BOTTOM when lub is called with ZERO and LEQ0', () => {
			expect(lattice.lub(SignLattice.ZERO, SignLattice.LEQ0)).toBe(SignLattice.LEQ0);
		});
	});

	describe('GLB (Greatest Lower Bound) operation', () => {
		it('should return BOTTOM if one of the elements is BOTTOM', () => {
			expect(lattice.glb(SignLattice.BOTTOM, SignLattice.LEQ0)).toBe(SignLattice.BOTTOM);
			expect(lattice.glb(SignLattice.GEQ0, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);
		});

		it('should return the other element if one element is TOP', () => {
			expect(lattice.glb(SignLattice.TOP, SignLattice.LEQ0)).toBe(SignLattice.LEQ0);
			expect(lattice.glb(SignLattice.GEQ0, SignLattice.TOP)).toBe(SignLattice.GEQ0);
		});

		it('should return ZERO when glb is called with LEQ0 and GEQ0', () => {
			expect(lattice.glb(SignLattice.LEQ0, SignLattice.GEQ0)).toBe(SignLattice.ZERO);
		});

		it('should return BOTTOM when glb is called with ZERO and GEQ0', () => {
			expect(lattice.glb(SignLattice.ZERO, SignLattice.GEQ0)).toBe(SignLattice.ZERO);
		});

		it('should return BOTTOM when glb is called with ZERO and LEQ0', () => {
			expect(lattice.glb(SignLattice.ZERO, SignLattice.LEQ0)).toBe(SignLattice.ZERO);
		});
	});

	describe('lessOrEqual operation', () => {
		it('should return true when lhs is BOTTOM or rhs is TOP', () => {
			expect(lattice.lessOrEqual(SignLattice.BOTTOM, SignLattice.LEQ0)).toBe(true);
			expect(lattice.lessOrEqual(SignLattice.LEQ0, SignLattice.TOP)).toBe(true);
		});

		it('should return false when lhs is TOP and rhs is not TOP', () => {
			expect(lattice.lessOrEqual(SignLattice.TOP, SignLattice.LEQ0)).toBe(false);
		});

		it('should return the correct result for LEQ0 and GEQ0 with ZERO', () => {
			expect(lattice.lessOrEqual(SignLattice.LEQ0, SignLattice.ZERO)).toBe(true);
			expect(lattice.lessOrEqual(SignLattice.ZERO, SignLattice.LEQ0)).toBe(false);
			expect(lattice.lessOrEqual(SignLattice.GEQ0, SignLattice.ZERO)).toBe(true);
			expect(lattice.lessOrEqual(SignLattice.ZERO, SignLattice.GEQ0)).toBe(false);
		});
	});

	describe('Top and Bottom checks', () => {
		it('should correctly identify TOP and BOTTOM elements', () => {
			expect(lattice.isTop(SignLattice.TOP)).toBe(true);
			expect(lattice.isBottom(SignLattice.BOTTOM)).toBe(true);
			expect(lattice.isTop(SignLattice.LEQ0)).toBe(false);
			expect(lattice.isBottom(SignLattice.LEQ0)).toBe(false);
		});

		it('should return the TOP and BOTTOM elements', () => {
			expect(lattice.top()).toBe(SignLattice.TOP);
			expect(lattice.bottom()).toBe(SignLattice.BOTTOM);
		});
	});
});
