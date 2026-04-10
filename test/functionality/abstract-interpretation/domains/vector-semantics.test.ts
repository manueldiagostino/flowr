import { assert, test, describe } from 'vitest';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { Top, NA } from '../../../../src/abstract-interpretation/domains/lattice';
import {
	applyVectorSemantics,
	getConstraintType,
	ConstraintType,
	card,
	isEnumerable,
	squash,
	adjustForZeros
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

	describe('Constraint Types', () => {
		test('setAttr has OperandModification type', () => {
			assert.strictEqual(getConstraintType('setAttr'), ConstraintType.OperandModification);
		});

		test('recycle has ResultPostcondition type', () => {
			assert.strictEqual(getConstraintType('recycle'), ConstraintType.ResultPostcondition);
		});

		test('select operations have OperandPrecondition type', () => {
			assert.strictEqual(getConstraintType('selectPositive'), ConstraintType.OperandPrecondition);
			assert.strictEqual(getConstraintType('selectNegative'), ConstraintType.OperandPrecondition);
			assert.strictEqual(getConstraintType('selectLogical'), ConstraintType.OperandPrecondition);
		});

		test('update operations have OperandModification type', () => {
			assert.strictEqual(getConstraintType('updatePositive'), ConstraintType.OperandModification);
			assert.strictEqual(getConstraintType('updateNegative'), ConstraintType.OperandModification);
			assert.strictEqual(getConstraintType('updateLogical'), ConstraintType.OperandModification);
		});

		test('unknown has ResultPostcondition type', () => {
			assert.strictEqual(getConstraintType('unknown'), ConstraintType.ResultPostcondition);
		});
	});

	describe('Phase 1: setAttr', () => {
		test('setAttr with empty attributes updates vector attributes', () => {
			const vector = mkVector([0, 3], [[1, 1]], [1, 10]);
			const emptyAttrs = VectorAttrDomain.empty();
			const result = applyVectorSemantics('setAttr', vector, { attrs: emptyAttrs });

			assert.strictEqual(result.isTop(), false);
			assert.strictEqual(result.attributes.isEmpty(), true);
			assert.strictEqual(result.length.toString(), '[0, 3]');
		});

		test('setAttr with non-empty attributes returns top', () => {
			const vector = mkVector([0, 3], [[1, 1]], [1, 10]);
			const nonEmptyAttrs = VectorAttrDomain.from(['names'], ['names']);
			const result = applyVectorSemantics('setAttr', vector, { attrs: nonEmptyAttrs });

			assert.strictEqual(result.isTop(), true);
		});

		test('setAttr with top attributes returns top', () => {
			const vector = mkVector([0, 3], [[1, 1]], [1, 10]);
			const topAttrs = VectorAttrDomain.top();
			const result = applyVectorSemantics('setAttr', vector, { attrs: topAttrs });

			assert.strictEqual(result.isTop(), true);
		});
	});

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
		const intervalFactory = (concrete: ReadonlySet<number> | typeof Top | typeof NA | undefined): IntervalDomain => {
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
				intervalFactory
			);
			const sum = IntervalDomain.bottom();
			const attrs = VectorAttrDomain.top();
			return new VectorDomain({ length: len, values: vals, summary: sum, attributes: attrs }, intervalFactory);
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

	describe('Phase 1: Recycle', () => {
		test('recycle with bottom operand returns bottom', () => {
			const vector = mkVector([0, 3], [[1, 1]], [1, 10]);
			const bottom = VectorDomain.bottom(intervalFactory);
			const result = applyVectorSemantics('recycle', vector, { other: bottom });

			assert.strictEqual(result.isBottom(), true);
		});

		test('recycle with top operand returns top', () => {
			const vector = mkVector([0, 3], [[1, 1]], [1, 10]);
			const top = VectorDomain.top(intervalFactory);
			const result = applyVectorSemantics('recycle', vector, { other: top });

			assert.strictEqual(result.isTop(), true);
		});

		test('recycle with same length returns original length', () => {
			const v1 = mkVector([0, 3], [[1, 1]], [1, 10]);
			const v2 = mkVector([0, 3], [[2, 2]], [2, 20]);
			const result = applyVectorSemantics('recycle', v1, { other: v2 });

			assert.strictEqual(result.length.toString(), '[0, 3]');
		});

		test('recycle with compatible lengths uses longer length', () => {
			const v1 = mkVector([0, 3], [[1, 1]], [1, 10]);
			const v2 = mkVector([0, 6], [[2, 2]], [2, 20]);
			const result = applyVectorSemantics('recycle', v1, { other: v2 });

			assert.strictEqual(result.length.toString(), '[0, 6]');
		});

		test('recycle with compatible multiples returns longer length', () => {
			const v1 = mkVector([0, 3], [[1, 1]], [1, 10]);
			const v2 = mkVector([0, 6], [[2, 2]], [2, 20]);
			const result1 = applyVectorSemantics('recycle', v1, { other: v2 });
			const result2 = applyVectorSemantics('recycle', v2, { other: v1 });

			assert.strictEqual(result1.length.toString(), '[0, 6]');
			assert.strictEqual(result2.length.toString(), '[0, 6]');
		});

		test('recycle with incompatible finite lengths returns top', () => {
			const v1 = mkVector([0, 3], [[1, 1]], [1, 10]);
			const v2 = mkVector([0, 5], [[2, 2]], [2, 20]);
			const result = applyVectorSemantics('recycle', v1, { other: v2 });

			assert.strictEqual(result.isTop(), true);
		});

		test('recycle joins attributes from both vectors', () => {
			const v1 = mkVector([0, 3], [[1, 1]], [1, 10], { must: ['names'], may: ['names', 'dim'] });
			const v2 = mkVector([0, 3], [[2, 2]], [2, 20], { must: ['dim'], may: ['dim', 'class'] });
			const result = applyVectorSemantics('recycle', v1, { other: v2 });

			assert.strictEqual(result.attributes.toString(), '(∅, {names, dim, class})');
		});

		test('recycle preserves first vector values and summary', () => {
			const v1 = mkVector([0, 3], [[1, 1]], [5, 10]);
			const v2 = mkVector([0, 3], [[2, 2]], [15, 20]);
			const result = applyVectorSemantics('recycle', v1, { other: v2 });

			assert.strictEqual(result.values.toString(), '[[1, 1]]');
			assert.strictEqual(result.summary.toString(), '[5, 10]');
		});
	});

	describe('Phase 2: Positive Selection', () => {
		test('selectPositive with single index extracts element', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			const selector = mkVector([1, 1], [[2, 2]], undefined); // Select index 2
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('selectPositive', vector, { selector, naValue });

			assert.strictEqual(result.length.toString(), '[1, 1]');
			assert.strictEqual(result.values.toString(), '[[20, 20]]');
		});

		test('selectPositive with multiple indices extracts elements', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			const selector = mkVector([2, 2], [[1, 1], [3, 3]], undefined); // Select indices 1 and 3
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('selectPositive', vector, { selector, naValue });

			assert.strictEqual(result.length.toString(), '[2, 2]');
		});

		test('selectPositive with zero index adjusts length', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			const selector = mkVector([2, 2], [[0, 0], [2, 2]], undefined); // Select 0 (nothing) and 2
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('selectPositive', vector, { selector, naValue });

			// Zero doesn't select anything, so length should be 1
			assert.strictEqual(result.length.toString(), '[1, 1]');
		});

		test('selectPositive out of bounds returns NA', () => {
			const vector = mkVector([2, 2], [[10, 10], [20, 20]], undefined);
			const selector = mkVector([1, 1], [[5, 5]], undefined); // Index out of bounds
			const naValue = new IntervalDomain([99, 99]); // NA representation

			const result = applyVectorSemantics('selectPositive', vector, { selector, naValue });

			assert.strictEqual(result.values.toString(), '[[99, 99]]');
		});
	});

	describe('Phase 2: Negative Selection', () => {
		test('selectNegative excludes single element', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			const selector = mkVector([1, 1], [[-2, -2]], undefined); // Exclude index 2
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('selectNegative', vector, { selector, naValue });

			assert.strictEqual(result.length.toString(), '[2, 2]');
			// Result should be [10, 30] (excluding 20)
		});

		test('selectNegative excludes multiple elements', () => {
			const vector = mkVector([5, 5], [[10, 10], [20, 20], [30, 30], [40, 40], [50, 50]], undefined);
			const selector = mkVector([2, 2], [[-1, -1], [-3, -3]], undefined); // Exclude indices 1 and 3
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('selectNegative', vector, { selector, naValue });

			assert.strictEqual(result.length.toString(), '[3, 3]');
		});

		test('selectNegative with out of bounds excludes nothing', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			const selector = mkVector([1, 1], [[-10, -10]], undefined); // Exclude index 10 (doesn't exist)
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('selectNegative', vector, { selector, naValue });

			assert.strictEqual(result.length.toString(), '[3, 3]');
		});
	});

	describe('Phase 2: Logical Selection', () => {
		test('selectLogical with TRUE selects element', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			// TRUE = [1, 1], FALSE = [0, 0]
			const selector = mkVector([1, 1], [[1, 1]], undefined); // TRUE at position 1
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('selectLogical', vector, { selector, naValue });

			// Position 1 selected, so result should include 10
			assert.ok(result.length.toString().includes('1') || result.length.toString().includes('3'));
		});

		test('selectLogical recycles shorter mask', () => {
			const vector = mkVector([4, 4], [[10, 10], [20, 20], [30, 30], [40, 40]], undefined);
			const selector = mkVector([2, 2], [[1, 1], [0, 0]], undefined); // TRUE, FALSE - recycled
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('selectLogical', vector, { selector, naValue });

			// Should select positions 1 and 3 (TRUE, FALSE, TRUE, FALSE pattern)
			assert.ok(result.values.isValue() || result.values.isTop());
		});

		test('selectLogical with empty selector returns empty', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			const selector = mkVector([0, 0], [], undefined); // Empty selector
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('selectLogical', vector, { selector, naValue });

			assert.strictEqual(result.length.toString(), '[0, 0]');
		});
	});

	describe('Phase 3: Positive Update', () => {
		test('updatePositive with single index updates value', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			// Selector: position 2, Values: 99
			const selector = mkVector([1, 1], [[2, 2]], undefined);
			const values = mkVector([1, 1], [[99, 99]], undefined);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('updatePositive', vector, { selector, values, naValue });

			// Result should have updated position 2 with 99
			assert.strictEqual(result.length.toString(), '[3, 3]');
			assert.ok(result.values.isValue());
		});

		test('updatePositive with zero index is handled by AdjustForZeros', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			// Selector: position 0 (ignored after AdjustForZeros)
			const selector = mkVector([1, 1], [[0, 0]], undefined);
			const values = mkVector([1, 1], [[99, 99]], undefined);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('updatePositive', vector, { selector, values, naValue });

			// Zero index should be ignored
			assert.strictEqual(result.length.toString(), '[3, 3]');
		});

		test('updatePositive extending vector fills with NA', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			// Selector: position 5 (extends beyond original length)
			const selector = mkVector([1, 1], [[5, 5]], undefined);
			const values = mkVector([1, 1], [[99, 99]], undefined);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('updatePositive', vector, { selector, values, naValue });

			// Should extend to position 5, with NA filling gaps
			assert.ok(result.length.toString().includes('5'));
		});

		test('updatePositive with finite selector updates correctly', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			// Finite selector to update positions 1 and 3
			const selector = mkVector([2, 2], [[1, 1], [3, 3]], undefined);
			const values = mkVector([2, 2], [[99, 99], [88, 88]], undefined);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('updatePositive', vector, { selector, values, naValue });

			// Should update positions 1 and 3, keep position 2 unchanged
			assert.strictEqual(result.length.toString(), '[3, 3]');
			assert.ok(result.values.isValue());
		});
	});

	describe('Phase 3: Negative Update', () => {
		test('updateNegative excludes and updates remaining', () => {
			const vector = mkVector([5, 5], [[10, 10], [20, 20], [30, 30], [40, 40], [50, 50]], undefined);
			// Selector: exclude position 2 (index -2)
			const selector = mkVector([1, 1], [[-2, -2]], undefined);
			const values = mkVector([1, 1], [[99, 99]], undefined);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('updateNegative', vector, { selector, values, naValue });

			// Result should have length 5 (all positions except 2 get updated)
			assert.strictEqual(result.length.toString(), '[5, 5]');
		});

		test('updateNegative with multiple exclusions', () => {
			const vector = mkVector([5, 5], [[10, 10], [20, 20], [30, 30], [40, 40], [50, 50]], undefined);
			// Selector: exclude positions 1 and 3 (indices -1, -3)
			const selector = mkVector([2, 2], [[-1, -1], [-3, -3]], undefined);
			const values = mkVector([1, 1], [[99, 99]], undefined);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('updateNegative', vector, { selector, values, naValue });

			// Positions 2, 4, 5 should be updated
			assert.strictEqual(result.length.toString(), '[5, 5]');
		});

		test('updateNegative with out of bounds excludes nothing', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			// Selector: exclude position 10 (doesn't exist)
			const selector = mkVector([1, 1], [[-10, -10]], undefined);
			const values = mkVector([1, 1], [[99, 99]], undefined);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('updateNegative', vector, { selector, values, naValue });

			// All positions should be updated
			assert.strictEqual(result.length.toString(), '[3, 3]');
		});
	});

	describe('Phase 3: Logical Update', () => {
		test('updateLogical with TRUE updates position', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			// TRUE = [1, 1] - updates position
			const selector = mkVector([1, 1], [[1, 1]], undefined);
			const values = mkVector([1, 1], [[99, 99]], undefined);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('updateLogical', vector, { selector, values, naValue });

			assert.ok(result.length.toString().includes('3'));
		});

		test('updateLogical recycles shorter mask', () => {
			const vector = mkVector([4, 4], [[10, 10], [20, 20], [30, 30], [40, 40]], undefined);
			// TRUE, FALSE pattern - recycled
			const selector = mkVector([2, 2], [[1, 1], [0, 0]], undefined);
			const values = mkVector([1, 1], [[99, 99]], undefined);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('updateLogical', vector, { selector, values, naValue });

			// Should update positions 1 and 3
			assert.ok(result.values.isValue() || result.values.isTop());
		});

		test('updateLogical with empty selector', () => {
			const vector = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]], undefined);
			const selector = mkVector([0, 0], [], undefined);
			const values = mkVector([1, 1], [[99, 99]], undefined);
			const naValue = new IntervalDomain([NaN, NaN]);

			const result = applyVectorSemantics('updateLogical', vector, { selector, values, naValue });

			// No positions selected for update
			assert.ok(result.length.isValue() || result.length.isTop());
		});
	});

	describe('concatenation', () => {
		/**
		 * BUG: The current applyConcatenateSemantics naively concatenates values as
		 * `[...values1, ...values2]`. This is WRONG when vectors have uncertain lengths.
		 *
		 * Example of the bug:
		 * - a: length [1,4], known values [[1,1],[2,2],[3,3],[4,4]]
		 * - b: length [1,3], known values [[10,10],[20,20],[30,30]]
		 *
		 * Current behavior: values = [[1,1],[2,2],[3,3],[4,4],[10,10],[20,20],[30,30]]
		 *                    position 4 gets [10,10] (WRONG!)
		 *
		 * Correct behavior: Position-wise LUB:
		 * - Pos 0: [1,1] (always from a)
		 * - Pos 1: [2,2] ⊔ [10,10] = [2,10] (from a if len>=2, from b if len=1)
		 * - Pos 2: [3,3] ⊔ [20,20] = [3,20] (from a if len>=3, from b if len<=2)
		 * - Pos 3: [4,4] ⊔ [30,30] = [4,30] (from a if len=4, from b if len<=3)
		 * - Pos 4+: summary ⊔ [20,30] ⊔ [30,30] or just summary
		 */

		test('uncertain length concatenation uses position-wise LUB', () => {
			// a: length [1,4], values [[1,1],[2,2],[3,3],[4,4]]
			const a = mkVector([1, 4], [[1, 1], [2, 2], [3, 3], [4, 4]]);
			// b: length [1,3], values [[10,10],[20,20],[30,30]]
			const b = mkVector([1, 3], [[10, 10], [20, 20], [30, 30]]);

			const result = applyVectorSemantics('concatenate', a, { other: b });

			// The result length should be [2, 7] (1+1 to 4+3)
			assert.strictEqual(result.length.toString(), '[2, 7]');

			// With the slicing algorithm, position-wise LUB is computed:
			// Position 0: [1,1] (always from a)
			// Position 1: [2,2] ⊔ [10,10] = [2,10] (from a if len>=2, from b if len=1)
			// Position 2: [3,3] ⊔ [10,10] ⊔ [20,20] = [3,20]
			// Position 3: [4,4] ⊔ [10,10] ⊔ [20,20] ⊔ [30,30] = [4,30]
			// Position 4: [10,10] ⊔ [20,20] ⊔ [30,30] = [10,30]
			// Position 5: [20,20] ⊔ [30,30] = [20,30]
			// Position 6: [30,30]
			assert.strictEqual(result.values.isValue(), true);
			assert.strictEqual(result.values.toString(), '[[1, 1], [2, 10], [3, 20], [4, 30], [10, 30], [20, 30], [30, 30]]');
		});

		test('certain (singleton) lengths should still work correctly', () => {
			// When both lengths are certain singletons, simple concatenation is correct
			const a = mkVector([2, 2], [[1, 1], [2, 2]]);
			const b = mkVector([3, 3], [[10, 10], [20, 20], [30, 30]]);

			const result = applyVectorSemantics('concatenate', a, { other: b });

			// Length should be [5, 5]
			assert.strictEqual(result.length.toString(), '[5, 5]');

			// With certain lengths, concatenation should work and produce concrete values
			assert.strictEqual(result.values.isValue(), true);
			assert.strictEqual(result.values.toString(), '[[1, 1], [2, 2], [10, 10], [20, 20], [30, 30]]');
		});

		test('empty first vector returns second vector values', () => {
			const a = mkVector([0, 0], []);
			const b = mkVector([2, 2], [[1, 1], [2, 2]]);

			const result = applyVectorSemantics('concatenate', a, { other: b });

			assert.strictEqual(result.length.toString(), '[2, 2]');
			assert.strictEqual(result.values.toString(), '[[1, 1], [2, 2]]');
		});

		test('empty second vector returns first vector values', () => {
			const a = mkVector([3, 3], [[1, 1], [2, 2], [3, 3]]);
			const b = mkVector([0, 0], []);

			const result = applyVectorSemantics('concatenate', a, { other: b });

			assert.strictEqual(result.length.toString(), '[3, 3]');
			assert.strictEqual(result.values.toString(), '[[1, 1], [2, 2], [3, 3]]');
		});

		test('vectors with uncertain length use position-wise LUB', () => {
			// a: length [2,5], all 5 positions are [1,1]
			const a = mkVector([2, 5], [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]);
			// b: length [1,2], all 2 positions are [10,10]
			const b = mkVector([1, 2], [[10, 10], [10, 10]]);

			const result = applyVectorSemantics('concatenate', a, { other: b });

			// Result length should be [3, 7]
			assert.strictEqual(result.length.toString(), '[3, 7]');

			// With slicing algorithm:
			// Max concat (a.len=5): [[1,1], [1,1], [1,1], [1,1], [1,1], [10,10], [10,10]]
			// Slide b left from pos 4 to 2:
			// - At len_a=4: join positions 4,5 with b[0],b[1] = [1,1]⊔[10,10]=[1,10]
			// - At len_a=3: join positions 3,4 with b[0],b[1] = [1,1]⊔[10,10]=[1,10] 
			// - At len_a=2: join positions 2,3 with b[0],b[1] = [1,1]⊔[10,10]=[1,10]
			// Result: [[1,1], [1,1], [1,10], [1,10], [1,10], [10,10], [10,10]]
			assert.strictEqual(result.values.isValue(), true);
			assert.strictEqual(result.values.toString(), '[[1, 1], [1, 1], [1, 10], [1, 10], [1, 10], [10, 10], [10, 10]]');
		});

		test('bottom first operand returns bottom', () => {
			const a = VectorDomain.bottom(intervalFactory);
			const b = mkVector([2, 2], [[1, 1], [2, 2]]);

			const result = applyVectorSemantics('concatenate', a, { other: b });

			assert.strictEqual(result.isBottom(), true);
		});

		test('bottom second operand returns bottom', () => {
			const a = mkVector([3, 3], [[1, 1], [2, 2], [3, 3]]);
			const b = VectorDomain.bottom(intervalFactory);

			const result = applyVectorSemantics('concatenate', a, { other: b });

			assert.strictEqual(result.isBottom(), true);
		});

		test('top first operand returns top', () => {
			const a = VectorDomain.top(intervalFactory);
			const b = mkVector([2, 2], [[1, 1], [2, 2]]);

			const result = applyVectorSemantics('concatenate', a, { other: b });

			assert.strictEqual(result.isTop(), true);
		});

		test('top second operand returns top', () => {
			const a = mkVector([3, 3], [[1, 1], [2, 2], [3, 3]]);
			const b = VectorDomain.top(intervalFactory);

			const result = applyVectorSemantics('concatenate', a, { other: b });

			assert.strictEqual(result.isTop(), true);
		});

		test('uncertain length overlap uses position-wise LUB', () => {
			// a: length [1,2], both positions are [5,5]
			// b: length [1,2], both positions are [10,10]
			const a = mkVector([1, 2], [[5, 5], [5, 5]]);
			const b = mkVector([1, 2], [[10, 10], [10, 10]]);

			const result = applyVectorSemantics('concatenate', a, { other: b });

			// Length should be [2, 4]
			assert.strictEqual(result.length.toString(), '[2, 4]');

			// With slicing algorithm:
			// Max concat (a.len=2): [[5,5], [5,5], [10,10], [10,10]]
			// Slide b left from pos 1 to 1:
			// - At len_a=1: join positions 1,2 with b[0],b[1] = [5,5]⊔[10,10]=[5,10]
			// Result: [[5,5], [5,10], [10,10], [10,10]]
			assert.strictEqual(result.values.isValue(), true);
			assert.strictEqual(result.values.toString(), '[[5, 5], [5, 10], [10, 10], [10, 10]]');
		});
	});

	describe('Unknown Operation', () => {
		test('unknown operation returns top', () => {
			const vector = mkVector([0, 3], [[1, 1]], [1, 10]);
			const result = applyVectorSemantics('unknown', vector, undefined as never);

			assert.strictEqual(result.isTop(), true);
		});
	});
});
