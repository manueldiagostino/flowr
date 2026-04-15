import { assert, test, describe } from 'vitest';
import './log-config';
import { VectorDomain, classifyNAAwarePosition, splitNAAwarePosition } from '../../../../src/abstract-interpretation/vector/vector-domain';
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

	describe('classifyNAAwarePosition', () => {

		test('Case 1: Pure positive [3, 7] hasNA=false → positive', () => {
			const pos = makeNAAware([3, 7], false);
			assert.strictEqual(classifyNAAwarePosition(pos), 'positive');
		});

		test('Case 1b: Pure positive including zero [0, 5] hasNA=false → positive', () => {
			const pos = makeNAAware([0, 5], false);
			assert.strictEqual(classifyNAAwarePosition(pos), 'positive');
		});

		test('Case 2: Pure negative [-5, -2] hasNA=false → negative', () => {
			const pos = makeNAAware([-5, -2], false);
			assert.strictEqual(classifyNAAwarePosition(pos), 'negative');
		});

		test('Case 2b: Negative including zero [-3, 0] hasNA=false → negative', () => {
			const pos = makeNAAware([-3, 0], false);
			assert.strictEqual(classifyNAAwarePosition(pos), 'negative');
		});

		test('Case 3: Zero [0, 0] hasNA=false → positive', () => {
			const pos = makeNAAware([0, 0], false);
			assert.strictEqual(classifyNAAwarePosition(pos), 'positive');
		});

		test('Case 4: Pure NA (isNA) → positive', () => {
			const pos = makeNA();
			assert.strictEqual(classifyNAAwarePosition(pos), 'positive');
		});

		test('Case 5: Positive with NA [2, 5] hasNA=true → positive', () => {
			const pos = makeNAAware([2, 5], true);
			assert.strictEqual(classifyNAAwarePosition(pos), 'positive');
		});

		test('Case 5b: Zero with NA [0, 0] hasNA=true → positive', () => {
			const pos = makeNAAware([0, 0], true);
			assert.strictEqual(classifyNAAwarePosition(pos), 'positive');
		});

		test('Case 6: Negative with NA [-5, -2] hasNA=true → ambiguous', () => {
			// NA goes to positive, interval goes to negative → needs splitting
			const pos = makeNAAware([-5, -2], true);
			assert.strictEqual(classifyNAAwarePosition(pos), 'ambiguous');
		});

		test('Case 6b: Negative including zero with NA [-3, 0] hasNA=true → ambiguous', () => {
			const pos = makeNAAware([-3, 0], true);
			assert.strictEqual(classifyNAAwarePosition(pos), 'ambiguous');
		});

		test('Case 7: Ambiguous spanning zero [-3, 5] hasNA=false → ambiguous', () => {
			const pos = makeNAAware([-3, 5], false);
			assert.strictEqual(classifyNAAwarePosition(pos), 'ambiguous');
		});

		test('Case 8: Ambiguous with NA [-3, 5] hasNA=true → ambiguous', () => {
			const pos = makeNAAware([-3, 5], true);
			assert.strictEqual(classifyNAAwarePosition(pos), 'ambiguous');
		});

		test('Case 9: Bottom position → bottom', () => {
			const pos = makeBottom();
			assert.strictEqual(classifyNAAwarePosition(pos), 'bottom');
		});

		test('Case 10: Top position → ambiguous', () => {
			const pos = makeTop();
			assert.strictEqual(classifyNAAwarePosition(pos), 'ambiguous');
		});
	});

	describe('splitNAAwarePosition', () => {

		test('Case 6 split: Negative with NA [-5, -2] hasNA=true → NA to positive, [-5, -2] to negative', () => {
			const pos = makeNAAware([-5, -2], true);
			const result = splitNAAwarePosition(pos, intervalFactory);

			// Positive part: NA only
			assert.ok(result.positive !== null, 'positive should not be null');
			assert.ok(result.positive.isNA(), 'positive part should be pure NA');

			// Negative part: [-5, -2]
			assert.ok(result.negative !== null, 'negative should not be null');
			assert.strictEqual(result.negative.toString(), '[-5, -2]');
			assert.strictEqual(result.negative.containsNA(), false, 'negative should not contain NA');
		});

		test('Case 7 split: Ambiguous spanning zero [-3, 5] hasNA=false → [0, 5] positive, [-3, 0] negative', () => {
			const pos = makeNAAware([-3, 5], false);
			const result = splitNAAwarePosition(pos, intervalFactory);

			// Positive part: [0, 5]
			assert.ok(result.positive !== null, 'positive should not be null');
			assert.strictEqual(result.positive.toString(), '[0, 5]');
			assert.strictEqual(result.positive.containsNA(), false, 'positive should not contain NA');

			// Negative part: [-3, 0]
			assert.ok(result.negative !== null, 'negative should not be null');
			assert.strictEqual(result.negative.toString(), '[-3, 0]');
			assert.strictEqual(result.negative.containsNA(), false, 'negative should not contain NA');
		});

		test('Case 8 split: Ambiguous with NA [-3, 5] hasNA=true → positive [0,5]+NA, negative [-3, 0]', () => {
			const pos = makeNAAware([-3, 5], true);
			const result = splitNAAwarePosition(pos, intervalFactory);

			// Positive part: [0, 5] join NA
			assert.ok(result.positive !== null, 'positive should not be null');
			assert.ok(result.positive.containsNA(), 'positive should contain NA');
			// The positive interval should include [0, 5]
			assert.ok(result.positive.isValue(), 'positive should be a value');

			// Negative part: [-3, 0] without NA
			assert.ok(result.negative !== null, 'negative should not be null');
			assert.strictEqual(result.negative.toString(), '[-3, 0]');
			assert.strictEqual(result.negative.containsNA(), false, 'negative should not contain NA');
		});

		test('Case 10 split: Top → [0, +∞] with NA positive, [-∞, 0] without NA negative', () => {
			const pos = makeTop();
			const result = splitNAAwarePosition(pos, intervalFactory);

			// Positive part: [0, Infinity] with NA
			assert.ok(result.positive !== null, 'positive should not be null');
			assert.ok(result.positive.containsNA(), 'positive should contain NA');

			// Negative part: [-Infinity, 0] without NA
			assert.ok(result.negative !== null, 'negative should not be null');
			assert.strictEqual(result.negative.containsNA(), false, 'negative should not contain NA');
		});

		test('Split of pure NA → positive NA, negative null', () => {
			const pos = makeNA();
			const result = splitNAAwarePosition(pos, intervalFactory);

			assert.ok(result.positive !== null, 'positive should not be null');
			assert.ok(result.positive.isNA(), 'positive should be pure NA');
			assert.strictEqual(result.negative, null, 'negative should be null');
		});

		test('Split of bottom → both null', () => {
			const pos = makeBottom();
			const result = splitNAAwarePosition(pos, intervalFactory);

			assert.strictEqual(result.positive, null, 'positive should be null');
			assert.strictEqual(result.negative, null, 'negative should be null');
		});
	});

	describe('abstractFilter (full integration)', () => {

		test('Case 1: Pure positive [3, 7] → positive only', () => {
			const positions = [makeNAAware([3, 7], false)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.positive[0].toString(), '[3, 7]');
			assert.strictEqual(result.negative.length, 0);
			assert.strictEqual(result.positiveHasBottom, false);
			assert.strictEqual(result.negativeHasBottom, false);
		});

		test('Case 2: Pure negative [-5, -2] → negative only', () => {
			const positions = [makeNAAware([-5, -2], false)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 0);
			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.negative[0].toString(), '[-5, -2]');
			assert.strictEqual(result.negative[0].containsNA(), false);
			assert.strictEqual(result.positiveHasBottom, false);
			assert.strictEqual(result.negativeHasBottom, false);
		});

		test('Case 3: Zero [0, 0] hasNA=false → positive only', () => {
			const positions = [makeNAAware([0, 0], false)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.positive[0].toString(), '[0, 0]');
			assert.strictEqual(result.negative.length, 0);
		});

		test('Case 4: Pure NA → positive only', () => {
			const positions = [makeNA()];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.ok(result.positive[0].isNA(), 'should be pure NA');
			assert.strictEqual(result.negative.length, 0);
		});

		test('Case 5: Positive with NA [2, 5] hasNA=true → positive only', () => {
			const positions = [makeNAAware([2, 5], true)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.ok(result.positive[0].containsNA(), 'positive should contain NA');
			assert.strictEqual(result.negative.length, 0);
		});

		test('Case 6: Negative with NA [-5, -2] hasNA=true → split: NA to positive, [-5, -2] to negative', () => {
			const positions = [makeNAAware([-5, -2], true)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.ok(result.positive[0].isNA(), 'positive part should be pure NA');

			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.negative[0].toString(), '[-5, -2]');
			assert.strictEqual(result.negative[0].containsNA(), false, 'negative should not contain NA');
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

		test('Case 8: Ambiguous with NA [-3, 5] hasNA=true → positive [0,5]+NA, negative [-3, 0]', () => {
			const positions = [makeNAAware([-3, 5], true)];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.ok(result.positive[0].containsNA(), 'positive should contain NA');

			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.negative[0].toString(), '[-3, 0]');
			assert.strictEqual(result.negative[0].containsNA(), false);
		});

		test('Case 9: Bottom position → skipped, bottom flags set', () => {
			const positions = [makeBottom()];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 0);
			assert.strictEqual(result.negative.length, 0);
			assert.strictEqual(result.positiveHasBottom, true);
			assert.strictEqual(result.negativeHasBottom, true);
		});

		test('Case 10: Top position → treated as ambiguous (spans zero)', () => {
			const positions = [makeTop()];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			// Top splits into [0, +∞] with NA (positive) and [-∞, 0] without NA (negative)
			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.negative.length, 1);
			assert.ok(result.positive[0].containsNA(), 'positive part should contain NA');
			assert.strictEqual(result.negative[0].containsNA(), false, 'negative part should not contain NA');
		});

		test('Case 11: Mixed selector → multiple positions classified correctly', () => {
			const positions = [
				makeNAAware([3, 7], false),   // positive
				makeNAAware([-5, -2], false),  // negative
				makeNAAware([0, 0], false),    // zero → positive
				makeNA(),                      // pure NA → positive
			];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			// Positive: [3,7], [0,0], NA
			assert.strictEqual(result.positive.length, 3);
			assert.strictEqual(result.positive[0].toString(), '[3, 7]');
			assert.strictEqual(result.positive[1].toString(), '[0, 0]');
			assert.ok(result.positive[2].isNA());

			// Negative: [-5, -2]
			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.negative[0].toString(), '[-5, -2]');

			assert.strictEqual(result.positiveHasBottom, false);
			assert.strictEqual(result.negativeHasBottom, false);
		});

		test('Case 12: Bottom propagation → bottom flags correctly set with other positions', () => {
			const positions = [
				makeNAAware([3, 7], false),   // positive
				makeBottom(),                  // bottom → flags set
				makeNAAware([-3, -1], false), // negative
			];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 1);
			assert.strictEqual(result.positive[0].toString(), '[3, 7]');

			assert.strictEqual(result.negative.length, 1);
			assert.strictEqual(result.negative[0].toString(), '[-3, -1]');

			assert.strictEqual(result.positiveHasBottom, true);
			assert.strictEqual(result.negativeHasBottom, true);
		});

		test('Empty positions → empty result arrays, no bottom flags', () => {
			const result: AbstractFilterResult = VectorDomain.abstractFilter([], intervalFactory);

			assert.strictEqual(result.positive.length, 0);
			assert.strictEqual(result.negative.length, 0);
			assert.strictEqual(result.positiveHasBottom, false);
			assert.strictEqual(result.negativeHasBottom, false);
		});

		test('All positions are positive → all go to positive array', () => {
			const positions = [
				makeNAAware([1, 1], false),
				makeNAAware([5, 10], false),
				makeNAAware([0, 0], false),
			];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 3);
			assert.strictEqual(result.negative.length, 0);
		});

		test('All positions are negative → all go to negative array', () => {
			const positions = [
				makeNAAware([-1, -1], false),
				makeNAAware([-10, -5], false),
			];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			assert.strictEqual(result.positive.length, 0);
			assert.strictEqual(result.negative.length, 2);
		});

		test('Multiple ambiguous positions → all split correctly', () => {
			const positions = [
				makeNAAware([-3, 5], false),   // ambiguous: positive [0,5], negative [-3,0]
				makeNAAware([-2, -1], true),   // ambiguous: NA→positive, [-2,-1]→negative
			];
			const result: AbstractFilterResult = VectorDomain.abstractFilter(positions, intervalFactory);

			// First ambiguous gives 1 positive + 1 negative
			// Second ambiguous gives 1 positive (NA) + 1 negative
			assert.strictEqual(result.positive.length, 2);
			assert.strictEqual(result.negative.length, 2);
		});
	});
});