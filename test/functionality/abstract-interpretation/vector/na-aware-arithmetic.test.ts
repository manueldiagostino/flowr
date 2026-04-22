import { describe, test, assert } from 'vitest';
import './log-config';  // Enables LOG_LEVEL environment variable support
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import {
	naAwareAdd,
	naAwareSubtract,
	naAwareMultiply,
	naAwareDivide,
	naAwareNegate
} from '../../../../src/abstract-interpretation/vector/na-aware-arithmetic';
import { intervalFactory } from '../_helper/vector-na-creation-helpers';

describe('NA-Aware Arithmetic', () => {
	describe('naAwareAdd', () => {
		test('Concrete intervals without NA', () => {
			const a = new NAAwareDomain({ inner: new IntervalDomain([1, 2]), hasNA: false }, intervalFactory);
			const b = new NAAwareDomain({ inner: new IntervalDomain([3, 4]), hasNA: false }, intervalFactory);
			const result = naAwareAdd(a, b);
			assert.deepStrictEqual(result.inner.value, [4, 6]);
			assert.strictEqual(result.containsNA(), false);
		});

		test('NA propagation: hasNA=true || hasNA=false → true', () => {
			const a = new NAAwareDomain({ inner: new IntervalDomain([1, 2]), hasNA: true }, intervalFactory);
			const b = new NAAwareDomain({ inner: new IntervalDomain([3, 4]), hasNA: false }, intervalFactory);
			const result = naAwareAdd(a, b);
			assert.strictEqual(result.containsNA(), true);
		});

		test('Bottom short-circuit', () => {
			const a = NAAwareDomain.bottom(intervalFactory);
			const b = new NAAwareDomain({ inner: new IntervalDomain([1, 2]), hasNA: false }, intervalFactory);
			const result = naAwareAdd(a, b);
			assert.strictEqual(result.isBottom(), true);
		});
	});

	describe('naAwareSubtract', () => {
		test('Concrete intervals without NA', () => {
			const a = new NAAwareDomain({ inner: new IntervalDomain([5, 10]), hasNA: false }, intervalFactory);
			const b = new NAAwareDomain({ inner: new IntervalDomain([2, 3]), hasNA: false }, intervalFactory);
			const result = naAwareSubtract(a, b);
			assert.deepStrictEqual(result.inner.value, [3, 7]);
			assert.strictEqual(result.containsNA(), false);
		});

		test('NA propagation', () => {
			const a = new NAAwareDomain({ inner: new IntervalDomain([5, 10]), hasNA: false }, intervalFactory);
			const b = new NAAwareDomain({ inner: new IntervalDomain([2, 3]), hasNA: true }, intervalFactory);
			const result = naAwareSubtract(a, b);
			assert.strictEqual(result.containsNA(), true);
		});
	});

	describe('naAwareMultiply', () => {
		test('Concrete intervals without NA', () => {
			const a = new NAAwareDomain({ inner: new IntervalDomain([2, 3]), hasNA: false }, intervalFactory);
			const b = new NAAwareDomain({ inner: new IntervalDomain([4, 5]), hasNA: false }, intervalFactory);
			const result = naAwareMultiply(a, b);
			assert.deepStrictEqual(result.inner.value, [8, 15]);
			assert.strictEqual(result.containsNA(), false);
		});

		test('Both operands have NA', () => {
			const a = new NAAwareDomain({ inner: new IntervalDomain([2, 3]), hasNA: true }, intervalFactory);
			const b = new NAAwareDomain({ inner: new IntervalDomain([4, 5]), hasNA: true }, intervalFactory);
			const result = naAwareMultiply(a, b);
			assert.strictEqual(result.containsNA(), true);
		});
	});

	describe('naAwareDivide', () => {
		test('Concrete intervals without NA', () => {
			const a = new NAAwareDomain({ inner: new IntervalDomain([10, 20]), hasNA: false }, intervalFactory);
			const b = new NAAwareDomain({ inner: new IntervalDomain([2, 5]), hasNA: false }, intervalFactory);
			const result = naAwareDivide(a, b);
			assert.deepStrictEqual(result.inner.value, [2, 10]);
			assert.strictEqual(result.containsNA(), false);
		});

		test('Division by zero-crossing interval → Top', () => {
			const a = new NAAwareDomain({ inner: new IntervalDomain([1, 2]), hasNA: false }, intervalFactory);
			const b = new NAAwareDomain({ inner: new IntervalDomain([-1, 1]), hasNA: false }, intervalFactory);
			const result = naAwareDivide(a, b);
			assert.strictEqual(result.inner.isTop(), true);
		});
	});

	describe('naAwareNegate', () => {
		test('Negates inner interval, preserves NA flag', () => {
			const a = new NAAwareDomain({ inner: new IntervalDomain([1, 3]), hasNA: true }, intervalFactory);
			const result = naAwareNegate(a);
			assert.deepStrictEqual(result.inner.value, [-3, -1]);
			assert.strictEqual(result.containsNA(), true);
		});

		test('Bottom → Bottom', () => {
			const a = NAAwareDomain.bottom(intervalFactory);
			const result = naAwareNegate(a);
			assert.strictEqual(result.isBottom(), true);
		});

		test('Preserves hasNA=false', () => {
			const a = new NAAwareDomain({ inner: new IntervalDomain([5, 10]), hasNA: false }, intervalFactory);
			const result = naAwareNegate(a);
			assert.deepStrictEqual(result.inner.value, [-10, -5]);
			assert.strictEqual(result.containsNA(), false);
		});
	});
});
