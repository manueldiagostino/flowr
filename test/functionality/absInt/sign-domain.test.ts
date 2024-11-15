import { describe, it, expect } from 'vitest';
import { Sign } from '../../../src/absInt/analysis/nonrelational/value/sign/sign-domain';
import { SignLattice } from '../../../src/absInt/analysis/nonrelational/value/sign/sign-lattice';

describe('Sign Tests', () => {
	const sign = new Sign();
	const lattice = sign.lattice;

	describe('Sign properties', () => {
		it('should have the correct name', () => {
			expect(sign.name).toBe('Sign');
		});

		it('should return the correct lattice', () => {
			expect(sign.lattice).toBeInstanceOf(SignLattice);
		});

		it('should return the correct top and bottom elements', () => {
			expect(sign.top).toBe(lattice.top());
			expect(sign.bottom).toBe(lattice.bottom());
		});
	});

	describe('Widening operation', () => {
		it('should return TOP if lhs or rhs is TOP', () => {
			const top = lattice.top();
			const leq0 = SignLattice.LEQ0;
			expect(sign.widening(top, leq0)).toBe(top);
			expect(sign.widening(leq0, top)).toBe(top);
		});

		it('should return lhs if lhs and rhs are equal', () => {
			const element = SignLattice.ZERO;
			expect(sign.widening(element, element)).toBe(element);
		});

		it('should return TOP when widening LEQ0 and GEQ0', () => {
			expect(sign.widening(SignLattice.LEQ0, SignLattice.GEQ0)).toBe(lattice.top());
		});
	});

	describe('Consistency with lattice operations', () => {
		it('should use lattice lub for widening in non-TOP cases', () => {
			const result = lattice.lub(SignLattice.LEQ0, SignLattice.ZERO);
			expect(sign.widening(SignLattice.LEQ0, SignLattice.ZERO)).toBe(result);
		});
	});

	describe('Integration with lattice', () => {
		it('should correctly identify TOP and BOTTOM elements', () => {
			expect(lattice.isTop(sign.top)).toBe(true);
			expect(lattice.isBottom(sign.bottom)).toBe(true);
		});
	});
});
