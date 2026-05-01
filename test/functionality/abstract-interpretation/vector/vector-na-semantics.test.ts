import { describe, test, assert } from 'vitest';
import './log-config';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { withShell } from '../../_helper/shell';
import { getVectorForCriterion } from '../_helper/vector-inference-helpers';
import { intervalFactory, naAwareIntervalFactory, createNAAwareVector, createPureNAVector, assertContainsNA } from '../_helper/vector-na-creation-helpers';
import type { ValueToDomainConverter } from '../../../../src/abstract-interpretation/vector/resolve-vector-args';
import { NA, Top } from '../../../../src/abstract-interpretation/domains/lattice';
import { adjustForZeros, propagate } from '../../../../src/abstract-interpretation/vector/vector-semantics';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { RVectorTypeDomain } from '../../../../src/abstract-interpretation/domains/vector-type-domain';

const naValueToDomain: ValueToDomainConverter<IntervalDomain> = (value) => {
	if(typeof value === 'number') {
		return new Set([value]);
	}
	return undefined;
};

describe.sequential('NA-Aware Vector Semantics Integration Tests', withShell(shell => {
	describe('Vector Creation with NA', () => {
		test('c(1, NA, 3) creates vector with NA', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, NA, 3)', '1@x', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('c(NA) creates pure NA vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(NA)', '1@x', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('c(1, 2, 3) creates vector without NA', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, 2, 3)', '1@x', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('c() empty vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c()', '1@x', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('mixed vector with multiple NAs', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, NA, 3, NA, 5)', '1@x', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});
	});

	describe('Binary Operations with NA Recycling', () => {
		test('addition with NA: c(1, 2) + c(NA, 4)', async() => {
			const code = `x <- c(1, 2)
y <- c(NA, 4)
z <- x + y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('recycling with NA: c(1, 2, 3) + NA', async() => {
			const code = `x <- c(1, 2, 3)
y <- x + NA`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('no NA when both operands have no NA', async() => {
			const code = `x <- c(1, 2, 3)
y <- c(4, 5, 6)
z <- x + y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('subtraction with NA recycling', async() => {
			const code = `x <- c(10, 20, 30, 40)
y <- c(NA, 1)
z <- x - y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('multiplication with NA in longer vector', async() => {
			const code = `x <- c(1, NA, 3, 4)
y <- c(2, 2)
z <- x * y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});
	});

	describe('Vector Selection with NA Indices', () => {
		test.skip('selection with NA index: x[c(1, NA, 3)]', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, NA, 3)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});

		test.skip('selection without NA in indices', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, 3, 5)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});

		test.skip('single NA selection: x[NA]', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[NA]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});

		test.skip('selection with logical vector containing NA', async() => {
			const code = `x <- c(10, 20, 30, 40)
y <- x[c(TRUE, NA, FALSE, TRUE)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});
	});

	describe('Vector Update with NA Indices', () => {
		test('update with NA index: x[c(1, NA)] <- 99', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
x[c(1, NA)] <- 99`;
			const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, naValueToDomain);
			assertContainsNA(vector, false);
		});

		test('update with NA value: x[1] <- NA', async() => {
			const code = `x <- c(1, 2, 3)
x[1] <- NA`;
			const vector = await getVectorForCriterion(shell, code, '2@x', intervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});

		test('update without NA', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
x[c(1, 3)] <- c(10, 30)`;
			const vector = await getVectorForCriterion(shell, code, '2@x', intervalFactory, naValueToDomain);
			assertContainsNA(vector, false);
		});
	});

	describe('Chained Operations with NA', () => {
		test('chained operations propagate NA', async() => {
			const code = `a <- c(1, NA, 3)
b <- c(4, 5, 6)
c <- a + b
d <- c * 2`;
			const vector = await getVectorForCriterion(shell, code, '4@d', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('selection after arithmetic with NA', async() => {
			const code = `a <- c(1, NA, 3, 4)
b <- a + 10
c <- b[c(1, 2)]`;
			const vector = await getVectorForCriterion(shell, code, '3@c', intervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});
	});

	describe('Edge Cases', () => {
		test('all NA vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(NA, NA, NA)', '1@x', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('no NA in empty vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c()', '1@x', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('single element without NA', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(42)', '1@x', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('large vector with scattered NA values', async() => {
			const code = 'x <- c(1, 2, NA, 4, 5, NA, 7, 8, 9, NA)';
			const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});
	});
}));

describe('NA-Aware Vector Semantics Unit Tests', () => {
	describe('Domain Factory', () => {
		test('naAwareIntervalFactory creates Top element', () => {
			const top = naAwareIntervalFactory(Top);
			assert.strictEqual(top.isTop(), true);
			assert.strictEqual(top.containsNA(), true);
		});

		test('naAwareIntervalFactory creates value without NA', () => {
			const domain = naAwareIntervalFactory(new Set([1, 2, 3]));
			assert.strictEqual(domain.isValue(), true);
			assert.strictEqual(domain.containsNA(), false);
		});

		test('naAwareIntervalFactory creates value with NA', () => {
			const domain = naAwareIntervalFactory(new Set([1, 2, NA]));
			assert.strictEqual(domain.isValue(), true);
			assert.strictEqual(domain.containsNA(), true);
		});
	});

	describe('Helper Functions', () => {
		test('createNAAwareVector creates vector with correct structure', () => {
			const vector = createNAAwareVector(
				[3, 3],
				[
					{ range: [1, 1], hasNA: false },
					{ range: [2, 2], hasNA: true },
					{ range: [3, 3], hasNA: false }
				]
			);

			assert.strictEqual(vector.length.isValue(), true);
			if(vector.length.isValue()) {
				assert.deepStrictEqual(vector.length.value, [3, 3]);
			}
			assert.strictEqual(vector.known.isValue(), true);
			if(vector.known.isValue()) {
				const vals = vector.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 3);
				assert.strictEqual(vals[0].containsNA(), false);
				assert.strictEqual(vals[1].containsNA(), true);
				assert.strictEqual(vals[2].containsNA(), false);
			}
		});

		test('createPureNAVector creates vector with NA in all positions', () => {
			const vector = createPureNAVector([2, 2]);
			assert.strictEqual(vector.length.isValue(), true);
			if(vector.length.isValue()) {
				assert.deepStrictEqual(vector.length.value, [2, 2]);
			}
			assertContainsNA(vector, true);
		});
	});

	describe('NA Propagation in Vector Operations', () => {
		test('squash operation preserves NA flag', () => {
			const vector = createNAAwareVector(
				[3, 3],
				[
					{ range: [1, 1], hasNA: false },
					{ range: [2, 2], hasNA: true },
					{ range: [3, 3], hasNA: false }
				]
			);

			if(vector.known.isValue()) {
				const vals = vector.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals[1].containsNA(), true);
				assert.strictEqual(vals[1].isNA(), false);
			}
		});

		test('join operation propagates NA flags', () => {
			const v1 = createNAAwareVector(
				[2, 2],
				[
					{ range: [1, 1], hasNA: false },
					{ range: [2, 2], hasNA: false }
				]
			);
			const v2 = createNAAwareVector(
				[2, 2],
				[
					{ range: [1, 1], hasNA: true },
					{ range: [2, 2], hasNA: false }
				]
			);

			const joined = v1.join(v2);
			assert.ok(joined.isValue());
			assertContainsNA(joined, true);
		});
	});

	describe('adjustForZeros', () => {
		test('empty vector returns unchanged', () => {
			const vector = createNAAwareVector(
				[0, 0],
				[]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [0, 0]);
			}
		});

		test('vector with no zeros returns unchanged length', () => {
			const vector = createNAAwareVector(
				[3, 3],
				[
					{ range: [1, 1], hasNA: false },
					{ range: [2, 2], hasNA: false },
					{ range: [3, 3], hasNA: false }
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [3, 3]);
			}
			// Known positions should be preserved
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 3);
			}
		});

		test('vector with definite zeros adjusts length and removes zeros', () => {
			const vector = createNAAwareVector(
				[4, 4],
				[
					{ range: [0, 0], hasNA: false },  // definite zero
					{ range: [0, 0], hasNA: false },  // definite zero
					{ range: [1, 1], hasNA: false },  // non-zero
					{ range: [2, 2], hasNA: false }   // non-zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// Length should be [2, 2] (4 - 2 definite zeros for upper, 4 - 2 possible zeros for lower)
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [2, 2]);
			}
			// Known positions: only non-bottom results included (2 out of 4)
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 2);
				// Position 2 (original): after skipping 2 zeros, should get value [1,1]
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [1, 1]);
				}
				// Position 3 (original): after skipping 2 zeros, should get value [2,2]
				assert.strictEqual(vals[1].inner.isValue(), true);
				if(vals[1].inner.isValue()) {
					assert.deepStrictEqual(vals[1].inner.value, [2, 2]);
				}
			}
		});

		test('vector with possible zeros (interval containing 0) adjusts bounds', () => {
			const vector = createNAAwareVector(
				[3, 3],
				[
					{ range: [-1, 1], hasNA: false },  // possible zero (contains 0)
					{ range: [2, 2], hasNA: false },   // non-zero
					{ range: [3, 3], hasNA: false }    // non-zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// l' = 3 - 1 (possible zero) = 2, u' = 3 - 0 (no definite zeros) = 3
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [2, 3]);
			}
		});

		test('vector with mix of definite and possible zeros', () => {
			const vector = createNAAwareVector(
				[5, 5],
				[
					{ range: [0, 0], hasNA: false },   // definite zero
					{ range: [-1, 1], hasNA: false },  // possible zero
					{ range: [0, 0], hasNA: false },   // definite zero
					{ range: [2, 2], hasNA: false },   // non-zero
					{ range: [3, 3], hasNA: false }    // non-zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// definiteZeros = 2, possibleZeros = 3
			// l' = 5 - 3 = 2, u' = 5 - 2 = 3
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [2, 3]);
			}
		});

		test('single zero returns empty selector', () => {
			const vector = createNAAwareVector(
				[1, 1],
				[
					{ range: [0, 0], hasNA: false }  // single definite zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// l' = 1 - 1 = 0, u' = 1 - 1 = 0
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [0, 0]);
			}
		});

		test('propagates values through zeros', () => {
			const vector = createNAAwareVector(
				[4, 4],
				[
					{ range: [0, 0], hasNA: false },  // zero
					{ range: [0, 0], hasNA: false },  // zero
					{ range: [5, 5], hasNA: false },  // non-zero
					{ range: [6, 6], hasNA: false }   // non-zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				// Position 0: d=0,p=0, definite zeros continue, then [5,5] with d=0,p=0 returns [5,5]
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [5, 5]);
				}
				// Position 1: d=1 (one zero before), propagate([0,0,5,6], summary, {d:1,p:0})
				//   definite zeros continue, then [5,5] consumes d→0, continues to [6,6]
				//   [6,6] with d=0,p=0 returns [6,6]
				assert.strictEqual(vals[1].inner.isValue(), true);
				if(vals[1].inner.isValue()) {
					assert.deepStrictEqual(vals[1].inner.value, [6, 6]);
				}
			}
		});



		test('handles NA in positions (not treated as zeros)', () => {
			const vector = createNAAwareVector(
				[3, 3],
				[
					{ range: [0, 0], hasNA: true },   // zero with NA
					{ range: [1, 1], hasNA: false },  // non-zero
					{ range: [2, 2], hasNA: false }   // non-zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// NA with [0,0] should still be counted as definite zero
			// l' = 3 - 1 = 2, u' = 3 - 1 = 2
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [2, 2]);
			}
		});

		test('updates length bounds correctly with infinity', () => {
			const vector = createNAAwareVector(
				[2, Infinity],
				[
					{ range: [0, 0], hasNA: false },  // definite zero
					{ range: [1, 1], hasNA: false }   // non-zero
				],
				{ range: [5, 5], hasNA: false }  // summary for infinite part
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// l' = 2 - 1 = 1, u' = Infinity - 1 = Infinity
			if(result.length.isValue()) {
				assert.strictEqual(result.length.value[0], 1);
				assert.strictEqual(result.length.value[1], Infinity);
			}
		});

		test('propagate function with empty positions returns summary', () => {
			const summary = new NAAwareDomain(
				{ inner: new IntervalDomain([10, 10]), hasNA: false },
				intervalFactory
			);
			const result = propagate([], summary, { definite: 0, possible: 0 });

			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.deepStrictEqual(result.inner.value, [10, 10]);
			}
		});

		test('propagate function skips definite zeros', () => {
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([0, 0]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 0, possible: 0 });

			// Should skip the zero and return [5, 5]
			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.deepStrictEqual(result.inner.value, [5, 5]);
			}
		});

		test('propagate function continues with may-contain-zero positions', () => {
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([-1, 1]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 0, possible: 0 });

			// [-1,1] may contain zero, so we continue without joining
			// Then [5,5] with d=0,p=0 returns [5,5]
			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.strictEqual(result.inner.value[0], 5);
				assert.strictEqual(result.inner.value[1], 5);
			}
		});

		test('bottom vector returns bottom', () => {
			const bottomVector = VectorDomain.bottom(intervalFactory);
			const result = adjustForZeros(bottomVector);

			assert.strictEqual(result.isBottom(), true);
		});

		test('top vector returns top', () => {
			const topVector = VectorDomain.top(intervalFactory);
			const result = adjustForZeros(topVector);

			assert.strictEqual(result.isTop(), true);
		});

		test('vector with top known positions but finite length returns empty known', () => {
			// Construct a vector where known positions is Top (empty array) but length is finite
			const len = new PosIntervalDomain([3, 3]);
			const knownTop = KnownInitialPositionsDomain.top<NAAwareDomain<IntervalDomain>>(
				NAAwareDomain.createSmartFactory(intervalFactory)
			);
			const summary = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: false }, intervalFactory);
			const vector = new VectorDomain({
				length:     len,
				known:      knownTop,
				summary:    summary,
				attributes: VectorAttrDomain.bottom(),
				type:       RVectorTypeDomain.bottom()
			}, intervalFactory);

			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// Length unchanged since no zeros were found in empty known positions
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [3, 3]);
			}
			// Known positions should be empty (Top known positions produce no propagated values)
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 0);
			}
		});

		test('vector with bottom known positions but finite length returns empty known', () => {
			// Construct a vector where known positions is Bottom but length is finite
			const len = new PosIntervalDomain([3, 3]);
			const knownBottom = KnownInitialPositionsDomain.bottom<NAAwareDomain<IntervalDomain>>(
				NAAwareDomain.createSmartFactory(intervalFactory)
			);
			const summary = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: false }, intervalFactory);
			const vector = new VectorDomain({
				length:     len,
				known:      knownBottom,
				summary:    summary,
				attributes: VectorAttrDomain.bottom(),
				type:       RVectorTypeDomain.bottom()
			}, intervalFactory);

			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// Length unchanged since no zeros were found (bottom known positions are skipped)
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [3, 3]);
			}
			// Known positions should be empty (bottom known positions produce no propagated values)
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 0);
			}
		});

		test('length is top value processes normally (PosIntervalDomain.top is [0, +∞])', () => {
			const knownPositions = new KnownInitialPositionsDomain(
				[
					new NAAwareDomain({ inner: new IntervalDomain([1, 1]), hasNA: false }, intervalFactory),
					new NAAwareDomain({ inner: new IntervalDomain([2, 2]), hasNA: false }, intervalFactory)
				],
				NAAwareDomain.createSmartFactory(intervalFactory)
			);
			const summary = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: false }, intervalFactory);
			const vector = new VectorDomain({
				length:     PosIntervalDomain.top(),
				known:      knownPositions,
				summary:    summary,
				attributes: VectorAttrDomain.bottom(),
				type:       RVectorTypeDomain.bottom()
			}, intervalFactory);

			const result = adjustForZeros(vector);

			// PosIntervalDomain.top() is [0, +∞] which IS a value, so adjustForZeros processes normally
			assert.ok(result.isValue());
			// No zeros in known positions, so length unchanged: [0, +∞]
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [0, +Infinity]);
			}
		});

		test('length is bottom returns top vector', () => {
			// Construct a vector where length is Bottom but vector is not Bottom
			const knownPositions = new KnownInitialPositionsDomain(
				[
					new NAAwareDomain({ inner: new IntervalDomain([1, 1]), hasNA: false }, intervalFactory)
				],
				NAAwareDomain.createSmartFactory(intervalFactory)
			);
			const summary = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: false }, intervalFactory);
			const vector = new VectorDomain({
				length:     PosIntervalDomain.bottom(),
				known:      knownPositions,
				summary:    summary,
				attributes: VectorAttrDomain.bottom(),
				type:       RVectorTypeDomain.bottom()
			}, intervalFactory);

			const result = adjustForZeros(vector);

			// When length is not a value, adjustForZeros returns top()
			assert.strictEqual(result.isTop(), true);
		});

		test('all definite zeros become empty vector', () => {
			const vector = createNAAwareVector(
				[3, 3],
				[
					{ range: [0, 0], hasNA: false },  // definite zero
					{ range: [0, 0], hasNA: false },  // definite zero
					{ range: [0, 0], hasNA: false }   // definite zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// l' = 3 - 3 = 0, u' = 3 - 3 = 0
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [0, 0]);
			}
			// All positions propagate to bottom (summary is bottom for finite vectors), so known is empty
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 0);
			}
		});

		test('propagate join branch: non-zero with d=0 and p>0 joins with rest', () => {
			// Vector: [-1,1] (possible zero), [5,5] (non-zero), [6,6] (non-zero)
			// For position 1: definiteBefore=0, possibleBefore=1
			// propagate([[5,5], [6,6]], bottom, {0,1}) should join [5,5] with propagate([[6,6]], bottom, {0,0})
			const vector = createNAAwareVector(
				[3, 3],
				[
					{ range: [-1, 1], hasNA: false },  // possible zero
					{ range: [5, 5], hasNA: false },   // non-zero
					{ range: [6, 6], hasNA: false }    // non-zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// l' = 3 - 1 = 2, u' = 3 - 0 = 3
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [2, 3]);
			}
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 3);
				// Position 0: propagate skips [-1,1] (possible zero), returns [5,5]
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [5, 5]);
				}
				// Position 1: propagate with {d:0, p:1} joins [5,5] with propagate([[6,6]], {d:0, p:0})=[6,6]
				// [5,5] join [6,6] = [5,6]
				assert.strictEqual(vals[1].inner.isValue(), true);
				if(vals[1].inner.isValue()) {
					assert.deepStrictEqual(vals[1].inner.value, [5, 6]);
				}
				// Position 2: propagate with {d:0, p:1} joins [6,6] with propagate([], {d:0, p:0})=bottom
				// [6,6] join bottom = [6,6]
				assert.strictEqual(vals[2].inner.isValue(), true);
				if(vals[2].inner.isValue()) {
					assert.deepStrictEqual(vals[2].inner.value, [6, 6]);
				}
			}
		});

		test('propagate reaches summary at end with infinite vector', () => {
			// Vector with finite known positions and valorized summary
			// When propagate reaches end of known positions, it should return summary
			const vector = createNAAwareVector(
				[2, Infinity],
				[
					{ range: [0, 0], hasNA: false },  // definite zero
					{ range: [0, 0], hasNA: false }   // definite zero
				],
				{ range: [10, 10], hasNA: false }  // summary for infinite part
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// l' = 2 - 2 = 0, u' = Infinity - 2 = Infinity
			if(result.length.isValue()) {
				assert.strictEqual(result.length.value[0], 0);
				assert.strictEqual(result.length.value[1], Infinity);
			}
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 2);
				// Position 0: propagate skips both zeros, reaches end, returns summary [10,10]
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [10, 10]);
				}
				// Position 1: propagate skips one zero, reaches end, returns summary [10,10]
				assert.strictEqual(vals[1].inner.isValue(), true);
				if(vals[1].inner.isValue()) {
					assert.deepStrictEqual(vals[1].inner.value, [10, 10]);
				}
			}
		});

		test('multiple consecutive zeros before value propagates correctly', () => {
			// Vector: [0,0], [0,0], [0,0], [5,5] with length [4,4]
			// After adjustForZeros, position 0 should get [5,5] (skipping 3 zeros)
			const vector = createNAAwareVector(
				[4, 4],
				[
					{ range: [0, 0], hasNA: false },  // definite zero
					{ range: [0, 0], hasNA: false },  // definite zero
					{ range: [0, 0], hasNA: false },  // definite zero
					{ range: [5, 5], hasNA: false }   // non-zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// l' = 4 - 3 = 1, u' = 4 - 3 = 1
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [1, 1]);
			}
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 1);
				// Only original position 0 propagates to non-bottom (skips all 3 zeros, returns [5,5])
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [5, 5]);
				}
			}
		});

		test('mixed NA flags with definite zeros removes zeros correctly', () => {
			// Vector: zero with hasNA=true, non-zero with hasNA=false
			// Zeros should be removed even with NA flag
			const vector = createNAAwareVector(
				[3, 3],
				[
					{ range: [0, 0], hasNA: true },   // definite zero with NA
					{ range: [5, 5], hasNA: false },  // non-zero without NA
					{ range: [0, 0], hasNA: true }    // definite zero with NA
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// definiteZeros = 2 (zeros at positions 0 and 2, NA flag doesn't matter), possibleZeros = 0
			// l' = 3 - 2 = 1, u' = 3 - 2 = 1
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [1, 1]);
			}
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 1);
				// Only original position 0 propagates to non-bottom
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [5, 5]);
				}
				// Position 0 hasNA should be false (the value [5,5] has hasNA:false)
				assert.strictEqual(vals[0].containsNA(), false);
			}
		});

		test('propagate with definite counter consumes zeros correctly', () => {
			// Direct test of propagate with definite > 0
			// Counters: {d:2, p:0} means "2 definite zeros were before this position"
			// Position: [5,5] is a non-zero value
			// [5,5] with d=2>0 → consume → propagate([], summary, {d:1, p:0}) → summary (bottom)
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 2, possible: 0 });

			// Consumes 1 from definite counter, recurses with empty positions → returns bottom summary
			assert.strictEqual(result.isBottom(), true);
		});

		test('propagate with possible counter joins correctly', () => {
			// Direct test of propagate with possible > 0 and non-zero first element
			// Vector: [5,5], [6,6] with counters {definite: 0, possible: 1}
			// Should join [5,5] with propagate([[6,6]], {0,0}) = [6,6]
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([6, 6]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 0, possible: 1 });

			// [5,5] join [6,6] = [5,6]
			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.deepStrictEqual(result.inner.value, [5, 6]);
			}
		});

		test('propagate with IntervalDomain.top() inner is treated as possible zero', () => {
			// When inner is [-∞,+∞] (isValue=true), l=-∞ <= 0 and u=+∞ >= 0, so it's treated as a possible zero
			// → skipped → next position [5,5] with d=0,p=0 → returns [5,5]
			const positions = [
				NAAwareDomain.top(intervalFactory) as NAAwareDomain<IntervalDomain>,
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 0, possible: 0 });

			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.deepStrictEqual(result.inner.value, [5, 5]);
			}
		});

		test('propagate with bottom inner value skips position', () => {
			// When inner is Bottom, isValue() returns false, so it falls through to counter check
			const positions = [
				NAAwareDomain.bottom(intervalFactory) as NAAwareDomain<IntervalDomain>,
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 0, possible: 0 });

			// Bottom is not a zero, counters are 0, so return Bottom
			assert.strictEqual(result.isBottom(), true);
		});

		test('mixed definite and possible zeros with propagation', () => {
			// Vector: [0,0] (definite), [-1,1] (possible), [0,0] (definite), [5,5] (non-zero)
			const vector = createNAAwareVector(
				[4, 4],
				[
					{ range: [0, 0], hasNA: false },   // definite zero
					{ range: [-1, 1], hasNA: false },  // possible zero
					{ range: [0, 0], hasNA: false },   // definite zero
					{ range: [5, 5], hasNA: false }    // non-zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// definiteZeros = 2, possibleZeros = 1
			// l' = 4 - 2 - 1 = 1, u' = 4 - 2 = 2
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [1, 2]);
			}
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 1);
				// Position 0: skip [0,0], [-1,1], [0,0] → [5,5] with d=0,p=0
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [5, 5]);
				}
				// Position 1: definiteBefore=1, skips [-1,1], [0,0], then [5,5] with d=1 → consume → bottom
				// Position 2: definiteBefore=1, skips [0,0], then [5,5] with d=1 → consume → bottom
				// Position 3: definiteBefore=2, [5,5] with d=2 → consume → bottom
			}
		});

		test('infinite length with possible zeros adjusts bounds correctly', () => {
			const vector = createNAAwareVector(
				[3, Infinity],
				[
					{ range: [-1, 1], hasNA: false },  // possible zero
					{ range: [0, 0], hasNA: false },   // definite zero
					{ range: [5, 5], hasNA: false }    // non-zero
				],
				{ range: [10, 10], hasNA: false }
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// definiteZeros = 1, possibleZeros = 1
			// l' = 3 - 1 - 1 = 1, u' = Infinity - 1 = Infinity
			if(result.length.isValue()) {
				assert.strictEqual(result.length.value[0], 1);
				assert.strictEqual(result.length.value[1], Infinity);
			}
		});

		test('propagate NA value is not a zero', () => {
			// NAAwareDomain.na() has inner=bottom, hasNA=true
			// It is NOT a zero — isValue() on inner returns false for bottom
			// Should be treated as not-zero, so with d=0,p=0 returns the NA
			const naVal = NAAwareDomain.na(intervalFactory) as NAAwareDomain<IntervalDomain>;
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate([naVal], summary, { definite: 0, possible: 0 });

			// NA value is not a zero, d=0,p=0 → returns the NA value
			assert.strictEqual(result.isNA(), true);
		});

		test('propagate with NA-containing non-zero value preserves hasNA flag', () => {
			// Value [5,5] with hasNA=true (may-be-NA) — not a zero, should propagate through
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: true }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 0, possible: 0 });

			// [5,5] is not a zero, d=0,p=0 → returns [5,5] with hasNA preserved
			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.deepStrictEqual(result.inner.value, [5, 5]);
			}
			assert.strictEqual(result.containsNA(), true);
		});

		test('propagate with definite counter passing through possible zero', () => {
			// Counters {d:1, p:0}, positions: [-1,1] (possible zero), [5,5] (non-zero)
			// [-1,1] is possible zero → skip → [5,5] with d=1 → consume → [] → summary(bottom)
			// This should return bottom because after consuming the definite counter, no positions remain
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([-1, 1]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 1, possible: 0 });

			assert.strictEqual(result.isBottom(), true);
		});

		test('propagate with both definite and possible counters on non-zero', () => {
			// Counters {d:1, p:1}, positions: [5,5] (non-zero)
			// [5,5] is not zero, d=1>0 → consume definite → [] with {d:0, p:1} → summary(bottom)
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 1, possible: 1 });

			assert.strictEqual(result.isBottom(), true);
		});

		test('propagate with possible counter and two non-zeros joins correctly', () => {
			// Counters {d:0, p:1}, positions: [5,5] (non-zero), [10,10] (non-zero)
			// [5,5] is not zero, d=0, p=1 → join([5,5], propagate([[10,10]], s, {0,0}))
			// = join([5,5], [10,10]) = [5,10]
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([10, 10]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 0, possible: 1 });

			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.deepStrictEqual(result.inner.value, [5, 10]);
			}
			assert.strictEqual(result.containsNA(), false);
		});

		test('propagate with possible counter through possible zero to non-zero', () => {
			// Counters {d:0, p:1}, positions: [-1,1] (possible zero), [5,5] (non-zero)
			// [-1,1] is possible zero → skip → [5,5] with d=0, p=1
			// → join([5,5], propagate([], s, {0,0}))
			// = join([5,5], bottom) = [5,5]
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([-1, 1]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 0, possible: 1 });

			// [-1,1] skip, then [5,5] with p=1 → join([5,5], bottom) = [5,5]
			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.deepStrictEqual(result.inner.value, [5, 5]);
			}
		});

		test('propagate with multiple possible counters joined', () => {
			// Counters {d:0, p:2}, positions: [5,5], [6,6], [7,7]
			// [5,5] with p=2 → join([5,5], propagate([[6,6],[7,7]], s, {0,1}))
			// propagate([[6,6],[7,7]], s, {0,1}): [6,6] with p=1 → join([6,6], propagate([[7,7]], s, {0,0}))
			//   propagate([[7,7]], s, {0,0}) = [7,7]
			//   → join([6,6], [7,7]) = [6,7]
			// → join([5,5], [6,7]) = [5,7]
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([6, 6]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([7, 7]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 0, possible: 2 });

			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.deepStrictEqual(result.inner.value, [5, 7]);
			}
			assert.strictEqual(result.containsNA(), false);
		});

		test('adjustForZeros: mixed zeros with NA flags propagate NA correctly', () => {
			// Vector: [0,0](hasNA:false), [5,5](hasNA:true), [0,0](hasNA:false), [10,10](hasNA:false)
			// definiteZeros=2, possibleZeros=0
			// Position 0: skip [0,0], [5,5] with d=0,p=0 → returns [5,5] with hasNA:true ✓
			// Position 1: [5,5] with d=1 → consume → skip [0,0], [10,10] with d=0 → returns [10,10] ✓
			// Position 2: skip [0,0], [10,10] with d=2 → consume → bottom ✗
			// Position 3: [10,10] with d=3 → consume → bottom ✗
			const vector = createNAAwareVector(
				[4, 4],
				[
					{ range: [0, 0], hasNA: false },   // definite zero
					{ range: [5, 5], hasNA: true },    // non-zero with NA flag
					{ range: [0, 0], hasNA: false },   // definite zero
					{ range: [10, 10], hasNA: false }   // non-zero without NA
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// definiteZeros=2, possibleZeros=0, l'=4-2=2, u'=4-2=2
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [2, 2]);
			}
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 2);
				// vals[0]: [5,5] with hasNA:true (from position 0, skipped first zero)
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [5, 5]);
				}
				assert.strictEqual(vals[0].containsNA(), true);
				// vals[1]: [10,10] with hasNA:false (from position 1, consumed definite counter)
				assert.strictEqual(vals[1].inner.isValue(), true);
				if(vals[1].inner.isValue()) {
					assert.deepStrictEqual(vals[1].inner.value, [10, 10]);
				}
				assert.strictEqual(vals[1].containsNA(), false);
			}
		});

		test('adjustForZeros: all possible zeros with valorized summary', () => {
			// All positions are possible zeros, with valorized summary [10,10]
			// propagate for each position reaches summary after skipping possible zeros
			const vector = createNAAwareVector(
				[3, Infinity],
				[
					{ range: [-1, 1], hasNA: false },  // possible zero
					{ range: [-1, 1], hasNA: false },  // possible zero
					{ range: [-1, 1], hasNA: false }   // possible zero
				],
				{ range: [10, 10], hasNA: false }
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// No definite zeros, 3 possible zeros
			// l' = 3 - 3 = 0, u' = Infinity - 0 = Infinity
			if(result.length.isValue()) {
				assert.strictEqual(result.length.value[0], 0);
				assert.strictEqual(result.length.value[1], Infinity);
			}
			// All propagate calls reach summary after skipping possible zeros
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 3);
				// Each position: skip all possible zeros, reaches summary [10,10]
				for(let i = 0; i < 3; i++) {
					assert.strictEqual(vals[i].inner.isValue(), true);
					if(vals[i].inner.isValue()) {
						assert.deepStrictEqual(vals[i].inner.value, [10, 10]);
					}
				}
			}
		});

		test('adjustForZeros: positive-only interval not a zero (e.g. [2,7])', () => {
			// Values like [2,7] don't contain 0 at all — definite non-zeros
			const vector = createNAAwareVector(
				[3, 3],
				[
					{ range: [2, 7], hasNA: false },   // non-zero (positive only)
					{ range: [10, 10], hasNA: false },  // non-zero
					{ range: [3, 5], hasNA: false }     // non-zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// No zeros at all, length unchanged
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [3, 3]);
			}
			// All positions preserved
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 3);
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [2, 7]);
				}
				assert.strictEqual(vals[1].inner.isValue(), true);
				if(vals[1].inner.isValue()) {
					assert.deepStrictEqual(vals[1].inner.value, [10, 10]);
				}
				assert.strictEqual(vals[2].inner.isValue(), true);
				if(vals[2].inner.isValue()) {
					assert.deepStrictEqual(vals[2].inner.value, [3, 5]);
				}
			}
		});

		test('adjustForZeros: negative-only interval not a zero (e.g. [-10,-5])', () => {
			// Values like [-10,-5] don't contain 0 at all — definite non-zeros
			const vector = createNAAwareVector(
				[2, 2],
				[
					{ range: [-10, -5], hasNA: false },  // non-zero (negative only)
					{ range: [-3, -1], hasNA: false }    // non-zero (negative only)
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// No zeros, length unchanged
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [2, 2]);
			}
			// All positions preserved
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 2);
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [-10, -5]);
				}
				assert.strictEqual(vals[1].inner.isValue(), true);
				if(vals[1].inner.isValue()) {
					assert.deepStrictEqual(vals[1].inner.value, [-3, -1]);
				}
			}
		});

		test('adjustForZeros: sparse zeros pattern', () => {
			// Zeros mixed throughout: [0,0], [5,5], [0,0], [20,20], [0,0], [30,30]
			// definiteZeros=3
			// Position 0: skip [0,0], [5,5] with d=0 → returns [5,5] ✓
			// Position 1: [5,5] with d=1 → consume → skip [0,0], [20,20] with d=0 → returns [20,20] ✓
			// Position 2: skip [0,0], [20,20] with d=2 → consume → skip [0,0], [30,30] with d=1 → consume → bottom ✗
			// Position 3: [20,20] with d=3 → consume → skip [0,0], [30,30] with d=2 → consume → bottom ✗
			// Position 4: skip [0,0], [30,30] with d=4 → consume → bottom ✗
			// Position 5: [30,30] with d=5 → consume → bottom ✗
			const vector = createNAAwareVector(
				[6, 6],
				[
					{ range: [0, 0], hasNA: false },    // definite zero
					{ range: [5, 5], hasNA: false },    // non-zero
					{ range: [0, 0], hasNA: false },    // definite zero
					{ range: [20, 20], hasNA: false },   // non-zero
					{ range: [0, 0], hasNA: false },    // definite zero
					{ range: [30, 30], hasNA: false }    // non-zero
				]
			);
			const result = adjustForZeros(vector);

			assert.ok(result.isValue());
			// definiteZeros=3, l'=6-3=3, u'=6-3=3
			if(result.length.isValue()) {
				assert.deepStrictEqual(result.length.value, [3, 3]);
			}
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 3);
				// vals[0]: [5,5] (from position 0, skipped first zero)
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [5, 5]);
				};
				// vals[1]: [20,20] (from position 1, consumed definite counter)
				assert.strictEqual(vals[1].inner.isValue(), true);
				if(vals[1].inner.isValue()) {
					assert.deepStrictEqual(vals[1].inner.value, [20, 20]);
				};
				// vals[2]: [30,30] (from position 2, consumed definite counters)
				assert.strictEqual(vals[2].inner.isValue(), true);
				if(vals[2].inner.isValue()) {
					assert.deepStrictEqual(vals[2].inner.value, [30, 30]);
				};
			}
		});

		test('propagate: IntervalDomain.top() inner with nonzero counters', () => {
			// Counter {d:1, p:0}, positions: [IntervalTop, [5,5]]
			// IntervalTop is [-∞,+∞], isValue=true, l=-∞<=0 && u=+∞>=0 → possible zero → skip
			// [5,5] with d=1 → consume → [] → summary(bottom)
			const topElement = NAAwareDomain.top(intervalFactory) as NAAwareDomain<IntervalDomain>;
			const positions = [
				topElement,
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, { definite: 1, possible: 0 });

			assert.strictEqual(result.isBottom(), true);
		});
	});
});
