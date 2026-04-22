import { assert, test, describe } from 'vitest';
import './log-config';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Bottom, Top } from '../../../../src/abstract-interpretation/domains/lattice';
import type { NA } from '../../../../src/abstract-interpretation/domains/lattice';

describe('Sequence Known Domain', () => {
	const intervalFactory = (concrete: ReadonlySet<number> | typeof Top | typeof Bottom | typeof NA | undefined): IntervalDomain => {
		if(concrete === undefined) {
			return IntervalDomain.bottom();
		}
		return IntervalDomain.abstract(concrete as ReadonlySet<number> | typeof Top);
	};

	const mkBottom = () => KnownInitialPositionsDomain.bottom<IntervalDomain>(intervalFactory);
	const mkTop = () => KnownInitialPositionsDomain.top<IntervalDomain>(intervalFactory);
	const mkSeq = (value: readonly [number, number][]) =>
		new KnownInitialPositionsDomain(value.map(([l, u]) => new IntervalDomain([l, u])), intervalFactory);

	describe('Basic Lattice Elements', () => {
		test('bottom() creates bottom', () => {
			const bottom = mkBottom();
			assert.strictEqual(bottom.isBottom(), true);
			assert.strictEqual(bottom.toString(), '⊥');
		});

		test('top() creates empty sequence', () => {
			const top = mkTop();
			assert.strictEqual(top.isTop(), true);
			assert.strictEqual(top.toString(), '[]');
		});

		test('create with value creates sequence', () => {
			const seq = mkSeq([[1, 3], [5, 10]]);
			assert.strictEqual(seq.isValue(), true);
			assert.strictEqual(seq.toString(), '[[1, 3], [5, 10]]');
		});
	});

	describe('Type Guards', () => {
		test('isTop returns true only for empty sequence', () => {
			assert.strictEqual(mkTop().isTop(), true);
			assert.strictEqual(mkSeq([]).isTop(), true);
			assert.strictEqual(mkSeq([[1, 2]]).isTop(), false);
			assert.strictEqual(mkBottom().isTop(), false);
		});

		test('isBottom returns true only for Bottom', () => {
			assert.strictEqual(mkBottom().isBottom(), true);
			assert.strictEqual(mkSeq([[1, 2]]).isBottom(), false);
			assert.strictEqual(mkTop().isBottom(), false);
		});

		test('isValue returns true for non-empty sequences', () => {
			assert.strictEqual(mkSeq([[1, 2]]).isValue(), true);
			assert.strictEqual(mkSeq([[1, 2], [3, 4]]).isValue(), true);
			assert.strictEqual(mkBottom().isValue(), false);
			// Note: isValue() returns true for top (empty array) because it only checks !== Bottom
			assert.strictEqual(mkTop().isValue(), true);
		});
	});

	describe('equals', () => {
		test('same values are equal', () => {
			const a = mkSeq([[1, 3], [5, 7]]);
			const b = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(a.equals(b), true);
			assert.strictEqual(b.equals(a), true);
		});

		test('different values are not equal', () => {
			const a = mkSeq([[1, 3], [5, 7]]);
			const b = mkSeq([[1, 3], [5, 8]]);
			assert.strictEqual(a.equals(b), false);
		});

		test('different lengths are not equal', () => {
			const a = mkSeq([[1, 3]]);
			const b = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(a.equals(b), false);
		});

		test('bottom equals bottom', () => {
			const a = mkBottom();
			const b = mkBottom();
			assert.strictEqual(a.equals(b), true);
		});

		test('top does not equal top (implementation quirk)', () => {
			const a = mkTop();
			const b = mkTop();
			// Note: equals returns false when either operand is top (implementation quirk)
			assert.strictEqual(a.equals(b), false);
		});

		test('bottom does not equal top', () => {
			const a = mkBottom();
			const b = mkTop();
			assert.strictEqual(a.equals(b), false);
		});

		test('bottom does not equal value', () => {
			const a = mkBottom();
			const b = mkSeq([[1, 3]]);
			assert.strictEqual(a.equals(b), false);
			assert.strictEqual(b.equals(a), false);
		});

		test('top does not equal value', () => {
			const a = mkTop();
			const b = mkSeq([[1, 3]]);
			assert.strictEqual(a.equals(b), false);
			assert.strictEqual(b.equals(a), false);
		});
	});

	describe('leq (partial order)', () => {
		test('bottom is leq anything', () => {
			const bottom = mkBottom();
			const top = mkTop();
			const value = mkSeq([[1, 3]]);
			assert.strictEqual(bottom.leq(top), true);
			assert.strictEqual(bottom.leq(value), true);
			assert.strictEqual(bottom.leq(bottom), true);
		});

		test('anything is leq top', () => {
			const top = mkTop();
			const bottom = mkBottom();
			const value = mkSeq([[1, 3]]);
			assert.strictEqual(top.leq(top), true);
			assert.strictEqual(value.leq(top), true);
			assert.strictEqual(bottom.leq(top), true);
		});

		test('shorter known is leq longer known if elements are leq', () => {
			const short = mkSeq([[1, 3]]);
			const long = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(short.leq(long), true);
			assert.strictEqual(long.leq(short), false);
		});

		test('known order with interval elements', () => {
			const a = mkSeq([[1, 3], [5, 7]]);
			const b = mkSeq([[1, 4], [5, 8]]);
			assert.strictEqual(a.leq(b), true);
			assert.strictEqual(b.leq(a), false);
		});

		test('known order requires all elements to be leq', () => {
			const a = mkSeq([[1, 3], [10, 20]]);
			const b = mkSeq([[1, 4], [5, 8]]);
			assert.strictEqual(a.leq(b), false);
		});

		test('equal sequences are leq each other', () => {
			const a = mkSeq([[1, 3], [5, 7]]);
			const b = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(a.leq(b), true);
			assert.strictEqual(b.leq(a), true);
		});
	});

	describe('join (least upper bound)', () => {
		test('join with bottom returns other', () => {
			const bottom = mkBottom();
			const value = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(bottom.join(value).equals(value), true);
			assert.strictEqual(value.join(bottom).equals(value), true);
		});

		test('join with top returns top', () => {
			const top = mkTop();
			const value = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(top.join(value).equals(top), true);
			assert.strictEqual(value.join(top).equals(top), true);
		});

		test('join of equal length sequences joins element-wise', () => {
			const a = mkSeq([[1, 3], [5, 7]]);
			const b = mkSeq([[2, 4], [6, 8]]);
			const result = a.join(b);
			assert.strictEqual(result.toString(), '[[1, 4], [5, 8]]');
		});

		test('join of different length sequences extends with remaining elements', () => {
			const a = mkSeq([[1, 3]]);
			const b = mkSeq([[2, 4], [6, 8], [10, 12]]);
			const result = a.join(b);
			assert.strictEqual(result.toString(), '[[1, 4], [6, 8], [10, 12]]');
		});

		test('join is commutative', () => {
			const a = mkSeq([[1, 3], [5, 7]]);
			const b = mkSeq([[2, 4], [6, 8]]);
			assert.strictEqual(a.join(b).equals(b.join(a)), true);
		});

		test('join maintains lattice properties', () => {
			const a = mkSeq([[1, 3], [5, 7]]);
			const b = mkSeq([[2, 4], [6, 8]]);
			const join = a.join(b);
			assert.strictEqual(a.leq(join), true);
			assert.strictEqual(b.leq(join), true);
		});
	});

	describe('meet (greatest lower bound)', () => {
		test('meet with bottom returns bottom', () => {
			const bottom = mkBottom();
			const value = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(value.meet(bottom).isBottom(), true);
			assert.strictEqual(bottom.meet(value).isBottom(), true);
		});

		test('meet with top returns other', () => {
			const top = mkTop();
			const value = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(top.meet(value).equals(value), true);
			assert.strictEqual(value.meet(top).equals(value), true);
		});

		test('meet of equal length sequences meets element-wise', () => {
			const a = mkSeq([[1, 5], [10, 20]]);
			const b = mkSeq([[3, 7], [15, 25]]);
			const result = a.meet(b);
			assert.strictEqual(result.toString(), '[[3, 5], [15, 20]]');
		});

		test('meet of different length sequences truncates to common known', () => {
			const a = mkSeq([[1, 5], [10, 20], [30, 40]]);
			const b = mkSeq([[3, 7], [15, 25]]);
			const result = a.meet(b);
			assert.strictEqual(result.toString(), '[[3, 5], [15, 20]]');
		});

		test('meet is commutative', () => {
			const a = mkSeq([[1, 5], [10, 20]]);
			const b = mkSeq([[3, 7], [15, 25]]);
			assert.strictEqual(a.meet(b).equals(b.meet(a)), true);
		});

		test('meet maintains lattice properties', () => {
			const a = mkSeq([[1, 5], [10, 20]]);
			const b = mkSeq([[3, 7], [15, 25]]);
			const meet = a.meet(b);
			assert.strictEqual(meet.leq(a), true);
			assert.strictEqual(meet.leq(b), true);
		});
	});

	describe('widen', () => {
		test('widen with bottom returns other', () => {
			const bottom = mkBottom();
			const value = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(bottom.widen(value).equals(value), true);
			assert.strictEqual(value.widen(bottom).equals(value), true);
		});

		test('widen with top returns top', () => {
			const top = mkTop();
			const value = mkSeq([[1, 3], [5, 7]]);
			// When top widens with value, result is not top due to equals quirk
			const result1 = top.widen(value);
			const result2 = value.widen(top);
			assert.strictEqual(result1.isTop(), true);
			assert.strictEqual(result2.isTop(), true);
		});

		test('widen of equal length sequences widens element-wise', () => {
			const a = mkSeq([[1, 3], [5, 7]]);
			const b = mkSeq([[2, 4], [6, 8]]);
			const result = a.widen(b);
			// IntervalDomain.widen accelerates to infinity when bounds expand
			assert.strictEqual(result.toString(), '[[1, +∞], [5, +∞]]');
		});

		test('widen of different length sequences truncates to common known', () => {
			const a = mkSeq([[1, 3], [5, 7], [9, 11]]);
			const b = mkSeq([[2, 4], [6, 8]]);
			const result = a.widen(b);
			// IntervalDomain.widen accelerates to infinity when bounds expand
			assert.strictEqual(result.toString(), '[[1, +∞], [5, +∞]]');
		});

		test('widen soundly over-approximates join', () => {
			const a = mkSeq([[1, 3], [5, 7]]);
			const b = mkSeq([[2, 4], [6, 8]]);
			const join = a.join(b);
			const widen = a.widen(b);
			assert.strictEqual(join.leq(widen), true);
		});

		test('widening acceleration to infinity', () => {
			const a = mkSeq([[1, 1]]);
			const b = mkSeq([[5, 7]]);
			const result = a.widen(b);
			assert.strictEqual(result.toString(), '[[1, +∞]]');
		});

		test('widening acceleration reverse direction', () => {
			const a = mkSeq([[5, 7]]);
			const b = mkSeq([[1, 3]]);
			const result = a.widen(b);
			assert.strictEqual(result.toString(), '[[-∞, 7]]');
		});
	});

	describe('narrow', () => {
		test('narrow is equivalent to meet', () => {
			const a = mkSeq([[1, 5], [10, 20]]);
			const b = mkSeq([[3, 7], [15, 25]]);
			assert.strictEqual(a.narrow(b).equals(a.meet(b)), true);
		});

		test('narrow with bottom returns bottom', () => {
			const bottom = mkBottom();
			const value = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(value.narrow(bottom).isBottom(), true);
		});

		test('narrow with top returns other', () => {
			const top = mkTop();
			const value = mkSeq([[1, 3], [5, 7]]);
			assert.strictEqual(top.narrow(value).equals(value), true);
		});
	});

	describe('concretize', () => {
		test('concretize bottom returns empty set', () => {
			const bottom = mkBottom();
			const result = bottom.concretize(100);
			assert.deepStrictEqual(result, new Set());
		});

		test('concretize top returns Top', () => {
			const top = mkTop();
			const result = top.concretize(100);
			assert.strictEqual(result, Top);
		});

		test('concretize value returns Top (too many combinations)', () => {
			const value = mkSeq([[1, 3], [5, 7]]);
			const result = value.concretize(100);
			assert.strictEqual(result, Top);
		});
	});

	describe('abstract', () => {
		test('abstract(empty set) = bottom', () => {
			const domain = mkTop();
			const result = domain.abstract(new Set());
			assert.strictEqual(result.isBottom(), true);
		});

		test('abstract(Top) = top', () => {
			const domain = mkTop();
			const result = domain.abstract(Top);
			assert.strictEqual(result.isTop(), true);
		});

		test('abstract(single concrete array) creates exact sequence', () => {
			const domain = mkTop();
			const concrete = new Set<readonly number[]>([[1, 5, 10]]);
			const result = domain.abstract(concrete);
			assert.strictEqual(result.toString(), '[[1, 1], [5, 5], [10, 10]]');
		});

		test('abstract(multiple arrays) abstracts values at each position', () => {
			const domain = mkTop();
			const concrete = new Set<readonly number[]>([
				[1, 5, 10],
				[1, 5, 20],
				[1, 6, 15]
			]);
			const result = domain.abstract(concrete);
			// Position 0: {1} -> [1,1], Position 1: {5,5,6} -> [5,6], Position 2: {10,20,15} -> [10,20]
			assert.strictEqual(result.toString(), '[[1, 1], [5, 6], [10, 20]]');
		});

		test('abstract handles arrays with common values', () => {
			const domain = mkTop();
			const concrete = new Set<readonly number[]>([
				[1, 5, 10, 20],
				[1, 5, 10, 30],
				[1, 5, 10, 40]
			]);
			const result = domain.abstract(concrete);
			// Position 0: {1} -> [1,1], Position 1: {5} -> [5,5], Position 2: {10} -> [10,10], Position 3: {20,30,40} -> [20,40]
			assert.strictEqual(result.toString(), '[[1, 1], [5, 5], [10, 10], [20, 40]]');
		});

		test('abstract with different first values abstracts correctly', () => {
			const domain = mkTop();
			const concrete = new Set<readonly number[]>([
				[1, 5, 10],
				[2, 5, 10]
			]);
			const result = domain.abstract(concrete);
			// Position 0: {1,2} -> [1,2], Position 1: {5} -> [5,5], Position 2: {10} -> [10,10]
			assert.strictEqual(result.toString(), '[[1, 2], [5, 5], [10, 10]]');
		});

		test('abstract handles arrays of different lengths', () => {
			const domain = mkTop();
			const concrete = new Set<readonly number[]>([
				[0, 2, 4],
				[1, 2, 7, 3]
			]);
			const result = domain.abstract(concrete);
			// Position 0: {0,1} -> [0,1], Position 1: {2} -> [2,2], Position 2: {4,7} -> [4,7], Position 3: {3} -> [3,3]
			assert.strictEqual(result.toString(), '[[0, 1], [2, 2], [4, 7], [3, 3]]');
		});
	});

	describe('toJson', () => {
		test('bottom serializes to description', () => {
			const bottom = mkBottom();
			assert.deepStrictEqual(bottom.toJson(), 'bottom');
		});

		test('top serializes to empty array', () => {
			const top = mkTop();
			assert.deepStrictEqual(top.toJson(), []);
		});

		test('value serializes element-wise', () => {
			const value = mkSeq([[1, 3], [5, 7]]);
			assert.deepStrictEqual(value.toJson(), [[1, 3], [5, 7]]);
		});
	});

	describe('create method', () => {
		test('create returns new instance with same structure', () => {
			const original = mkSeq([[1, 3], [5, 7]]);
			const created = original.create([[2, 4], [6, 8]].map(([l, u]) => new IntervalDomain([l, u])));
			assert.strictEqual(created.toString(), '[[2, 4], [6, 8]]');
		});

		test('create preserves domain type for bottom', () => {
			const original = mkSeq([[1, 3]]);
			const created = original.create(Bottom);
			assert.strictEqual(created.isBottom(), true);
		});
	});

	describe('complex sequence operations', () => {
		test('chained joins', () => {
			const a = mkSeq([[1, 2]]);
			const b = mkSeq([[3, 4]]);
			const c = mkSeq([[5, 6]]);
			const result = a.join(b).join(c);
			assert.strictEqual(result.toString(), '[[1, 6]]');
		});

		test('chained meets', () => {
			const a = mkSeq([[1, 10], [20, 30]]);
			const b = mkSeq([[5, 15], [25, 35]]);
			const c = mkSeq([[8, 12], [28, 32]]);
			const result = a.meet(b).meet(c);
			assert.strictEqual(result.toString(), '[[8, 10], [28, 30]]');
		});
	});
});
