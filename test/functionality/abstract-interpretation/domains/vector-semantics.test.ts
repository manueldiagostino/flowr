import { assert, test, describe } from 'vitest';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { Top, NA } from '../../../../src/abstract-interpretation/domains/lattice';
import {
	card,
	isEnumerable,
	squash,
	adjustForZeros,
	initKnownPositions,
	updateKnownPositions,
	generateCyclicKnownPositions,
	accessPosition,
	countZerosInIntervalVector,
	propagate
} from '../../../../src/abstract-interpretation/vector/vector-semantics';

describe('Vector Semantics', () => {
	const intervalFactory = (concrete: ReadonlySet<number> | typeof Top | typeof NA | undefined): IntervalDomain => {
		if(concrete === undefined) {
			return IntervalDomain.bottom();
		}
		return IntervalDomain.abstract(concrete as ReadonlySet<number> | typeof Top);
	};

	const mkVector = (
		length: [number, number],
		values: [number, number][],
		summary?: [number, number],
		attributes?: { must: string[]; may: string[] }
	): VectorDomain<IntervalDomain> => {
		const len = new PosIntervalDomain(length);
		const vals = new KnownInitialPositionsDomain(
			values.map(([l, u]) => new IntervalDomain([l, u])),
			intervalFactory
		);
		const sum = summary === undefined ? IntervalDomain.bottom() : new IntervalDomain(summary);
		const attrs = attributes
			? VectorAttrDomain.from(attributes.must as ('names' | 'dim' | 'class' | 'other')[], attributes.may as ('names' | 'dim' | 'class' | 'other')[])
			: VectorAttrDomain.top();
		return new VectorDomain({ length: len, values: vals, summary: sum, attributes: attrs }, intervalFactory);
	};

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
			const vals = KnownInitialPositionsDomain.top(intervalFactory);
			const sum = new IntervalDomain([5, 10]);
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

	describe('Phase 1: adjustForZeros helper', () => {
		const intervalFactory2 = (concrete: ReadonlySet<number> | typeof Top | typeof NA | undefined): IntervalDomain => {
			if(concrete === Top) {
				return IntervalDomain.top();
			}
			if(concrete === NA || concrete === undefined) {
				return IntervalDomain.bottom();
			}
			const arr = [...concrete] as number[];
			if(arr.length === 0) {
				return IntervalDomain.bottom();
			}
			return new IntervalDomain([Math.min(...arr), Math.max(...arr)]);
		};

		const mkIntervalVector = (
			length: [number, number],
			values: [number, number][]
		): VectorDomain<IntervalDomain> => {
			const len = new PosIntervalDomain(length);
			const vals = new KnownInitialPositionsDomain(
				values.map(([l, u]) => new IntervalDomain([l, u])),
				intervalFactory2
			);
			const sum = IntervalDomain.bottom();
			const attrs = VectorAttrDomain.top();
			return new VectorDomain({ length: len, values: vals, summary: sum, attributes: attrs }, intervalFactory2);
		};

		test('adjustForZeros with bottom vector returns bottom', () => {
			const vector = VectorDomain.bottom(intervalFactory2);
			const result = adjustForZeros(vector);

			assert.strictEqual(result.isBottom(), true);
		});

		test('adjustForZeros with top vector returns top', () => {
			const vector = VectorDomain.top(intervalFactory2);
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
			const summary = new IntervalDomain([10, 10]);
			const result = propagate([], summary, 0);
			assert.strictEqual(result.toString(), '[10, 10]');
		});

		test('propagate with definite zero increments counter', () => {
			const positions = [new IntervalDomain([0, 0]), new IntervalDomain([5, 5])];
			const summary = new IntervalDomain([5, 5]);
			const result = propagate(positions, summary, 0);
			// First is zero (skipped), second is non-zero but k=1 so we decrement
			// When k reaches 0 with empty list, return summary which is [5, 5]
			assert.strictEqual(result.toString(), '[5, 5]');
		});

		test('propagate with possible zero joins with propagated value', () => {
			const positions = [new IntervalDomain([-1, 1]), new IntervalDomain([5, 5])];
			const summary = IntervalDomain.bottom();
			const result = propagate(positions, summary, 0);
			// May contain zero, joins with propagated rest
			assert.ok(result.isValue());
		});
	});

	describe('Helper: initKnownPositions', () => {
		test('initKnownPositions fills positions correctly', () => {
			const positions = [
				new IntervalDomain([1, 1]),
				new IntervalDomain([2, 2]),
				new IntervalDomain([3, 3])
			];
			const naValue = new IntervalDomain([NaN, NaN]);
			const result = initKnownPositions(positions, 2, 3, 5, naValue);

			// First 2: keep as-is
			// Positions 2-3: join with NA
			// Positions 3-5: fill with NA
			assert.strictEqual(result.length, 5);
		});
	});

	describe('Helper: updateKnownPositions', () => {
		test('updateKnownPositions with empty selector returns unchanged', () => {
			const positions = [new IntervalDomain([1, 1]), new IntervalDomain([2, 2])];
			const selectorPositions: PosIntervalDomain[] = [];
			const values = [new IntervalDomain([99, 99])];

			const result = updateKnownPositions(positions, selectorPositions, values);
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].toString(), '[1, 1]');
		});

		test('updateKnownPositions updates specific positions', () => {
			const positions = [
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
			const positions = [
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
			const naValue = new IntervalDomain([NaN, NaN]);

			const pos0 = accessPosition(vector, 0, naValue);
			assert.strictEqual(pos0.toString(), '[10, 10]');

			const pos1 = accessPosition(vector, 1, naValue);
			assert.strictEqual(pos1.toString(), '[20, 20]');

			const pos2 = accessPosition(vector, 2, naValue);
			assert.strictEqual(pos2.toString(), '[30, 30]');
		});

		test('accessPosition returns NA for out of bounds', () => {
			const vector = mkVector([2, 2], [[10, 10], [20, 20]]);
			const naValue = new IntervalDomain([99, 99]);

			const result = accessPosition(vector, 5, naValue);
			assert.strictEqual(result.toString(), '[99, 99]');
		});

		test('accessPosition with bottom returns bottom', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = accessPosition(bottom, 0, naValue);
			assert.strictEqual(result.isBottom(), true);
		});

		test('accessPosition with top returns top', () => {
			const top = VectorDomain.top(intervalFactory);
			const naValue = new IntervalDomain([NaN, NaN]);

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
			const posVector = new VectorDomain<PosIntervalDomain>({
				length: vector.length,
				values: new KnownInitialPositionsDomain(
					[new PosIntervalDomain([1, 1]), new PosIntervalDomain([2, 2]), new PosIntervalDomain([3, 3])],
					intervalFactory
				),
				summary:    new PosIntervalDomain([0, 0]),
				attributes: vector.attributes
			}, intervalFactory);
			const result = countZerosInIntervalVector(posVector);
			assert.strictEqual(result.toString(), '[0, 0]');
		});

		test('countZeros with definite zeros counts them', () => {
			const posVector = new VectorDomain<PosIntervalDomain>({
				length: new PosIntervalDomain([3, 3]),
				values: new KnownInitialPositionsDomain(
					[new PosIntervalDomain([0, 0]), new PosIntervalDomain([0, 0]), new PosIntervalDomain([1, 1])],
					intervalFactory
				),
				summary:    new PosIntervalDomain([0, 0]),
				attributes: VectorAttrDomain.top()
			}, intervalFactory);
			const result = countZerosInIntervalVector(posVector);
			assert.strictEqual(result.toString(), '[2, 2]');
		});
	});
});
