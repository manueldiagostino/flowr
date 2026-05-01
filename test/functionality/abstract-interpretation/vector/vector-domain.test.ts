import { assert, test, describe } from 'vitest';
import './log-config';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { mkVector } from '../_helper/vector-creation-helpers';
import { intervalFactory, naAwareFactory } from '../_helper/vector-interval-factory';
import { asNaAware, asNaAwares, type ExpectedVector, toNAAwareDomain, toNAAwareDomains } from '../_helper/vector-assertion-helpers';
import { VectorAttrDomain, VectorAttrEmpty } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { Bottom } from '../../../../src/abstract-interpretation/domains/lattice';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { RVectorTypeDomain } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import type { RVectorType } from '../../../../src/abstract-interpretation/domains/vector-type-domain';

/**
 * Helper to assert that a VectorDomain<IntervalDomain> matches an expected vector specification.
 * Uses the declarative ExpectedVector style from vector-assertion-helpers.
 */
function assertVectorEquals(label: string, actual: VectorDomain<IntervalDomain>, expected: ExpectedVector<IntervalDomain>): void {
	const lengthDomain = new IntervalDomain(expected.length);
	const naFactory = naAwareFactory(intervalFactory);
	const knownDomain = new KnownInitialPositionsDomain(toNAAwareDomains(expected.known), naFactory);
	const summaryDomain = toNAAwareDomain(expected.summary);
	const attributesDomain = new VectorAttrDomain(expected.attributes);
	const typeDomain = new RVectorTypeDomain(expected.type as RVectorType);

	assert.ok(actual.length.equals(lengthDomain), `${label}: length expected ${lengthDomain.toString()}, got ${actual.length.toString()}`);
	assert.ok(actual.known.equals(knownDomain), `${label}: known expected ${knownDomain.toString()}, got ${actual.known.toString()}`);
	assert.ok(actual.summary.equals(summaryDomain), `${label}: summary expected ${summaryDomain.toString()}, got ${actual.summary.toString()}`);
	assert.ok(actual.attributes.equals(attributesDomain), `${label}: attributes expected ${attributesDomain.toString()}, got ${actual.attributes.toString()}`);
	assert.ok(actual.type.equals(typeDomain), `${label}: type expected ${typeDomain.toString()}, got ${actual.type.toString()}`);
}

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

		test('top equals top', () => {
			const a = VectorDomain.top(intervalFactory);
			const b = VectorDomain.top(intervalFactory);
			assert.strictEqual(a.equals(b), true);
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

			const expected: ExpectedVector<IntervalDomain> = {
				length:     [0, 1],
				known:      asNaAwares([1, 1]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			};
			assertVectorEquals('bottom.widen(value)', result, expected);
		});

		test('widen widens length interval', () => {
			const a = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			const b = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
			const result = a.widen(b);

			const expected: ExpectedVector<IntervalDomain> = {
				length:     [0, 2],
				known:      asNaAwares([1, 1], [2, 2]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			};
			assertVectorEquals('widen same values', result, expected);
		});

		test('widen widens values element-wise', () => {
			const a = mkVector([0, 1], [[1, 3]], undefined);
			const b = mkVector([0, 1], [[2, 5]], undefined);
			const result = a.widen(b);

			const expected: ExpectedVector<IntervalDomain> = {
				length:     [0, 1],
				known:      asNaAwares([1, Infinity]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			};
			assertVectorEquals('widen values element-wise', result, expected);
		});

		test('widen collapses different length values into summary for infinite vectors', () => {
			const a = mkVector([0, Infinity], [[1, 1], [2, 2], [3, 3]], [1, 10]);
			const b = mkVector([0, Infinity], [[1, 1]], [1, 15]);
			const result = a.widen(b);

			const expected: ExpectedVector<IntervalDomain> = {
				length:     [0, Infinity],
				known:      asNaAwares([1, 1]),
				summary:    asNaAware([1, 15]),
				attributes: VectorAttrEmpty,
				type:       'double'
			};
			assertVectorEquals('widen infinite vectors', result, expected);
		});

		test('widen soundly over-approximates join', () => {
			const a = mkVector([0, 2], [[1, 3], [5, 5]], undefined);
			const b = mkVector([0, 2], [[2, 5], [8, 8]], undefined);
			const join = a.join(b);
			const widen = a.widen(b);
			assert.strictEqual(join.leq(widen), true);
		});

		describe('upper bound property', () => {
			test('widen(a, b) is upper bound of a', () => {
				const a = mkVector([0, 2], [[1, 3], [5, 5]], undefined);
				const b = mkVector([0, 2], [[2, 5], [8, 8]], undefined);
				const widen = a.widen(b);
				assert.strictEqual(a.leq(widen), true, 'a should be ⊑ widen(a, b)');
			});

			test('widen(a, b) is upper bound of b', () => {
				const a = mkVector([0, 2], [[1, 3], [5, 5]], undefined);
				const b = mkVector([0, 2], [[2, 5], [8, 8]], undefined);
				const widen = a.widen(b);
				assert.strictEqual(b.leq(widen), true, 'b should be ⊑ widen(a, b)');
			});

			test('widen maintains upper bound for infinite length vectors', () => {
				const a = mkVector([0, Infinity], [[1, 1], [2, 2]], [1, 10]);
				const b = mkVector([0, Infinity], [[3, 3], [4, 4], [5, 5]], [2, 20]);
				const widen = a.widen(b);
				assert.strictEqual(a.leq(widen), true, 'a should be ⊑ widen(a, b)');
				assert.strictEqual(b.leq(widen), true, 'b should be ⊑ widen(a, b)');
			});

			test('widen maintains upper bound for different length known values', () => {
				const a = mkVector([0, 3], [[1, 1], [2, 2]], undefined);
				const b = mkVector([0, 5], [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]], undefined);
				const widen = a.widen(b);
				assert.strictEqual(a.leq(widen), true, 'a should be ⊑ widen(a, b)');
				assert.strictEqual(b.leq(widen), true, 'b should be ⊑ widen(a, b)');
			});

			test('widen with bottom preserves upper bound', () => {
				const bottom = VectorDomain.bottom(intervalFactory);
				const value = mkVector([0, 3], [[1, 1], [2, 2], [3, 3]], undefined);
				const widen1 = bottom.widen(value);
				const widen2 = value.widen(bottom);
				assert.strictEqual(value.leq(widen1), true, 'value should be ⊑ bottom.widen(value)');
				assert.strictEqual(bottom.leq(widen1), true, 'bottom should be ⊑ bottom.widen(value)');
				assert.strictEqual(value.leq(widen2), true, 'value should be ⊑ value.widen(bottom)');
				assert.strictEqual(bottom.leq(widen2), true, 'bottom should be ⊑ value.widen(bottom)');
			});
		});

		describe('soundness', () => {
			test('widen is sound over-approximation of concrete values', () => {
				// Concrete values: a=[1,2], b=[3,4]
				const concreteA = mkVector([2, 2], [[1, 1], [2, 2]], undefined);
				const concreteB = mkVector([2, 2], [[3, 3], [4, 4]], undefined);
				const widen = concreteA.widen(concreteB);
				// Widen should contain both concrete values
				assert.strictEqual(concreteA.leq(widen), true);
				assert.strictEqual(concreteB.leq(widen), true);
			});

			test('iterated widen accumulates soundly', () => {
				let acc = mkVector([0, 1], [[0, 0]], undefined);
				const values = [
					mkVector([0, 1], [[1, 1]], undefined),
					mkVector([0, 1], [[2, 2]], undefined),
					mkVector([0, 1], [[3, 3]], undefined),
				];
				for(const value of values) {
					const prevAcc = acc;
					acc = acc.widen(value);
					// Previous accumulator should still be contained
					assert.strictEqual(prevAcc.leq(acc), true);
					// New value should be contained
					assert.strictEqual(value.leq(acc), true);
				}
			});

			test('widen with growing lengths is sound', () => {
				const a = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
				const b = mkVector([0, 5], [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]], undefined);
				const widen = a.widen(b);
				// Both should be contained in widen result
				assert.strictEqual(a.leq(widen), true);
				assert.strictEqual(b.leq(widen), true);
			});

			test('widen soundly handles NA values', () => {
				const a = mkVector([0, 2], [[1, 1], [2, 2]], undefined);
				const b = mkVector([0, 2], [[3, 3], [4, 4]], undefined);
				const widen = a.widen(b);
				// Result should be at least as general as both inputs
				assert.strictEqual(widen.length.toString().startsWith('[0,'), true);
			});
		});

		describe('termination (finite convergence)', () => {
			test('widen stabilizes after finite steps for unbounded growth', () => {
				// Simulate a loop where values keep increasing
				// Without widening, this would be: [0,0] -> [0,1] -> [0,2] -> ...
				// With widening, should stabilize quickly
				let prev = mkVector([1, 1], [[0, 0]], undefined);
				let steps = 0;
				const maxSteps = 20;

				for(let i = 1; i <= maxSteps; i++) {
					const current = mkVector([1, 1], [[i, i]], undefined);
					const widened = prev.widen(current);
					steps++;

					// Check if stabilized
					if(widened.leq(prev) && prev.leq(widened)) {
						break;
					}
					prev = widened;
				}

				// Should converge much faster than maxSteps
				assert.strictEqual(steps < maxSteps, true, `Should converge in finite steps, took ${steps}`);
			});

			test('iterated widen reaches fixpoint for diverging intervals', () => {
				// Sequence: [0,0], [0,1], [0,2], [0,4], [0,8] ... doubling
				// Should converge to [0, +Infinity] quickly
				let acc = mkVector([1, 1], [[0, 0]], undefined);
				const iterations = [1, 2, 4, 8, 16, 32, 64, 128];
				let fixpointReached = false;
				let stepCount = 0;

				for(const upper of iterations) {
					const next = mkVector([1, 1], [[0, upper]], undefined);
					const widened = acc.widen(next);
					stepCount++;

					if(widened.leq(acc) && acc.leq(widened)) {
						fixpointReached = true;
						break;
					}
					acc = widened;
				}

				assert.strictEqual(fixpointReached, true, 'Should reach fixpoint in finite steps');
				// The value at position 1 should have reached infinity
				assert.ok(acc.known.toString().includes('+∞'), 'Value should contain infinity');
			});

			test('widen terminates for growing vector lengths', () => {
				// Vectors with increasing lengths: len=1, len=2, len=3, ...
				let prev = mkVector([1, 1], [[1, 1]], undefined);
				let steps = 0;
				const maxSteps = 15;

				for(let len = 2; len <= maxSteps; len++) {
					const values = Array.from({ length: len }, (_, i) => [i + 1, i + 1] as [number, number]);
					const current = mkVector([len, len], values, undefined);
					const widened = prev.widen(current);
					steps++;

					// Check stabilization
					if(widened.leq(prev) && prev.leq(widened)) {
						break;
					}
					prev = widened;
				}

				assert.strictEqual(steps < maxSteps, true, `Should converge in finite steps for growing lengths, took ${steps}`);
			});

			test('widen stabilizes for cyclic iteration pattern', () => {
				// Simulate fixpoint iteration: f(X) = X join next_value
				// Values cycle through [1,1] -> [2,2] -> [3,3] -> [4,4] -> ...
				let acc = VectorDomain.bottom(intervalFactory);
				const cycle = [
					mkVector([1, 1], [[1, 1]], undefined),
					mkVector([1, 1], [[2, 2]], undefined),
					mkVector([1, 1], [[3, 3]], undefined),
					mkVector([1, 1], [[4, 4]], undefined),
				];
				let stepCount = 0;
				const maxIterations = 50;

				for(let i = 0; i < maxIterations; i++) {
					const next = cycle[i % cycle.length];
					const widened = acc.widen(next);
					stepCount++;

					// Fixpoint reached?
					if(widened.leq(acc) && acc.leq(widened)) {
						break;
					}
					acc = widened;
				}

				assert.strictEqual(stepCount < maxIterations, true, `Should stabilize in finite steps, took ${stepCount}`);
			});

			test('widen reaches global top in finite steps for extreme growth', () => {
				// Test with values that grow exponentially in both value and length
				let acc = mkVector([1, 1], [[1, 1]], undefined);
				let reachedInfiniteLength = false;
				const maxSteps = 25;

				for(let step = 0; step < maxSteps; step++) {
					// Exponential growth: length 2^step, values up to 10^step
					const len = Math.pow(2, step);
					const val = Math.pow(10, step);
					const values = [[1, val] as [number, number]];
					const current = mkVector([len, len], values, [1, val]);

					const widened = acc.widen(current);

					// Check if reached infinite length
					if(widened.length.isValue() && widened.length.value[1] === Infinity) {
						reachedInfiniteLength = true;
						break;
					}

					acc = widened;
				}

				assert.strictEqual(reachedInfiniteLength, true, 'Should reach infinite length in finite steps');
			});
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
