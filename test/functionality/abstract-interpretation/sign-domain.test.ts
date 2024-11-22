import { describe, it, expect } from 'vitest';
import { Sign } from '../../../src/abstract-interpretation/analysis/nonrelational/value/sign/sign-domain';
import { SignLattice } from '../../../src/abstract-interpretation/analysis/nonrelational/value/sign/sign-lattice';
import { EmptySet } from '../../../src/abstract-interpretation/analysis/utils';

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

	// describe('Narrowing operation', () => {
	// 	it('should throw an error when narrowing is called', () => {
	// 		expect(() => sign.narrowing(SignLattice.LEQ0, SignLattice.GEQ0)).toThrow(
	// 			'Sign::narrowing not yet implemented'
	// 		);
	// 	});
	// });

	describe('Concrete and abstract conversions', () => {
		it('should convert abstract to concrete correctly', () => {
			expect(sign.getConcrete(SignLattice.BOTTOM)).toBe(EmptySet.getInstance().toString());
			expect(sign.getConcrete(SignLattice.ZERO)).toBe('(0)');
			expect(sign.getConcrete(SignLattice.LEQ0)).toBe('(<=0)');
			expect(sign.getConcrete(SignLattice.GEQ0)).toBe('(>=0)');
		});

		it('should convert concrete to abstract correctly', () => {
			expect(sign.getAbstract('(0)')).toBe(SignLattice.ZERO);
			expect(sign.getAbstract('(<=0)')).toBe(SignLattice.LEQ0);
			expect(sign.getAbstract('(>=0)')).toBe(SignLattice.GEQ0);
			expect(sign.getAbstract('random')).toBe(SignLattice.TOP);
		});
	});

	describe('Binary operations', () => {
		it('should evaluate addition correctly for all cases', () => {
			expect(sign.evalAddOp(SignLattice.GEQ0, SignLattice.GEQ0)).toBe(SignLattice.GEQ0);
			expect(sign.evalAddOp(SignLattice.GEQ0, SignLattice.LEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalAddOp(SignLattice.GEQ0, SignLattice.ZERO)).toBe(SignLattice.GEQ0);
			expect(sign.evalAddOp(SignLattice.GEQ0, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalAddOp(SignLattice.GEQ0, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalAddOp(SignLattice.LEQ0, SignLattice.GEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalAddOp(SignLattice.LEQ0, SignLattice.LEQ0)).toBe(SignLattice.LEQ0);
			expect(sign.evalAddOp(SignLattice.LEQ0, SignLattice.ZERO)).toBe(SignLattice.LEQ0);
			expect(sign.evalAddOp(SignLattice.LEQ0, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalAddOp(SignLattice.LEQ0, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalAddOp(SignLattice.ZERO, SignLattice.GEQ0)).toBe(SignLattice.GEQ0);
			expect(sign.evalAddOp(SignLattice.ZERO, SignLattice.LEQ0)).toBe(SignLattice.LEQ0);
			expect(sign.evalAddOp(SignLattice.ZERO, SignLattice.ZERO)).toBe(SignLattice.ZERO);
			expect(sign.evalAddOp(SignLattice.ZERO, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalAddOp(SignLattice.ZERO, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalAddOp(SignLattice.TOP, SignLattice.GEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalAddOp(SignLattice.TOP, SignLattice.LEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalAddOp(SignLattice.TOP, SignLattice.ZERO)).toBe(SignLattice.TOP);
			expect(sign.evalAddOp(SignLattice.TOP, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalAddOp(SignLattice.TOP, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalAddOp(SignLattice.BOTTOM, SignLattice.GEQ0)).toBe(SignLattice.BOTTOM);
			expect(sign.evalAddOp(SignLattice.BOTTOM, SignLattice.LEQ0)).toBe(SignLattice.BOTTOM);
			expect(sign.evalAddOp(SignLattice.BOTTOM, SignLattice.ZERO)).toBe(SignLattice.BOTTOM);
			expect(sign.evalAddOp(SignLattice.BOTTOM, SignLattice.TOP)).toBe(SignLattice.BOTTOM);
			expect(sign.evalAddOp(SignLattice.BOTTOM, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);
		});


		it('should evaluate Diftraction correctly for all cases', () => {
			expect(sign.evalDifOp(SignLattice.GEQ0, SignLattice.GEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalDifOp(SignLattice.GEQ0, SignLattice.LEQ0)).toBe(SignLattice.GEQ0);
			expect(sign.evalDifOp(SignLattice.GEQ0, SignLattice.ZERO)).toBe(SignLattice.GEQ0);
			expect(sign.evalDifOp(SignLattice.GEQ0, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalDifOp(SignLattice.GEQ0, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalDifOp(SignLattice.LEQ0, SignLattice.GEQ0)).toBe(SignLattice.LEQ0);
			expect(sign.evalDifOp(SignLattice.LEQ0, SignLattice.LEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalDifOp(SignLattice.LEQ0, SignLattice.ZERO)).toBe(SignLattice.LEQ0);
			expect(sign.evalDifOp(SignLattice.LEQ0, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalDifOp(SignLattice.LEQ0, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalDifOp(SignLattice.ZERO, SignLattice.GEQ0)).toBe(SignLattice.LEQ0);
			expect(sign.evalDifOp(SignLattice.ZERO, SignLattice.LEQ0)).toBe(SignLattice.GEQ0);
			expect(sign.evalDifOp(SignLattice.ZERO, SignLattice.ZERO)).toBe(SignLattice.ZERO);
			expect(sign.evalDifOp(SignLattice.ZERO, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalDifOp(SignLattice.ZERO, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalDifOp(SignLattice.TOP, SignLattice.GEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalDifOp(SignLattice.TOP, SignLattice.LEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalDifOp(SignLattice.TOP, SignLattice.ZERO)).toBe(SignLattice.TOP);
			expect(sign.evalDifOp(SignLattice.TOP, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalDifOp(SignLattice.TOP, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalDifOp(SignLattice.BOTTOM, SignLattice.GEQ0)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDifOp(SignLattice.BOTTOM, SignLattice.LEQ0)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDifOp(SignLattice.BOTTOM, SignLattice.ZERO)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDifOp(SignLattice.BOTTOM, SignLattice.TOP)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDifOp(SignLattice.BOTTOM, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);
		});


		it('should evaluate multiplication correctly for all cases', () => {
			expect(sign.evalMulOp(SignLattice.GEQ0, SignLattice.GEQ0)).toBe(SignLattice.GEQ0);
			expect(sign.evalMulOp(SignLattice.GEQ0, SignLattice.LEQ0)).toBe(SignLattice.LEQ0);
			expect(sign.evalMulOp(SignLattice.GEQ0, SignLattice.ZERO)).toBe(SignLattice.ZERO);
			expect(sign.evalMulOp(SignLattice.GEQ0, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalMulOp(SignLattice.GEQ0, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalMulOp(SignLattice.LEQ0, SignLattice.GEQ0)).toBe(SignLattice.LEQ0);
			expect(sign.evalMulOp(SignLattice.LEQ0, SignLattice.LEQ0)).toBe(SignLattice.GEQ0);
			expect(sign.evalMulOp(SignLattice.LEQ0, SignLattice.ZERO)).toBe(SignLattice.ZERO);
			expect(sign.evalMulOp(SignLattice.LEQ0, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalMulOp(SignLattice.LEQ0, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalMulOp(SignLattice.ZERO, SignLattice.GEQ0)).toBe(SignLattice.ZERO);
			expect(sign.evalMulOp(SignLattice.ZERO, SignLattice.LEQ0)).toBe(SignLattice.ZERO);
			expect(sign.evalMulOp(SignLattice.ZERO, SignLattice.ZERO)).toBe(SignLattice.ZERO);
			expect(sign.evalMulOp(SignLattice.ZERO, SignLattice.TOP)).toBe(SignLattice.ZERO);
			expect(sign.evalMulOp(SignLattice.ZERO, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalMulOp(SignLattice.TOP, SignLattice.GEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalMulOp(SignLattice.TOP, SignLattice.LEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalMulOp(SignLattice.TOP, SignLattice.ZERO)).toBe(SignLattice.ZERO);
			expect(sign.evalMulOp(SignLattice.TOP, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalMulOp(SignLattice.TOP, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalMulOp(SignLattice.BOTTOM, SignLattice.GEQ0)).toBe(SignLattice.BOTTOM);
			expect(sign.evalMulOp(SignLattice.BOTTOM, SignLattice.LEQ0)).toBe(SignLattice.BOTTOM);
			expect(sign.evalMulOp(SignLattice.BOTTOM, SignLattice.ZERO)).toBe(SignLattice.BOTTOM);
			expect(sign.evalMulOp(SignLattice.BOTTOM, SignLattice.TOP)).toBe(SignLattice.BOTTOM);
			expect(sign.evalMulOp(SignLattice.BOTTOM, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);
		});

		it('should evaluate division correctly for all cases', () => {
			expect(sign.evalDivOp(SignLattice.GEQ0, SignLattice.GEQ0)).toBe(SignLattice.GEQ0);
			expect(sign.evalDivOp(SignLattice.GEQ0, SignLattice.LEQ0)).toBe(SignLattice.LEQ0);
			expect(sign.evalDivOp(SignLattice.GEQ0, SignLattice.ZERO)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDivOp(SignLattice.GEQ0, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalDivOp(SignLattice.GEQ0, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalDivOp(SignLattice.LEQ0, SignLattice.GEQ0)).toBe(SignLattice.LEQ0);
			expect(sign.evalDivOp(SignLattice.LEQ0, SignLattice.LEQ0)).toBe(SignLattice.GEQ0);
			expect(sign.evalDivOp(SignLattice.LEQ0, SignLattice.ZERO)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDivOp(SignLattice.LEQ0, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalDivOp(SignLattice.LEQ0, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalDivOp(SignLattice.ZERO, SignLattice.GEQ0)).toBe(SignLattice.ZERO);
			expect(sign.evalDivOp(SignLattice.ZERO, SignLattice.LEQ0)).toBe(SignLattice.ZERO);
			expect(sign.evalDivOp(SignLattice.ZERO, SignLattice.ZERO)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDivOp(SignLattice.ZERO, SignLattice.TOP)).toBe(SignLattice.ZERO);
			expect(sign.evalDivOp(SignLattice.ZERO, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalDivOp(SignLattice.TOP, SignLattice.GEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalDivOp(SignLattice.TOP, SignLattice.LEQ0)).toBe(SignLattice.TOP);
			expect(sign.evalDivOp(SignLattice.TOP, SignLattice.ZERO)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDivOp(SignLattice.TOP, SignLattice.TOP)).toBe(SignLattice.TOP);
			expect(sign.evalDivOp(SignLattice.TOP, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);

			expect(sign.evalDivOp(SignLattice.BOTTOM, SignLattice.GEQ0)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDivOp(SignLattice.BOTTOM, SignLattice.LEQ0)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDivOp(SignLattice.BOTTOM, SignLattice.ZERO)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDivOp(SignLattice.BOTTOM, SignLattice.TOP)).toBe(SignLattice.BOTTOM);
			expect(sign.evalDivOp(SignLattice.BOTTOM, SignLattice.BOTTOM)).toBe(SignLattice.BOTTOM);
		});

	});

	describe('Integration with lattice', () => {
		it('should correctly identify TOP and BOTTOM elements', () => {
			expect(lattice.isTop(sign.top)).toBe(true);
			expect(lattice.isBottom(sign.bottom)).toBe(true);
		});
	});
});
