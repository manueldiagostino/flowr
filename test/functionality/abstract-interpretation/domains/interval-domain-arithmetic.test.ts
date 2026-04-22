import { describe, test, assert } from 'vitest';
import '../_helper/log-config';  // Enables LOG_LEVEL environment variable support
import { IntervalDomain, IntervalTop } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Bottom } from '../../../../src/abstract-interpretation/domains/lattice';

describe('IntervalDomain Arithmetic', () => {
	describe('multiply', () => {
		test('[2,3] * [4,5] = [8,15]', () => {
			const a = new IntervalDomain([2, 3]);
			const b = new IntervalDomain([4, 5]);
			const result = a.multiply(b.value);
			// 2*4=8, 2*5=10, 3*4=12, 3*5=15 → min=8, max=15
			assert.deepStrictEqual(result.value, [8, 15]);
		});

		test('[-2,3] * [4,5] = [-10,15] (negative lower bound)', () => {
			const a = new IntervalDomain([-2, 3]);
			const b = new IntervalDomain([4, 5]);
			const result = a.multiply(b.value);
			// -2*4=-8, -2*5=-10, 3*4=12, 3*5=15 → min=-10, max=15
			assert.deepStrictEqual(result.value, [-10, 15]);
		});

		test('[-3,-1] * [2,4] = [-12,-2] (both negative × positive)', () => {
			const a = new IntervalDomain([-3, -1]);
			const b = new IntervalDomain([2, 4]);
			const result = a.multiply(b.value);
			// -3*2=-6, -3*4=-12, -1*2=-2, -1*4=-4 → min=-12, max=-2
			assert.deepStrictEqual(result.value, [-12, -2]);
		});

		test('Bottom * anything = Bottom', () => {
			const a = IntervalDomain.bottom();
			const b = new IntervalDomain([1, 2]);
			assert.strictEqual(a.multiply(b.value).isBottom(), true);
		});

		test('Top * anything = Top', () => {
			const a = IntervalDomain.top();
			const b = new IntervalDomain([1, 2]);
			assert.strictEqual(a.multiply(b.value).isTop(), true);
		});

		test('[0,0] * [5,10] = [0,0] (zero interval)', () => {
			const a = new IntervalDomain([0, 0]);
			const b = new IntervalDomain([5, 10]);
			const result = a.multiply(b.value);
			assert.deepStrictEqual(result.value, [0, 0]);
		});
	});

	describe('divide', () => {
		test('[6,10] / [2,3] = [2,5]', () => {
			const a = new IntervalDomain([6, 10]);
			const b = new IntervalDomain([2, 3]);
			const result = a.divide(b.value);
			// 6/3=2, 6/2=3, 10/3≈3.33, 10/2=5 → min=2, max=5
			assert.deepStrictEqual(result.value, [2, 5]);
		});

		test('Division by interval containing zero → Top', () => {
			const a = new IntervalDomain([1, 2]);
			const b = new IntervalDomain([-1, 1]);
			const result = a.divide(b.value);
			assert.strictEqual(result.isTop(), true);
		});

		test('Division by interval with zero lower bound → Top', () => {
			const a = new IntervalDomain([1, 2]);
			const b = new IntervalDomain([0, 3]);
			const result = a.divide(b.value);
			assert.strictEqual(result.isTop(), true);
		});

		test('Bottom / anything = Bottom', () => {
			const a = IntervalDomain.bottom();
			const b = new IntervalDomain([1, 2]);
			assert.strictEqual(a.divide(b.value).isBottom(), true);
		});

		test('Top / anything = Top', () => {
			const a = IntervalDomain.top();
			const b = new IntervalDomain([1, 2]);
			assert.strictEqual(a.divide(b.value).isTop(), true);
		});

		test('[10,20] / [5,5] = [2,4] (singleton divisor)', () => {
			const a = new IntervalDomain([10, 20]);
			const b = new IntervalDomain([5, 5]);
			const result = a.divide(b.value);
			assert.deepStrictEqual(result.value, [2, 4]);
		});
	});
});
