import { assert, describe, test } from 'vitest';
import { propagate, adjustForZeros, rhoC, rhoF } from '../../../../src/abstract-interpretation/vector/vector-semantics';
import type { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Bottom } from '../../../../src/abstract-interpretation/domains/lattice';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { intervalFactory } from '../_helper/vector-interval-factory';
import { asNaAware, asNaAwares, NaInterval, asNaAwareWithNA, toNAAwareDomain, toNAAwareDomains, type AbstractNaValue } from '../_helper/vector-assertion-helpers';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { RVectorTypeDomain } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import { createTestKnown } from '../_helper/vector-creation-helpers';
import './log-config';

/** Asserts that a NAAwareDomain<IntervalDomain> equals the expected AbstractNaValue<IntervalDomain>. */
function assertNAAwareEquals(
	actual: NAAwareDomain<IntervalDomain>,
	expected: AbstractNaValue<IntervalDomain>,
	message?: string
): void {
	const expectedDomain = toNAAwareDomain(expected);
	assert.ok(actual.equals(expectedDomain), message ?? `Expected ${expectedDomain.toString()} but got ${actual.toString()}`);
}

/**
 * Helper to create a test VectorDomain<IntervalDomain> with specified length,
 * known position ranges, and optional summary range.
 *
 * IMPORTANT: Per vector domain invariant, summary must be:
 * - Bottom (⊥) for finite vectors (upper bound !== +Infinity)
 * - Valorized for infinite vectors (upper bound === +Infinity)
 */
function createTestVector(
	length: [number, number],
	positionRanges: Array<[number, number]>,
	summaryRange?: [number, number]
): VectorDomain<IntervalDomain> {
	const positions = toNAAwareDomains(positionRanges.map(r => asNaAware(r)));
	const smartFactory = NAAwareDomain.createSmartFactory(intervalFactory);
	const knownPositions = new KnownInitialPositionsDomain(positions, smartFactory);

	// Per vector domain invariant:
	// - Finite vectors (upper !== +Infinity): summary must be bottom
	// - Infinite vectors (upper === +Infinity): summary must be valorized
	const isInfinite = length[1] === +Infinity;
	const summary = isInfinite
		? toNAAwareDomain(asNaAware(summaryRange ?? [0, 100]))
		: toNAAwareDomain(asNaAware(Bottom));

	return VectorDomain.create(
		intervalFactory,
		new PosIntervalDomain(length),
		knownPositions,
		summary,
		VectorAttrDomain.bottom(),
		RVectorTypeDomain.of('integer')
	);
}

describe('propagate', () => {
	test('propagate with empty positions returns summary', () => {
		const summary = toNAAwareDomain(asNaAware([10, 10]));
		const result = propagate([], summary, 0);
		assertNAAwareEquals(result, asNaAware([10, 10]));
	});

	test('propagate with definite zero increments counter and skips', () => {
		const positions = toNAAwareDomains(asNaAwares([0, 0], [5, 5]));
		const summary = toNAAwareDomain(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		// First is zero (skipped), k becomes 1
		// propagate([5,5], summary, 1): first [5,5] non-zero, k=1 ≤ 1 → return [5,5]
		// Result: [5,5]
		assertNAAwareEquals(result, asNaAware([5, 5]));
	});

	test('propagate with possible zero joins first with propagated rest', () => {
		const positions = toNAAwareDomains(asNaAwares([-1, 1], [5, 5]));
		const summary = toNAAwareDomain(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		// [-1,1] contains 0 but not exactly {0}
		// Result: [-1,1] ⊔ propagate([5,5], [10,10], 0)
		// propagate([5,5], [10,10], 0): k=0, first [5,5] non-zero → returns [5,5]
		// Result: [-1,1] ⊔ [5,5] = [-1, 5]
		assertNAAwareEquals(result, asNaAware([-1, 5]));
	});

	test('propagate with possible zero joins first with propagated rest (NA version)', () => {
		const positions = toNAAwareDomains([...asNaAwares([-1, 1]), asNaAwareWithNA([5, 5])]);
		const summary = toNAAwareDomain(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		// [-1,1] contains 0 but not exactly {0}
		// Result: [-1,1] ⊔ propagate([5,5], [10,10], 0)
		// propagate([5,5], [10,10], 0): k=0, first [5,5] non-zero → returns [5,5]
		// Result: [-1,1] ⊔ [5,5] = [-1, 5]
		assertNAAwareEquals(result, asNaAwareWithNA([-1, 5]));
	});

	test('pure NA considered as non-zero value', () => {
		const positions = toNAAwareDomains(asNaAwares(NaInterval, [5, 7]));
		const summary = toNAAwareDomain(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		// [-1,1] contains 0 but not exactly {0}
		// Result: [-1,1] ⊔ propagate([5,5], [10,10], 0)
		// propagate([5,5], [10,10], 0): k=0, first [5,5] non-zero → returns [5,5]
		// Result: [-1,1] ⊔ [5,5] = [-1, 5]
		assertNAAwareEquals(result, NaInterval);
	});

	test('propagate non-zero with k>1 joins first with propagated rest (paper L411)', () => {
		const positions = toNAAwareDomains(asNaAwares([3, 3], [5, 5]));
		const summary = toNAAwareDomain(asNaAware([10, 10]));
		// k=2: first [3,3] non-zero, k=2>1 → [3,3] ⊔ propagate([5,5], summary, 1)
		// propagate([5,5], summary, 1): first [5,5] non-zero, k=1 ≤ 1 → return [5,5]
		// Result: [3,3] ⊔ [5,5] = [3, 5]
		const result = propagate(positions, summary, 2);
		assertNAAwareEquals(result, asNaAware([3, 5]));
	});

	test('propagate non-zero with k=0 returns first value unchanged (paper L414)', () => {
		const positions = toNAAwareDomains(asNaAwares([3, 3], [5, 5]));
		const summary = toNAAwareDomain(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		assertNAAwareEquals(result, asNaAware([3, 3]));
	});

	test('propagate possible zero with k>0 joins first with propagated rest', () => {
		const positions = toNAAwareDomains(asNaAwares([0, 2], [5, 5]));
		const summary = toNAAwareDomain(asNaAware([10, 10]));
		const result = propagate(positions, summary, 1);
		// [0,2] may contain zero, so: [0,2] ⊔ propagate([5,5], [10,10], 1)
		// propagate([5,5], [10,10], 1): [5,5] non-zero, k=1 ≤ 1 → return [5,5]
		// Final: [0,2] ⊔ [5,5] = [0, 5]
		assertNAAwareEquals(result, asNaAware([0, 5]));
	});

	test('propagate with bottom position returns bottom', () => {
		const positions = [toNAAwareDomain(NaInterval)];
		const summary = toNAAwareDomain(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		assertNAAwareEquals(result, NaInterval);
	});
});

describe('adjustForZeros', () => {
	test('returns bottom vector unchanged', () => {
		const vector = VectorDomain.bottom(intervalFactory);
		const result = adjustForZeros(vector);
		assert.ok(result.isBottom());
	});

	test('returns top vector unchanged', () => {
		const vector = VectorDomain.top(intervalFactory);
		const result = adjustForZeros(vector);
		assert.ok(result.isTop());
	});

	test('vector with no zeros returns unchanged length', () => {
		// Vector: [1, 2, 3] with length [3, 3]
		const vector = createTestVector([3, 3], [[1, 1], [2, 2], [3, 3]]);
		const result = adjustForZeros(vector);

		assert.ok(result.length.isValue());
		if(result.length.isValue()) {
			assert.deepStrictEqual(result.length.value, [3, 3]);
		}
	});

	test('vector with definite zeros reduces upper bound', () => {
		// Vector: [0, 0, 1, 2] with length [4, 4]
		const vector = createTestVector([4, 4], [[0, 0], [0, 0], [1, 1], [2, 2]]);
		const result = adjustForZeros(vector);

		// Two definite zeros (also possible zeros), so: l' = 4 - 2 = 2, u' = 4 - 2 = 2
		assert.ok(result.length.isValue());
		if(result.length.isValue()) {
			assert.deepStrictEqual(result.length.value, [2, 2]);
		}
	});

	test('vector with possible zeros reduces lower bound', () => {
		// Vector: [-1, 1] may contain zero (interval [-1, 1] contains 0)
		const vector = createTestVector([2, 2], [[-1, 1]]);
		const result = adjustForZeros(vector);

		// One possible zero (not definite), so: l' = 2 - 1 = 1, u' = 2 - 0 = 2
		assert.ok(result.length.isValue());
		if(result.length.isValue()) {
			assert.deepStrictEqual(result.length.value, [1, 2]);
		}
	});

	test('vector with mix of definite and possible zeros', () => {
		// Vector: [0, -1, 1, 2] with length [4, 4]
		// Position 0: definite zero [0,0]
		// Position 1: possible zero [-1,1]
		// Position 2: non-zero [2,2]
		const vector = createTestVector([4, 4], [[0, 0], [-1, 1], [2, 2]]);
		const result = adjustForZeros(vector);

		// 1 definite zero, 2 possible zeros (one definite + one possible)
		// l' = 4 - 2 = 2, u' = 4 - 1 = 3
		assert.ok(result.length.isValue());
		if(result.length.isValue()) {
			assert.deepStrictEqual(result.length.value, [2, 3]);
		}
	});

	test('single zero becomes empty selector', () => {
		// Vector: c(0) with length [1, 1]
		const vector = createTestVector([1, 1], [[0, 0]]);
		const result = adjustForZeros(vector);

		// One definite zero: l' = 1 - 1 = 0, u' = 1 - 1 = 0
		assert.ok(result.length.isValue());
		if(result.length.isValue()) {
			assert.deepStrictEqual(result.length.value, [0, 0]);
		}
	});

	test('propagates values past zeros', () => {
		// Vector: [0, 5, 10] with length [3, 3] (finite, so summary is bottom)
		// After adjustment: position 0 skips zero, position 1 becomes first
		// definiteZeros=1, possibleZeros=1 → new length [2, 2]
		const vector = createTestVector([3, 3], [[0, 0], [5, 5], [10, 10]]);
		const result = adjustForZeros(vector);

		// Check length was adjusted
		assert.ok(result.length.isValue());
		if(result.length.isValue()) {
			assert.deepStrictEqual(result.length.value, [2, 2]);
		}

		// Check that known positions are rebuilt via propagate (truncated to length upper bound = 2)
		assert.ok(result.known.isValue());
		if(result.known.isValue()) {
			const knownValues = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
			assert.strictEqual(knownValues.length, 2);

			// Position 0: propagate([0,0,5,5,10,10], bottom, 0)
			//   → [0,0] is definite zero, k becomes 1
			//   → propagate([5,5,10,10], bottom, 1): [5,5] non-zero, k=1 ≤ 1 → return [5,5]
			assertNAAwareEquals(knownValues[0], asNaAware([5, 5]));

			// Position 1: zerosBefore=1 (position 0 is zero), propagate([5,5,10,10], bottom, 1)
			//   → [5,5] non-zero, k=1 ≤ 1 → return [5,5]
			assertNAAwareEquals(knownValues[1], asNaAware([5, 5]));
		}
	});

	test('handles NA values correctly', () => {
		// Vector with NA: NA should not be treated as zero
		// Using asNaAwareWithNA to create a value that has NA flag set
		// Per invariant: finite vector [2,2] must have bottom summary
		const naValue = asNaAwareWithNA([1, 1]);  // hasNA: true, inner: [1,1]
		const positions = toNAAwareDomains([naValue, asNaAware([2, 2])]);
		const summary = toNAAwareDomain(asNaAware(Bottom));
		const smartFactory = NAAwareDomain.createSmartFactory(intervalFactory);
		const knownPositions = new KnownInitialPositionsDomain(positions, smartFactory);

		const vector = VectorDomain.create(
			intervalFactory,
			new PosIntervalDomain([2, 2]),
			knownPositions,
			summary,
			VectorAttrDomain.bottom(),
			RVectorTypeDomain.of('integer')
		);
		const result = adjustForZeros(vector);

		// NA is not zero, so length should remain [2, 2]
		assert.ok(result.length.isValue());
		if(result.length.isValue()) {
			assert.deepStrictEqual(result.length.value, [2, 2]);
		}
	});

	test('empty known positions', () => {
		// Vector with top known positions (empty array) and length [0, 0]
		// Per invariant: finite vector [0,0] must have bottom summary
		const smartFactory = NAAwareDomain.createSmartFactory(intervalFactory);
		const emptyKnown = KnownInitialPositionsDomain.top<NAAwareDomain<IntervalDomain>>(smartFactory);
		const summary = toNAAwareDomain(asNaAware(Bottom));

		const vector = VectorDomain.create(
			intervalFactory,
			new PosIntervalDomain([0, 0]),
			emptyKnown,
			summary,
			VectorAttrDomain.bottom(),
			RVectorTypeDomain.of('integer')
		);
		const result = adjustForZeros(vector);

		// No known positions to count zeros from, length stays [0, 0]
		assert.ok(result.length.isValue());
		if(result.length.isValue()) {
			assert.deepStrictEqual(result.length.value, [0, 0]);
		}
	});

	test('preserves attributes and type', () => {
		// Vector with definite zeros should preserve attributes and type
		// Per invariant: finite vector [2,2] must have bottom summary
		const smartFactory = NAAwareDomain.createSmartFactory(intervalFactory);
		const knownPositions = new KnownInitialPositionsDomain(
			toNAAwareDomains([asNaAware([0, 0]), asNaAware([1, 1])]),
			smartFactory
		);
		const summary = toNAAwareDomain(asNaAware(Bottom));
		const attrs = VectorAttrDomain.empty();

		const vector = VectorDomain.create(
			intervalFactory,
			new PosIntervalDomain([2, 2]),
			knownPositions,
			summary,
			attrs,
			RVectorTypeDomain.of('double')
		);
		const result = adjustForZeros(vector);

		// Attributes and type should be preserved
		assert.ok(result.attributes.equals(attrs));
		assert.ok(result.type.isValue());
		if(result.type.isValue()) {
			assert.strictEqual(result.type.value, 'double');
		}
	});
});

describe('rhoC', () => {
	test('returns top when known is bottom', () => {
		const known = KnownInitialPositionsDomain.bottom<NAAwareDomain<IntervalDomain>>(
			NAAwareDomain.createSmartFactory(intervalFactory)
		);
		const result = rhoC(known, 2, 4, NAAwareDomain.createSmartFactory(intervalFactory));
		assert.ok(result.isTop());
	});

	test('returns top when known is top', () => {
		const known = KnownInitialPositionsDomain.top<NAAwareDomain<IntervalDomain>>(
			NAAwareDomain.createSmartFactory(intervalFactory)
		);
		const result = rhoC(known, 2, 4, NAAwareDomain.createSmartFactory(intervalFactory));
		assert.ok(result.isTop());
	});

	test('returns top when h=0', () => {
		const known = createTestKnown([[1, 1], [2, 2], [3, 3]]);
		const result = rhoC(known, 2, 0, NAAwareDomain.createSmartFactory(intervalFactory));
		assert.ok(result.isTop());
	});

	test('cycles elements to reach target length (exact multiple)', () => {
		// known = [1, 2, 3], i=2, h=4
		// i' = min(2, 3) = 2
		// fullRepeats = floor(4/2) = 2, remainder = 0
		// result = [1,2] ++ [1,2] = [1,2,1,2]
		const known = createTestKnown([[1, 1], [2, 2], [3, 3]]);
		const result = rhoC(known, 2, 4, NAAwareDomain.createSmartFactory(intervalFactory));

		assert.ok(result.isValue());
		if(result.isValue()) {
			assert.strictEqual(result.length, 4);
			const values = result.value;
			assert.strictEqual(values.length, 4);
			assertNAAwareEquals(values[0], asNaAware([1, 1]));
			assertNAAwareEquals(values[1], asNaAware([2, 2]));
			assertNAAwareEquals(values[2], asNaAware([1, 1]));
			assertNAAwareEquals(values[3], asNaAware([2, 2]));
		}
	});

	test('cycles elements with remainder', () => {
		// known = [1, 2, 3], i=2, h=5
		// i' = min(2, 3) = 2
		// fullRepeats = floor(5/2) = 2, remainder = 1
		// result = [1,2] ++ [1,2] ++ [1] = [1,2,1,2,1]
		const known = createTestKnown([[1, 1], [2, 2], [3, 3]]);
		const result = rhoC(known, 2, 5, NAAwareDomain.createSmartFactory(intervalFactory));

		assert.ok(result.isValue());
		if(result.isValue()) {
			assert.strictEqual(result.length, 5);
			const values = result.value;
			assert.strictEqual(values.length, 5);
			assertNAAwareEquals(values[0], asNaAware([1, 1]));
			assertNAAwareEquals(values[1], asNaAware([2, 2]));
			assertNAAwareEquals(values[2], asNaAware([1, 1]));
			assertNAAwareEquals(values[3], asNaAware([2, 2]));
			assertNAAwareEquals(values[4], asNaAware([1, 1]));
		}
	});

	test('cycles all elements when i > known length', () => {
		// known = [1, 2, 3], i=5, h=7
		// i' = min(5, 3) = 3 (use all known elements)
		// fullRepeats = floor(7/3) = 2, remainder = 1
		// result = [1,2,3] ++ [1,2,3] ++ [1] = [1,2,3,1,2,3,1]
		const known = createTestKnown([[1, 1], [2, 2], [3, 3]]);
		const result = rhoC(known, 5, 7, NAAwareDomain.createSmartFactory(intervalFactory));

		assert.ok(result.isValue());
		if(result.isValue()) {
			assert.strictEqual(result.length, 7);
			const values = result.value;
			assert.strictEqual(values.length, 7);
			assertNAAwareEquals(values[0], asNaAware([1, 1]));
			assertNAAwareEquals(values[1], asNaAware([2, 2]));
			assertNAAwareEquals(values[2], asNaAware([3, 3]));
			assertNAAwareEquals(values[3], asNaAware([1, 1]));
			assertNAAwareEquals(values[4], asNaAware([2, 2]));
			assertNAAwareEquals(values[5], asNaAware([3, 3]));
			assertNAAwareEquals(values[6], asNaAware([1, 1]));
		}
	});

	test('single element repeated', () => {
		// known = [1], i=1, h=5
		// i' = min(1, 1) = 1
		// fullRepeats = floor(5/1) = 5, remainder = 0
		// result = [1,1,1,1,1]
		const known = createTestKnown([[1, 1]]);
		const result = rhoC(known, 1, 5, NAAwareDomain.createSmartFactory(intervalFactory));

		assert.ok(result.isValue());
		if(result.isValue()) {
			assert.strictEqual(result.length, 5);
			const values = result.value;
			assert.strictEqual(values.length, 5);
			for(let j = 0; j < 5; j++) {
				assertNAAwareEquals(values[j], asNaAware([1, 1]));
			}
		}
	});

	test('returns top when iPrime=0', () => {
		// known = [1, 2, 3], i=0, h=4
		// i' = min(0, 3) = 0 → returns top
		const known = createTestKnown([[1, 1], [2, 2], [3, 3]]);
		const result = rhoC(known, 0, 4, NAAwareDomain.createSmartFactory(intervalFactory));
		assert.ok(result.isTop());
	});

	test('preserves NAAwareDomain wrappers', () => {
		// known with NA values: [1, NA, 3], i=2, h=4
		// i' = min(2, 3) = 2
		// result = [1, NA] ++ [1, NA] = [1, NA, 1, NA]
		const naValue = asNaAwareWithNA([2, 2]);  // hasNA: true, inner: [2,2]
		const known = createTestKnown(toNAAwareDomains([asNaAware([1, 1]), naValue, asNaAware([3, 3])]));
		const smartFactory = NAAwareDomain.createSmartFactory(intervalFactory);

		const result = rhoC(known, 2, 4, smartFactory);

		assert.ok(result.isValue());
		if(result.isValue()) {
			assert.strictEqual(result.length, 4);
			const values = result.value;
			assert.strictEqual(values.length, 4);
			// First element: [1,1] without NA
			assertNAAwareEquals(values[0], asNaAware([1, 1]));
			// Second element: [2,2] with NA flag preserved
			assertNAAwareEquals(values[1], asNaAwareWithNA([2, 2]));
			// Third element: recycled [1,1] without NA
			assertNAAwareEquals(values[2], asNaAware([1, 1]));
			// Fourth element: recycled [2,2] with NA flag preserved
			assertNAAwareEquals(values[3], asNaAwareWithNA([2, 2]));
		}
	});
});

describe('rhoF', () => {
	test('returns bottom when known is bottom', () => {
		const known = KnownInitialPositionsDomain.bottom<NAAwareDomain<IntervalDomain>>(
			NAAwareDomain.createSmartFactory(intervalFactory)
		);
		const result = rhoF(known, 1, 3, NAAwareDomain.createSmartFactory(intervalFactory));
		assert.ok(result.isBottom());
	});

	test('returns bottom when known is top', () => {
		const known = KnownInitialPositionsDomain.top<NAAwareDomain<IntervalDomain>>(
			NAAwareDomain.createSmartFactory(intervalFactory)
		);
		const result = rhoF(known, 1, 3, NAAwareDomain.createSmartFactory(intervalFactory));
		assert.ok(result.isBottom());
	});

	test('returns bottom when n=0', () => {
		const known = createTestKnown([[1, 1], [2, 2], [3, 3]]);
		const result = rhoF(known, 1, 0, NAAwareDomain.createSmartFactory(intervalFactory));
		assert.ok(result.isBottom());
	});

	test('single starting position equals rhoC', () => {
		// known = [1, 2, 3], l=2, n=2
		// rhoF should equal rhoC(known, 2, 2) since only i=2 is in range [2,2]
		const known = createTestKnown([[1, 1], [2, 2], [3, 3]]);
		const smartFactory = NAAwareDomain.createSmartFactory(intervalFactory);

		const rhoFResult = rhoF(known, 2, 2, smartFactory);
		const rhoCResult = rhoC(known, 2, 2, smartFactory);

		assert.ok(rhoFResult.equals(rhoCResult));
	});

	test('joins multiple rhoC results', () => {
		// known = [1, 2], l=1, n=2
		// rhoF = rhoC(i=1) ⊔ rhoC(i=2)
		// rhoC(i=1, h=2): i'=min(1,2)=1, fullRepeats=2, result=[1,1]
		// rhoC(i=2, h=2): i'=min(2,2)=2, fullRepeats=1, result=[1,2]
		// Join: [1,1] ⊔ [1,2] = [1, join(1,2)] = [1, [1,2]]
		const known = createTestKnown([[1, 1], [2, 2]]);
		const smartFactory = NAAwareDomain.createSmartFactory(intervalFactory);

		const result = rhoF(known, 1, 2, smartFactory);

		assert.ok(result.isValue());
		if(result.isValue()) {
			assert.strictEqual(result.length, 2);
			const values = result.value;
			// Position 0: 1 ⊔ 1 = 1
			assertNAAwareEquals(values[0], asNaAware([1, 1]));
			// Position 1: 1 ⊔ 2 = [1, 2]
			assertNAAwareEquals(values[1], asNaAware([1, 2]));
		}
	});

	test('larger range produces wider join', () => {
		// known = [1, 2, 3], l=1, n=3
		// rhoF joins rhoC(i=1), rhoC(i=2), rhoC(i=3) all with h=3
		// rhoC(i=1, h=3): i'=1, fullRepeats=3, result=[1,1,1]
		// rhoC(i=2, h=3): i'=2, fullRepeats=1, rem=1, result=[1,2,1]
		// rhoC(i=3, h=3): i'=3, fullRepeats=1, rem=0, result=[1,2,3]
		// Join: [1,1,1] ⊔ [1,2,1] ⊔ [1,2,3] = [1, [1,2], [1,3]]
		const known = createTestKnown([[1, 1], [2, 2], [3, 3]]);
		const smartFactory = NAAwareDomain.createSmartFactory(intervalFactory);

		const result = rhoF(known, 1, 3, smartFactory);

		assert.ok(result.isValue());
		if(result.isValue()) {
			assert.strictEqual(result.length, 3);
			const values = result.value;
			// Position 0: 1 ⊔ 1 ⊔ 1 = 1
			assertNAAwareEquals(values[0], asNaAware([1, 1]));
			// Position 1: 1 ⊔ 2 ⊔ 2 = [1, 2]
			assertNAAwareEquals(values[1], asNaAware([1, 2]));
			// Position 2: 1 ⊔ 1 ⊔ 3 = [1, 3]
			assertNAAwareEquals(values[2], asNaAware([1, 3]));
		}
	});

	test('preserves NAAwareDomain properties through join', () => {
		// known with NA: [1, NA], l=1, n=2
		// rhoC(i=1, h=2): i'=min(1,2)=1, fullRepeats=2 → [1, 1]
		// rhoC(i=2, h=2): i'=min(2,2)=2, fullRepeats=1 → [1, NA]
		// Join: [1, 1] ⊔ [1, NA] = [[1,1], [1,2]+NA]
		const naValue = asNaAwareWithNA([2, 2]);  // hasNA: true, inner: [2,2]
		const known = createTestKnown(toNAAwareDomains([asNaAware([1, 1]), naValue]));
		const smartFactory = NAAwareDomain.createSmartFactory(intervalFactory);

		const result = rhoF(known, 1, 2, smartFactory);

		assert.ok(result.isValue());
		if(result.isValue()) {
			assert.strictEqual(result.length, 2);
			const values = result.value;
			// Position 0: [1,1] ⊔ [1,1] = [1,1] (no NA)
			assertNAAwareEquals(values[0], asNaAware([1, 1]));
			// Position 1: [1,1] ⊔ [2,2]+NA = [1,2]+NA
			assertNAAwareEquals(values[1], asNaAwareWithNA([1, 2]));
		}
	});
});
