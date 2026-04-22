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
			const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});

		test('update without NA', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
x[c(1, 3)] <- c(10, 30)`;
			const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
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
			assertContainsNA(vector, true);
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
			// Known positions should have propagated values past zeros
			if(result.known.isValue()) {
				const vals = result.known.value as readonly NAAwareDomain<IntervalDomain>[];
				assert.strictEqual(vals.length, 4);
				// First position: after skipping 2 zeros, should get value [1,1]
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [1, 1]);
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
				// Position 0: skip 2 zeros, get [5,5]
				assert.strictEqual(vals[0].inner.isValue(), true);
				if(vals[0].inner.isValue()) {
					assert.deepStrictEqual(vals[0].inner.value, [5, 5]);
				}
				// Position 1: skip 2 zeros, get [6,6]
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
			const result = propagate([], summary, 0);

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
			const result = propagate(positions, summary, 0);

			// Should skip the zero and return [5, 5]
			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.deepStrictEqual(result.inner.value, [5, 5]);
			}
		});

		test('propagate function joins with may-contain-zero positions', () => {
			const positions = [
				new NAAwareDomain({ inner: new IntervalDomain([-1, 1]), hasNA: false }, intervalFactory),
				new NAAwareDomain({ inner: new IntervalDomain([5, 5]), hasNA: false }, intervalFactory)
			];
			const summary = new NAAwareDomain(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				intervalFactory
			);
			const result = propagate(positions, summary, 0);

			// [-1,1] may contain zero, so result should be join of [-1,1] and [5,5] = [-1, 5]
			assert.strictEqual(result.inner.isValue(), true);
			if(result.inner.isValue()) {
				assert.strictEqual(result.inner.value[0], -1);
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
	});
});
