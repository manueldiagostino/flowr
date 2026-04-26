import { test, describe } from 'vitest';
import { Bottom } from '../../../../src/abstract-interpretation/domains/lattice';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { VectorAttrEmpty } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { applyUpdatePositive } from '../../../../src/abstract-interpretation/vector/operations';
import { intervalFactory } from '../_helper/vector-interval-factory';
import { mkVector } from '../_helper/vector-creation-helpers';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import './log-config';
import { asNaAware, asNaAwares, assertVectorValueSound, type ExpectedVector, asNaAwareWithNA } from '../_helper/vector-assertion-helpers';

describe('Vector Update - applyUpdatePositive', () => {

	const naValue = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: true }, intervalFactory);

	test('Update single big position with single value', () => {
		const source = mkVector([3, 3], [[1, 1], [2, 2], [3, 3]]);
		const selector = mkVector([1, 1], [[2, 2]]);
		const values = mkVector([1, 1], [[100, 100]]);

		const result = applyUpdatePositive(source, selector, values, naValue);

		const expected: ExpectedVector<IntervalDomain> = {
			length:     [3, 3],
			known:      asNaAwares([1, 1], [100, 100], [3, 3]),
			summary:    asNaAware(Bottom),
			attributes: VectorAttrEmpty,
			type:       'double'
		};

		assertVectorValueSound('result', result, expected, IntervalDomain.top());
	});

	/**
	 * Case 3: Infinite selector with enumerable positions but non-enumerable summary
	 * The selector has infinite length (upper bound +∞) but all positions are singletons.
	 * However, the summary is not enumerable (range, not a singleton).
	 * Expected: length = [l_1, +∞], summary = squash(source) ⊔ squash(values)
	 */
	test('Infinite selector with enumerable positions and non-enumerable summary', () => {
		const source = mkVector([3, 3], [[1, 1], [2, 2], [3, 3]]);
		const selector = mkVector([1, Infinity], [[3, 5]], [5, 90]);
		const values = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]]);

		const result = applyUpdatePositive(source, selector, values, naValue);

		const expected: ExpectedVector<IntervalDomain> = {
			length:     [3, Infinity],
			known:      asNaAwares([1, 1], [2, 2], [3, 10], asNaAwareWithNA([10, 10]), asNaAwareWithNA([10, 30])),
			summary:    asNaAware([10, 30]),
			attributes: VectorAttrEmpty,
			type:       'double'
		};

		assertVectorValueSound('result', result, expected, IntervalDomain.top());
	});

	/**
	 * Case 4: Infinite selector with enumerable positions and enumerable summary
	 * The selector has infinite length but all positions AND summary are singletons.
	 * Result is finite since we can enumerate all positions.
	 * Expected: length based on squash of selector, summary = Bottom
	 */
	test('Infinite selector with enumerable positions and enumerable summary', () => {
		const source = mkVector([3, 5], [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
		const selector = mkVector([1, Infinity], [[1, 1], [5, 5]], [2, 3]);
		const values = mkVector([3, 3], [[0, 0], [0, 0], [30, 30]]);

		const result = applyUpdatePositive(source, selector, values, naValue);

		// Expected: finite length due to enumerable summary, summary = Bottom
		const expected: ExpectedVector<IntervalDomain> = {
			length:     [3, 5],
			known:      asNaAwares([0, 0], [0, 30], [0, 30], asNaAwareWithNA([4, 4]), [0, 0]),
			summary:    asNaAware(Bottom),
			attributes: VectorAttrEmpty,
			type:       'double'
		};

		assertVectorValueSound('result', result, expected, IntervalDomain.top());
	});
});
