import { assert, test, describe } from 'vitest';
import './log-config';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { Bottom, Top, NA } from '../../../../src/abstract-interpretation/domains/lattice';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { RVectorTypeDomain } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import { mkVector } from '../_helper/vector-helpers';
import { intervalFactory, naAwareIntervalFactory } from '../_helper/na-aware-helpers';
import {
	card,
	isEnumerable,
	squash,
	squashedExcept,
	adjustForZeros,
	initKnownPositions,
	updateKnownPositions,
	generateCyclicKnownPositions,
	accessPosition,
	countZerosInIntervalVector,
	propagate
} from '../../../../src/abstract-interpretation/vector/vector-semantics';

describe('Vector Semantics', () => {

	describe('Phase 1: card helper', () => {
		test('card of bottom interval is 0', () => {
			const interval = PosIntervalDomain.bottom();
			assert.strictEqual(card(interval), 0);
		});

		test('card of top interval is +Infinity', () => {
			const interval = PosIntervalDomain.top();
			assert.strictEqual(card(interval), +Infinity);
		});

		test('card of single value interval is 1', () => {
			const interval = new PosIntervalDomain([5, 5]);
			assert.strictEqual(card(interval), 1);
		});

		test('card of finite interval is computed correctly', () => {
			const interval1 = new PosIntervalDomain([0, 5]);
			assert.strictEqual(card(interval1), 6);

			const interval2 = new PosIntervalDomain([3, 7]);
			assert.strictEqual(card(interval2), 5);

			const interval3 = new PosIntervalDomain([10, 10]);
			assert.strictEqual(card(interval3), 1);
		});

		test('card of infinite interval is +Infinity', () => {
			const interval = new PosIntervalDomain([0, +Infinity]);
			assert.strictEqual(card(interval), +Infinity);

			const interval2 = new PosIntervalDomain([5, +Infinity]);
			assert.strictEqual(card(interval2), +Infinity);
		});
	});

	describe('Phase 1: isEnumerable helper', () => {
		test('bottom interval is enumerable (cardinality 0 <= threshold)', () => {
			const interval = PosIntervalDomain.bottom();
			assert.strictEqual(isEnumerable(interval), true);
		});

		test('top interval is not enumerable', () => {
			const interval = PosIntervalDomain.top();
			assert.strictEqual(isEnumerable(interval), false);
		});

		test('finite interval with cardinality <= 50 is enumerable', () => {
			const interval = new PosIntervalDomain([0, 49]);
			assert.strictEqual(isEnumerable(interval), true);

			const interval2 = new PosIntervalDomain([1, 50]);
			assert.strictEqual(isEnumerable(interval2), true);
		});

		test('finite interval with cardinality > 50 is not enumerable', () => {
			const interval = new PosIntervalDomain([0, 50]);
			assert.strictEqual(isEnumerable(interval), false);

			const interval2 = new PosIntervalDomain([0, 100]);
			assert.strictEqual(isEnumerable(interval2), false);
		});

		test('custom threshold works correctly', () => {
			const interval = new PosIntervalDomain([0, 10]);
			assert.strictEqual(isEnumerable(interval, 5), false);
			assert.strictEqual(isEnumerable(interval, 11), true);
			assert.strictEqual(isEnumerable(interval, 12), true);
		});

		test('infinite interval is not enumerable', () => {
			const interval = new PosIntervalDomain([0, +Infinity]);
			assert.strictEqual(isEnumerable(interval), false);
		});
	});

	describe('Phase 1: squash helper', () => {
		test('squash of bottom vector returns bottom summary', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			const result = squash(bottom);
			assert.strictEqual(result.isBottom(), true);
		});

		test('squash of top vector returns top summary', () => {
			const top = VectorDomain.top(intervalFactory);
			const result = squash(top);
			assert.strictEqual(result.isTop(), true);
		});

		test('squash joins all prefix values with summary', () => {
			const vector = mkVector([0, 3], [[1, 1], [2, 2]], [5, 10]);
			const result = squash(vector);

			assert.strictEqual(result.toString(), '[1, 10]');
		});

		test('squash with empty values returns summary', () => {
			const len = new PosIntervalDomain([0, 3]);
			const vals = KnownInitialPositionsDomain.top<NAAwareDomain<IntervalDomain>>(
				naAwareIntervalFactory
			);
			const sumDomain = new IntervalDomain([5, 10]);
			const sum = new NAAwareDomain({ inner: sumDomain, hasNA: false }, intervalFactory);
			const attrs = VectorAttrDomain.top();
			const vector = new VectorDomain({ length: len, values: vals, summary: sum, attributes: attrs }, intervalFactory);

			const result = squash(vector);
			assert.strictEqual(result.toString(), '[5, 10]');
		});

		test('squash with only prefix values (no summary)', () => {
			const vector = mkVector([2, 2], [[1, 1], [2, 2]], undefined);
			const result = squash(vector);

			assert.strictEqual(result.toString(), '[1, 2]');
		});
	});

	describe('Phase 1: squashedExcept helper', () => {
		test('squashedExcept of bottom vector returns bottom summary', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			const result = squashedExcept(bottom, new Set([1]));
			assert.strictEqual(result.isBottom(), true);
		});

		test('squashedExcept of top vector returns top summary', () => {
			const top = VectorDomain.top(intervalFactory);
			const result = squashedExcept(top, new Set([1]));
			assert.strictEqual(result.isTop(), true);
		});

		test('squashedExcept joins all prefix values with summary except excluded indices', () => {
			const vector = mkVector([0, 3], [[1, 1], [2, 2], [3, 3]], [5, 10]);
			// Exclude index 2 (1-based), so we join [1,1], [3,3], and [5,10]
			const result = squashedExcept(vector, new Set([2]));

			assert.strictEqual(result.toString(), '[1, 10]');
		});

		test('squashedExcept with no exclusions matches squash', () => {
			const vector = mkVector([0, 3], [[1, 1], [2, 2]], [5, 10]);
			const result = squashedExcept(vector, new Set());
			const squashed = squash(vector);

			assert.strictEqual(result.equals(squashed), true);
		});

		test('squashedExcept excluding all prefix values returns only summary', () => {
			const vector = mkVector([0, 2], [[1, 1], [2, 2]], [5, 10]);
			const result = squashedExcept(vector, new Set([1, 2]));

			assert.strictEqual(result.toString(), '[5, 10]');
		});
	});

	describe('Phase 1: adjustForZeros helper', () => {
		const mkIntervalVector = (
			length: [number, number],
			values: [number, number][]
		): VectorDomain<IntervalDomain> => {
			const len = new PosIntervalDomain(length);
			const vals = values.map(([l, u]) => new NAAwareDomain({ inner: new IntervalDomain([l, u]), hasNA: false }, intervalFactory));
			const sum = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: false }, intervalFactory);
			const attrs = VectorAttrDomain.top();
			return VectorDomain.fromValues(intervalFactory, len, vals, sum, attrs, RVectorTypeDomain.top());
		};

		test('adjustForZeros with bottom vector returns bottom', () => {
			const vector = VectorDomain.bottom(intervalFactory);
			const result = adjustForZeros(vector);

			assert.strictEqual(result.isBottom(), true);
		});

		test('adjustForZeros with top vector returns top', () => {
			const vector = VectorDomain.top(intervalFactory);
			const result = adjustForZeros(vector);

			assert.strictEqual(result.isTop(), true);
		});

		test('adjustForZeros reduces length by definite zero count', () => {
			// Vector with 2 definite zeros [0,0] and one non-zero
			const vector = mkIntervalVector([3, 3], [[0, 0], [0, 0], [5, 5]]);
			const result = adjustForZeros(vector);

			// Length should be reduced by 2 (definite zeros)
			assert.strictEqual(result.length.toString(), '[1, 1]');
		});

		test('adjustForZeros handles possible zeros in range', () => {
			// Vector with interval that may contain zero [0, 5]
			const vector = mkIntervalVector([2, 2], [[0, 5], [1, 1]]);
			const result = adjustForZeros(vector);

			// Upper bound reduced by 0 (no definite zeros), lower by 1 (possible zero)
			assert.strictEqual(result.length.toString(), '[1, 2]');
		});

		test('adjustForZeros propagates values past zeros', () => {
			// Vector with zero followed by value
			const vector = mkIntervalVector([3, 3], [[0, 0], [5, 5], [10, 10]]);
			const result = adjustForZeros(vector);

			// First position (zero) should be propagated/replaced
			assert.strictEqual(result.length.toString(), '[2, 2]');
		});
	});

	describe('Helper: propagate', () => {
		test('propagate with empty positions returns summary', () => {
			const summaryDomain = new IntervalDomain([10, 10]);
			const summary = new NAAwareDomain({ inner: summaryDomain, hasNA: false }, intervalFactory);
			const result = propagate([], summary, 0);
			assert.strictEqual(result.toString(), '[10, 10]');
		});

		test('propagate with definite zero increments counter', () => {
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([0, 0]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summaryDomain = new IntervalDomain([5, 5]);
			const summary = new NAAwareDomain({ inner: summaryDomain, hasNA: false }, intervalFactory);
			const result = propagate(positions, summary, 0);
			// First is zero (skipped), second is non-zero but k=1 so we decrement
			// When k reaches 0 with empty list, return summary which is [5, 5]
			assert.strictEqual(result.toString(), '[5, 5]');
		});

		test('propagate with possible zero joins with propagated value', () => {
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([-1, 1]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: false }, intervalFactory);
			const result = propagate(positions, summary, 0);
			// May contain zero, joins with propagated rest
			assert.ok(result.isValue());
		});

		test('propagate with k>0 joins first with propagated rest (paper L411)', () => {
		// Case: 0 ∉ γ(c₁) and k > 0  →  c₁ ⊔ Propagate(rest, s, k-1)
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([3, 3]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summaryDomain = new IntervalDomain([10, 10]);
			const summary = new NAAwareDomain({ inner: summaryDomain, hasNA: false }, intervalFactory);
			// k=1 means one pending zero to absorb
			// First is [3,3], non-zero with k>0, so we join [3,3] with propagate(rest, summary, 0)
			// propagate(rest=[5,5], summary=[10,10], k=0) returns [5,5] (k=0 case)
			// Result: [3,3] ⊔ [5,5] = [3, 5]
			const result = propagate(positions, summary, 1);
			assert.strictEqual(result.toString(), '[3, 5]');
		});

		test('propagate with k=0 returns first value unchanged (paper L414)', () => {
		// Case: 0 ∉ γ(c₁) and k = 0  →  c₁
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([3, 3]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summaryDomain = new IntervalDomain([10, 10]);
			const summary = new NAAwareDomain({ inner: summaryDomain, hasNA: false }, intervalFactory);
			// k=0, first is [3,3], non-zero, so we return [3,3] directly
			const result = propagate(positions, summary, 0);
			assert.strictEqual(result.toString(), '[3, 3]');
		});

		test('propagate with possible zero joins first with propagated (paper L409-410)', () => {
		// Case: 0 ∈ γ(c₁) and γ(c₁) ≠ {0}  →  c₁ ⊔ Propagate(rest, s, k)
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([0, 2]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summaryDomain = new IntervalDomain([10, 10]);
			const summary = new NAAwareDomain({ inner: summaryDomain, hasNA: false }, intervalFactory);
			// First is [0,2], contains 0 but not exactly {0}, k=0
			// Result: [0,2] ⊔ propagate([5,5], [10,10], 0)
			// propagate([5,5], [10,10], 0) returns [5,5] (k=0 case)
			// Result: [0,2] ⊔ [5,5] = [0, 5]
			const result = propagate(positions, summary, 0);
			assert.strictEqual(result.toString(), '[0, 5]');
		});
	});

	describe('Helper: initKnownPositions', () => {
		test('initKnownPositions fills positions correctly', () => {
			const positions: IntervalDomain[] = [
				new IntervalDomain([1, 1]),
				new IntervalDomain([2, 2]),
				new IntervalDomain([3, 3])
			];
			const naValue = new IntervalDomain([NaN, NaN]);
			const result = initKnownPositions<IntervalDomain>(positions, 2, 3, 5, naValue);

			// First 2: keep as-is
			// Positions 2-3: join with NA
			// Positions 3-5: fill with NA
			assert.strictEqual(result.length, 5);
		});
	});

	describe('Helper: updateKnownPositions', () => {
		test('updateKnownPositions with empty selector returns unchanged', () => {
			const positions: IntervalDomain[] = [
				new IntervalDomain([1, 1]),
				new IntervalDomain([2, 2])
			];
			const selectorPositions: PosIntervalDomain[] = [];
			const values = [new IntervalDomain([99, 99])];

			const result = updateKnownPositions(positions, selectorPositions, values);
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].toString(), '[1, 1]');
		});

		test('updateKnownPositions updates specific positions', () => {
			const positions: IntervalDomain[] = [
				new IntervalDomain([1, 1]),
				new IntervalDomain([2, 2]),
				new IntervalDomain([3, 3])
			];
			// Update position 2 (singleton)
			const selectorPositions = [new PosIntervalDomain([2, 2])];
			const values = [new IntervalDomain([99, 99])];

			const result = updateKnownPositions(positions, selectorPositions, values);
			assert.strictEqual(result[1].toString(), '[99, 99]');
			assert.strictEqual(result[0].toString(), '[1, 1]'); // unchanged
		});

		test('updateKnownPositions skips zero index', () => {
			const positions: IntervalDomain[] = [
				new IntervalDomain([1, 1]),
				new IntervalDomain([2, 2]),
				new IntervalDomain([3, 3])
			];
			// Zero index should be skipped
			const selectorPositions = [new PosIntervalDomain([0, 0])];
			const values = [new IntervalDomain([99, 99])];

			const result = updateKnownPositions(positions, selectorPositions, values);
			// All positions should remain unchanged
			assert.strictEqual(result[0].toString(), '[1, 1]');
			assert.strictEqual(result[1].toString(), '[2, 2]');
			assert.strictEqual(result[2].toString(), '[3, 3]');
		});
	});

	describe('Helper: generateCyclicKnownPositions', () => {
		test('generateCyclicKnownPositions cycles through values', () => {
			const vector = mkVector([2, 2], [[1, 1], [2, 2]]);
			const result = generateCyclicKnownPositions(vector, 5);

			// Should generate 5 positions cycling through [1,1], [2,2]
			assert.strictEqual(result.length, 5);
		});

		test('generateCyclicKnownPositions with bottom returns empty', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			const result = generateCyclicKnownPositions(bottom, 3);

			assert.strictEqual(result.length, 0);
		});
	});

	describe('Helper: accessPosition', () => {
		test('accessPosition returns correct value at position', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]]);
			const naValue = new NAAwareDomain({ inner: new IntervalDomain([NaN, NaN]), hasNA: true }, intervalFactory);

			const pos0 = accessPosition(vector, 0, naValue);
			assert.strictEqual(pos0.toString(), '[10, 10]');

			const pos1 = accessPosition(vector, 1, naValue);
			assert.strictEqual(pos1.toString(), '[20, 20]');

			const pos2 = accessPosition(vector, 2, naValue);
			assert.strictEqual(pos2.toString(), '[30, 30]');
		});

		test('accessPosition returns NA for out of bounds', () => {
			const vector = mkVector([2, 2], [[10, 10], [20, 20]]);
			const naValue = new NAAwareDomain({ inner: new IntervalDomain([99, 99]), hasNA: false }, intervalFactory);

			const result = accessPosition(vector, 5, naValue);
			assert.strictEqual(result.toString(), '[99, 99]');
		});

		test('accessPosition with bottom returns bottom', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			const naValue = new NAAwareDomain({ inner: new IntervalDomain([NaN, NaN]), hasNA: true }, intervalFactory);

			const result = accessPosition(bottom, 0, naValue);
			assert.strictEqual(result.isBottom(), true);
		});

		test('accessPosition with top returns top', () => {
			const top = VectorDomain.top(intervalFactory);
			const naValue = new NAAwareDomain({ inner: new IntervalDomain([NaN, NaN]), hasNA: true }, intervalFactory);

			const result = accessPosition(top, 0, naValue);
			assert.strictEqual(result.isTop(), true);
		});
	});

	describe('Helper: countZerosInIntervalVector', () => {
		test('countZeros with bottom returns bottom', () => {
			const bottom = VectorDomain.bottom(intervalFactory) as VectorDomain<PosIntervalDomain>;
			const result = countZerosInIntervalVector(bottom);
			assert.strictEqual(result.isBottom(), true);
		});

		test('countZeros with no zeros returns [0, 0]', () => {
			const vector = mkVector([3, 3], [[1, 1], [2, 2], [3, 3]]);
			const posIntervalFactory2 = (concrete: ReadonlySet<number> | typeof Top | typeof Bottom | typeof NA | undefined): PosIntervalDomain => {
				if(concrete === Top) {
					return PosIntervalDomain.top();
				}
				if(concrete === Bottom || concrete === undefined || concrete === NA) {
					return PosIntervalDomain.bottom();
				}
				const arr = [...concrete] as number[];
				if(arr.length === 0) {
					return PosIntervalDomain.bottom();
				}
				return new PosIntervalDomain([Math.min(...arr), Math.max(...arr)]);
			};
			const posVector = VectorDomain.fromValues(
				posIntervalFactory2,
				vector.length,
				[
					new NAAwareDomain({ inner: new PosIntervalDomain([1, 1]), hasNA: false }, posIntervalFactory2),
					new NAAwareDomain({ inner: new PosIntervalDomain([2, 2]), hasNA: false }, posIntervalFactory2),
					new NAAwareDomain({ inner: new PosIntervalDomain([3, 3]), hasNA: false }, posIntervalFactory2)
				],
				new NAAwareDomain({ inner: new PosIntervalDomain([0, 0]), hasNA: false }, posIntervalFactory2),
				vector.attributes,
				RVectorTypeDomain.top()
			);
			const result = countZerosInIntervalVector(posVector);
			assert.strictEqual(result.toString(), '[0, 0]');
		});

		test('countZeros with definite zeros counts them', () => {
			const posIntervalFactory2 = (concrete: ReadonlySet<number> | typeof Top | typeof Bottom | typeof NA | undefined): PosIntervalDomain => {
				if(concrete === Top) {
					return PosIntervalDomain.top();
				}
				if(concrete === Bottom || concrete === undefined || concrete === NA) {
					return PosIntervalDomain.bottom();
				}
				const arr = [...concrete] as number[];
				if(arr.length === 0) {
					return PosIntervalDomain.bottom();
				}
				return new PosIntervalDomain([Math.min(...arr), Math.max(...arr)]);
			};
			const posVector = VectorDomain.fromValues(
				posIntervalFactory2,
				new PosIntervalDomain([3, 3]),
				[
					new NAAwareDomain({ inner: new PosIntervalDomain([0, 0]), hasNA: false }, posIntervalFactory2),
					new NAAwareDomain({ inner: new PosIntervalDomain([0, 0]), hasNA: false }, posIntervalFactory2),
					new NAAwareDomain({ inner: new PosIntervalDomain([1, 1]), hasNA: false }, posIntervalFactory2)
				],
				new NAAwareDomain({ inner: new PosIntervalDomain([0, 0]), hasNA: false }, posIntervalFactory2),
				VectorAttrDomain.top(),
				RVectorTypeDomain.top()
			);
			const result = countZerosInIntervalVector(posVector);
			assert.strictEqual(result.toString(), '[2, 2]');
		});
	});
});
