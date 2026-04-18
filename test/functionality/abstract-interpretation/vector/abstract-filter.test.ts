import { assert, test, describe } from 'vitest';
import './log-config';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import type { AbstractFilterResult } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { intervalFactory } from '../_helper/na-aware-helpers';

/**
 * Helper: create an NAAwareDomain wrapping an IntervalDomain.
 */
function makeNAAware(range: [number, number], hasNA: boolean): NAAwareDomain<IntervalDomain> {
	return new NAAwareDomain({ inner: new IntervalDomain(range), hasNA }, intervalFactory);
}

/**
 * Helper: create a pure NA domain (inner=Bottom, hasNA=true).
 */
function makeNA(): NAAwareDomain<IntervalDomain> {
	return NAAwareDomain.na(intervalFactory);
}

/**
 * Helper: create a bottom domain.
 */
function makeBottom(): NAAwareDomain<IntervalDomain> {
	return NAAwareDomain.bottom(intervalFactory);
}

/**
 * Helper: create a top domain.
 */
function makeTop(): NAAwareDomain<IntervalDomain> {
	return NAAwareDomain.top(intervalFactory);
}

describe('abstractFilter', () => {
	describe('abstractFilter (full integration)', () => {

		test('Case 1: Pure positive [3, 7] → positive only', () => {
			const positions = [makeNAAware([3, 7], false)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.positive[0].toString(), '[3, 7]');
			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.positiveHasBottom, false);
			assert.strictEqual(result.negativeHasBottom, true);
		});

		test('Case 2: Pure negative [-5, -2] → negative only', () => {
			const positions = [makeNAAware([-5, -2], false)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.negative[0].toString(), '[-5, -2]');
			assert.strictEqual(result.negative[0].containsNA(), false);
			assert.strictEqual(result.positiveHasBottom, true);
			assert.strictEqual(result.negativeHasBottom, false);
		});

		test('Case 3: Zero [0, 0] hasNA=false → both positive/negative', () => {
			const positions = [makeNAAware([0, 0], false)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.positive[0].toString(), '[0, 0]');
			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.negative[0].toString(), '[0, 0]');
		});

		test('Case 4: Pure NA -> both positive/negative', () => {
			const positions = [makeNA()];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.negative.length, 1);
			assert.ok(result.positive[0].isNA(), 'should be pure NA');
		});

		test('Case 5: Positive with NA [2, 5] hasNA=true', () => {
			const positions = [makeNAAware([2, 5], true)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.positive[0].inner.toString(), '[2, 5]');
			assert.ok(result.positive[0].containsNA(), 'positive should contain NA');
		});

		test('Case 7: Ambiguous spanning zero [-3, 5] hasNA=false → split', () => {
			const positions = [makeNAAware([-3, 5], false)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.positive[0].toString(), '[0, 5]');
			assert.strictEqual(result.positive[0].containsNA(), false);

			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.negative[0].toString(), '[-3, 0]');
			assert.strictEqual(result.negative[0].containsNA(), false);
		});

		test('Case 8: Ambiguous with NA [-3, 5] hasNA=true → positive [0,5]+NA, negative [-3, 0]+NA', () => {
			const positions = [makeNAAware([-3, 5], true)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.ok(result.positive[0].containsNA(), 'positive should contain NA');

			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.negative[0].inner.toString(), '[-3, 0]');
			assert.strictEqual(result.negative[0].containsNA(), true);
		});

		test('Case 9: Bottom position → skipped, bottom flags set', () => {
			const positions = [makeBottom()];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 0);
			assert.strictEqual(result.negative.length, 0);
			assert.strictEqual(result.positiveHasBottom, true);
			assert.strictEqual(result.negativeHasBottom, true);
		});

		test('Case 10: Top position → split Z and -Z', () => {
			const positions = [makeTop()];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.positive[0].inner.toString(), '[0, +∞]');
			assert.strictEqual(result.negative[0].inner.toString(), '[-∞, 0]');
			assert.ok(result.positive[0].containsNA(), 'positive part should contain NA');
			assert.strictEqual(result.negative[0].containsNA(), true, 'negative part should contain NA');
		});

		test('All positions are positive → all go to positive array', () => {
			const positions = [
				makeNAAware([1, 1], false),
				makeNAAware([5, 10], false),
				makeNAAware([0, 0], false),
			];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 3);
			assert.strictEqual(result.negative.length, 3);
			assert.strictEqual(result.positive.toString(), '[1, 1],[5, 10],[0, 0]');
			assert.strictEqual(result.negativeHasBottom, true);
		});

		test('All positions are negative → all go to negative array', () => {
			const positions = [
				makeNAAware([-1, -1], false),
				makeNAAware([-10, -5], false),
			];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 2);
			assert.strictEqual(result.negative.length, 2);
			assert.strictEqual(result.positiveHasBottom, true);
		});

		test('Multiple ambiguous positions → all split correctly', () => {
			const positions = [
				makeNAAware([-3, 5], false),   // ambiguous: positive [0,5], negative [-3,0]
				makeNAAware([-2, -1], true),   // ambiguous: NA→positive, [-2,-1]→negative
			];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 2);
			assert.strictEqual(result.negative.length, 2);
		});
	});
});
