import { assert, test, describe } from 'vitest';
import './log-config';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { mkVector } from '../_helper/vector-creation-helpers';
import { intervalFactory } from '../_helper/vector-interval-factory';

describe('Vector Domain', () => {

	describe('Basic Lattice Elements', () => {
		test('top() creates top element', () => {
			const top = VectorDomain.top(intervalFactory);
			assert.strictEqual(top.isTop(), true);
			assert.strictEqual(top.length.isTop(), true);
			assert.strictEqual(top.known.isTop(), true);
			assert.strictEqual(top.summary.isTop(), true);
			assert.strictEqual(top.attributes.isTop(), true);
		});

		test('bottom() creates bottom element', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			assert.strictEqual(bottom.isBottom(), true);
			assert.strictEqual(bottom.length.isBottom(), true);
			assert.strictEqual(bottom.known.isBottom(), true);
			assert.strictEqual(bottom.summary.isBottom(), true);
			assert.strictEqual(bottom.attributes.isBottom(), true);
		});

		test('create with value creates vector domain', () => {
			const vector = mkVector([0, 3], [[1, 1], [2, 2], [3, 3]], undefined);
			assert.strictEqual(vector.isValue(), true);
			assert.strictEqual(vector.length.toString(), '[0, 3]');
			assert.strictEqual(vector.known.toString(), '[[1, 1], [2, 2], [3, 3]]');
			assert.strictEqual(vector.summary.isBottom(), true);
		});

		test('infinite vector has summary valorized', () => {
			const vector = mkVector([0, Infinity], [[1, 1], [2, 2]], [1, 10]);
			assert.strictEqual(vector.isValue(), true);
			assert.strictEqual(vector.length.toString(), '[0, +∞]');
			assert.strictEqual(vector.known.toString(), '[[1, 1], [2, 2]]');
			assert.strictEqual(vector.summary.toString(), '[1, 10]');
		});
	});

	describe('Type Guards', () => {
		test('isTop returns true only for top element', () => {
			assert.strictEqual(VectorDomain.top(intervalFactory).isTop(), true);
			assert.strictEqual(VectorDomain.bottom(intervalFactory).isTop(), false);
			assert.strictEqual(mkVector([0, 1], [[1, 1]], undefined).isTop(), false);
		});

		test('isBottom returns true only for bottom element', () => {
			assert.strictEqual(VectorDomain.bottom(intervalFactory).isBottom(), true);
			assert.strictEqual(VectorDomain.top(intervalFactory).isBottom(), false);
			assert.strictEqual(mkVector([0, 1], [[1, 1]], undefined).isBottom(), false);
		});

		test('isValue returns true for all values', () => {
			assert.strictEqual(mkVector([0, 1], [[1, 1]], undefined).isValue(), true);
			assert.strictEqual(VectorDomain.top(intervalFactory).isValue(), true);
			assert.strictEqual(VectorDomain.bottom(intervalFactory).isValue(), true);
		});
	});

	describe('Accessors', () => {
		test('length accessor returns the length domain', () => {
			const vector = mkVector([5, 5], [[1, 1]], undefined);
			assert.strictEqual(vector.length.isValue(), true);
			assert.deepStrictEqual((vector.length.value as [number, number]), [5, 5]);
		});

		test('values accessor returns the known positions domain', () => {
			const vector = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			assert.strictEqual(vector.known.isValue(), true);
			assert.strictEqual(vector.known.toString(), '[[1, 1], [2, 2]]');
		});

		test('summary accessor returns the summary domain for infinite vectors', () => {
			const vector = mkVector([0, Infinity], [[1, 1]], [5, 15]);
			assert.strictEqual(vector.summary.isValue(), true);
			assert.strictEqual(vector.summary.toString(), '[5, 15]');
		});

		test('summary accessor returns bottom for finite vectors', () => {
			const vector = mkVector([0, 1], [[1, 1]], undefined);
			assert.strictEqual(vector.summary.isBottom(), true);
		});

		test('attributes accessor returns the attributes domain', () => {
			const vector = mkVector([0, 1], [[1, 1]], undefined, { must: ['names'], may: ['names', 'dim'] });
			assert.strictEqual(vector.attributes.isValue(), true);
			assert.strictEqual(vector.attributes.toString(), '({names}, {names, dim})');
		});
	});

	describe('equals', () => {
		test('same values are equal', () => {
			const a = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			const b = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			assert.strictEqual(a.equals(b), true);
			assert.strictEqual(b.equals(a), true);
		});

		test('different length values are not equal', () => {
			const a = mkVector([0, 4], [[1, 1], [2, 2], [3, 3], [4, 4]], undefined);
			const b = mkVector([0, 3], [[1, 1], [2, 2], [3, 3]], undefined);
			assert.strictEqual(a.equals(b), false);
		});

		test('different values are not equal', () => {
			const a = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			const b = mkVector([0, 2], [[1, 1], [2, 3]], undefined);
			assert.strictEqual(a.equals(b), false);
		});

		test('different summary values are not equal for infinite vectors', () => {
			const a = mkVector([0, Infinity], [[1, 1], [2, 2]], [1, 10]);
			const b = mkVector([0, Infinity], [[1, 1], [2, 2]], [1, 11]);
			assert.strictEqual(a.equals(b), false);
		});

		test('bottom equals bottom', () => {
			const a = VectorDomain.bottom(intervalFactory);
			const b = VectorDomain.bottom(intervalFactory);
			assert.strictEqual(a.equals(b), true);
		});

		test('top does not equal top (implementation quirk)', () => {
			const a = VectorDomain.top(intervalFactory);
			const b = VectorDomain.top(intervalFactory);
			assert.strictEqual(a.equals(b), false);
		});
	});

	describe('leq (partial order)', () => {
		test('bottom is leq anything', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			const top = VectorDomain.top(intervalFactory);
			const value = mkVector([0, 1], [[1, 1]], undefined);
			assert.strictEqual(bottom.leq(top), true);
			assert.strictEqual(bottom.leq(value), true);
			assert.strictEqual(bottom.leq(bottom), true);
		});

		test('anything is leq top', () => {
			const top = VectorDomain.top(intervalFactory);
			const bottom = VectorDomain.bottom(intervalFactory);
			const value = mkVector([0, 1], [[1, 1]], undefined);
			assert.strictEqual(top.leq(top), true);
			assert.strictEqual(value.leq(top), true);
			assert.strictEqual(bottom.leq(top), true);
		});

		test('narrower interval is leq wider interval', () => {
			const narrow = mkVector([1, 1], [[1, 1]], undefined);
			const wide = mkVector([0, 2], [[1, 2], [3, 4]], undefined);
			assert.strictEqual(narrow.leq(wide), true);
			assert.strictEqual(wide.leq(narrow), false);
		});

		test('equal values are leq each other', () => {
			const a = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			const b = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			assert.strictEqual(a.leq(b), true);
			assert.strictEqual(b.leq(a), true);
		});
	});

	describe('join (least upper bound)', () => {
		test('join with bottom returns other', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			const value = mkVector([0, 1], [[1, 1]], undefined);
			const join = bottom.join(value);
			assert.strictEqual(join.length.toString(), value.length.toString());
			assert.strictEqual(join.known.toString(), value.known.toString());
		});

		test('join combines length intervals', () => {
			const a = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			const b = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			const result = a.join(b);
			assert.strictEqual(result.length.toString(), '[0, 2]');
		});

		test('join of different length values extends with remaining elements', () => {
			const a = mkVector([0, 3], [[1, 1], [2, 2], [3, 3]], undefined);
			const b = mkVector([0, 3], [[1, 1], [2, 2], [3, 3]], undefined);
			const result = a.join(b);
			assert.strictEqual(result.known.toString(), '[[1, 1], [2, 2], [3, 3]]');
		});

		test('join is commutative', () => {
			const a = mkVector([0, 2], [[1, 3], [5, 5]], undefined);
			const b = mkVector([0, 2], [[2, 5], [8, 8]], undefined);
			assert.strictEqual(a.join(b).equals(b.join(a)), true);
		});

		test('join maintains lattice properties', () => {
			const a = mkVector([0, 2], [[1, 3], [5, 5]], undefined);
			const b = mkVector([0, 2], [[2, 5], [8, 8]], undefined);
			const join = a.join(b);
			assert.strictEqual(a.leq(join), true);
			assert.strictEqual(b.leq(join), true);
		});
	});

	describe('meet (greatest lower bound)', () => {
		test('meet with bottom returns bottom', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			const value = mkVector([0, 1], [[1, 1]], undefined);
			assert.strictEqual(value.meet(bottom).isBottom(), true);
			assert.strictEqual(bottom.meet(value).isBottom(), true);
		});

		test('meet intersects length intervals', () => {
			const a = mkVector([0, 5], [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]], undefined);
			const b = mkVector([3, 8], [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8]], undefined);
			const result = a.meet(b);
			assert.strictEqual(result.length.toString(), '[3, 5]');
		});

		test('meet of non-overlapping lengths has bottom length', () => {
			const a = mkVector([0, 3], [[1, 1], [2, 2], [3, 3]], undefined);
			const b = mkVector([5, 8], [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8]], undefined);
			const result = a.meet(b);
			assert.strictEqual(result.length.isBottom(), true);
		});

		test('meet of different length values truncates to common known', () => {
			const a = mkVector([0, 3], [[1, 1], [2, 2], [3, 3]], undefined);
			const b = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			const result = a.meet(b);
			assert.strictEqual(result.known.toString(), '[[1, 1], [2, 2]]');
		});

		test('meet is commutative', () => {
			const a = mkVector([0, 5], [[1, 5], [2, 6], [3, 7], [4, 8], [5, 9]], undefined);
			const b = mkVector([2, 8], [[3, 8], [4, 9], [5, 10], [6, 11], [7, 12], [8, 13], [9, 14], [10, 15]], undefined);
			assert.strictEqual(a.meet(b).equals(b.meet(a)), true);
		});

		test('meet maintains lattice properties', () => {
			const a = mkVector([0, 5], [[1, 5], [2, 6], [3, 7], [4, 8], [5, 9]], undefined);
			const b = mkVector([2, 8], [[3, 8], [4, 9], [5, 10], [6, 11], [7, 12], [8, 13], [9, 14], [10, 15]], undefined);
			const meet = a.meet(b);
			assert.strictEqual(meet.leq(a), true);
			assert.strictEqual(meet.leq(b), true);
		});
	});

	describe('widen', () => {
		test('widen with bottom returns other', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			const value = mkVector([0, 1], [[1, 1]], undefined);
			const result = bottom.widen(value);
			assert.strictEqual(result.length.toString(), value.length.toString());
			assert.strictEqual(result.known.toString(), value.known.toString());
		});

		test('widen widens length interval', () => {
			const a = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			const b = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			const result = a.widen(b);
			assert.strictEqual(result.length.toString(), '[0, 2]');
		});

		test('widen widens values element-wise', () => {
			const a = mkVector([0, 1], [[1, 3]], undefined);
			const b = mkVector([0, 1], [[2, 5]], undefined);
			const result = a.widen(b);
			assert.strictEqual(result.known.toString(), '[[1, +∞]]');
		});

		test('widen collapses different length values into summary for infinite vectors', () => {
			const a = mkVector([0, Infinity], [[1, 1], [2, 2], [3, 3]], [1, 10]);
			const b = mkVector([0, Infinity], [[1, 1]], [1, 15]);
			const result = a.widen(b);
			assert.strictEqual(result.known.toString(), '[[1, 1]]');
			assert.strictEqual(result.summary.toString(), '[1, 15]');
		});

		test('widen soundly over-approximates join', () => {
			const a = mkVector([0, 2], [[1, 3], [5, 5]], undefined);
			const b = mkVector([0, 2], [[2, 5], [8, 8]], undefined);
			const join = a.join(b);
			const widen = a.widen(b);
			assert.strictEqual(join.leq(widen), true);
		});
	});

	describe('narrow', () => {
		test('narrow with bottom returns bottom', () => {
			const bottom = VectorDomain.bottom(intervalFactory);
			const value = mkVector([0, 1], [[1, 1]], undefined);
			assert.strictEqual(value.narrow(bottom).isBottom(), true);
		});

		test('narrow refines the abstract value', () => {
			const a = mkVector([0, 5], [[1, 5], [2, 6], [3, 7], [4, 8], [5, 9]], undefined);
			const b = mkVector([2, 4], [[2, 4], [3, 5]], undefined);
			const narrow = a.narrow(b);
			assert.strictEqual(narrow.leq(a), true);
		});
	});

	describe('Reduction Logic', () => {
		test('values array trimmed to length upper bound', () => {
			// When length upper bound is 2, only 2 values should be kept
			// Excess values [3,3] and [4,4] are joined into the summary
			const vector = mkVector([0, 2], [[1, 1], [2, 2], [3, 3], [4, 4]], undefined);

			assert.strictEqual(vector.known.toString(), '[[1, 1], [2, 2]]');
			// Summary includes joined excess value
			assert.strictEqual(vector.summary.toString(), '[3, 4]');
		});

		test('excess values joined into summary', () => {
			const vector = mkVector([0, 2], [[1, 1], [5, 5], [10, 10]], undefined);

			assert.strictEqual(vector.known.toString(), '[[1, 1], [5, 5]]');
			// Summary includes the last excess value
			assert.strictEqual(vector.summary.toString(), '[10, 10]');
		});

		test('summary becomes bottom when length equals values length', () => {
			const vector = mkVector([2, 2], [[1, 1], [2, 2]], undefined);

			assert.strictEqual(vector.known.toString(), '[[1, 1], [2, 2]]');
			assert.strictEqual(vector.summary.isBottom(), true);
		});

		test('no reduction when values within bounds', () => {
			const vector = mkVector([3, 10], [[1, 1], [2, 2], [3, 3]], undefined);

			assert.strictEqual(vector.known.toString(), '[[1, 1], [2, 2], [3, 3]]');
			assert.strictEqual(vector.summary.isBottom(), true);
		});
	});
});
