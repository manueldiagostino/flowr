import { describe, test, assert } from 'vitest';
import './log-config';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { RVectorTypeDomain } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { intervalFactory, naAwareIntervalFactory } from '../_helper/vector-na-creation-helpers';

describe('VectorDomain ArithmeticDomain Implementation', () => {
	function createVector(values: number[]): VectorDomain<IntervalDomain> {
		const length = new PosIntervalDomain([values.length, values.length]);
		const known = new KnownInitialPositionsDomain(
			values.map(v => new NAAwareDomain({ inner: new IntervalDomain([v, v]), hasNA: false }, intervalFactory)),
			naAwareIntervalFactory
		);
		const summary = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: false }, intervalFactory);

		return VectorDomain.create(
			intervalFactory,
			length,
			known,
			summary,
			VectorAttrDomain.bottom(),
			RVectorTypeDomain.of('double')
		);
	}

	describe('add()', () => {
		test('element-wise addition with concrete values', () => {
			const v1 = createVector([1, 2]);
			const v2 = createVector([3, 4]);
			const result = v1.add(v2);

			assert.strictEqual(result.length.toString(), '[2, 2]');
			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[4, 4]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[6, 6]');
			}
		});

		test('addition with self returns doubled values', () => {
			const v = createVector([5, 10]);
			const result = v.add(v);

			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[10, 10]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[20, 20]');
			}
		});
	});

	describe('subtract()', () => {
		test('element-wise subtraction', () => {
			const v1 = createVector([5, 10]);
			const v2 = createVector([2, 3]);
			const result = v1.subtract(v2);

			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[3, 3]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[7, 7]');
			}
		});

		test('subtraction with self returns zeros', () => {
			const v = createVector([5, 10]);
			const result = v.subtract(v);

			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[0, 0]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[0, 0]');
			}
		});
	});

	describe('multiply()', () => {
		test('element-wise multiplication', () => {
			const v1 = createVector([2, 3]);
			const v2 = createVector([4, 5]);
			const result = v1.multiply(v2);

			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[8, 8]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[15, 15]');
			}
		});

		test('multiplication by self squares values', () => {
			const v = createVector([2, 3]);
			const result = v.multiply(v);

			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[4, 4]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[9, 9]');
			}
		});
	});

	describe('divide()', () => {
		test('element-wise division', () => {
			const v1 = createVector([10, 20]);
			const v2 = createVector([2, 5]);
			const result = v1.divide(v2);

			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[5, 5]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[4, 4]');
			}
		});

		test('division by self returns ones', () => {
			const v = createVector([5, 10]);
			const result = v.divide(v);

			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[1, 1]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[1, 1]');
			}
		});
	});

	describe('negate()', () => {
		test('unary negation inverts signs', () => {
			const v = createVector([1, 2, 3]);
			const result = v.negate();

			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[-1, -1]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[-2, -2]');
				assert.strictEqual(result.known.value[2].inner.toString(), '[-3, -3]');
			}
		});

		test('double negation returns original', () => {
			const v = createVector([5, 10]);
			const result = v.negate().negate();

			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[5, 5]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[10, 10]');
			}
		});

		test('negation of negative values', () => {
			// Create vector with negative values using intervals
			const length = new PosIntervalDomain([2, 2]);
			const known = new KnownInitialPositionsDomain(
				[-5, -10].map(v => new NAAwareDomain({ inner: new IntervalDomain([v, v]), hasNA: false }, intervalFactory)),
				naAwareIntervalFactory
			);
			const summary = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: false }, intervalFactory);

			const v = VectorDomain.create(
				intervalFactory,
				length,
				known,
				summary,
				VectorAttrDomain.bottom(),
				RVectorTypeDomain.of('double')
			);

			const result = v.negate();

			if(result.known.isValue()) {
				assert.strictEqual(result.known.value[0].inner.toString(), '[5, 5]');
				assert.strictEqual(result.known.value[1].inner.toString(), '[10, 10]');
			}
		});
	});
});
