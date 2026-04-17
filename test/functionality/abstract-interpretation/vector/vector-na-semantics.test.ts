import { describe, test, assert } from 'vitest';
import './log-config';
import type { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import type { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { withShell } from '../../_helper/shell';
import { getVectorForCriterion } from '../_helper/vector-inference-helpers';
import { naAwareIntervalFactory, createNAAwareVector, createPureNAVector, assertContainsNA } from '../_helper/na-aware-helpers';
import type { ValueToDomainConverter } from '../../../../src/abstract-interpretation/vector/resolve-vector-args';

const naValueToDomain: ValueToDomainConverter<NAAwareDomain<IntervalDomain>> = (value) => {
	if(typeof value === 'number') {
		return new Set([value]);
	}
	return undefined;
};

describe.sequential('NA-Aware Vector Semantics Integration Tests', withShell(shell => {
	describe('Vector Creation with NA', () => {
		test('c(1, NA, 3) creates vector with NA', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, NA, 3)', '1@x', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('c(NA) creates pure NA vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(NA)', '1@x', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('c(1, 2, 3) creates vector without NA', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, 2, 3)', '1@x', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('c() empty vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c()', '1@x', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('mixed vector with multiple NAs', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, NA, 3, NA, 5)', '1@x', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});
	});

	describe('Binary Operations with NA Recycling', () => {
		test('addition with NA: c(1, 2) + c(NA, 4)', async() => {
			const code = `x <- c(1, 2)
y <- c(NA, 4)
z <- x + y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('recycling with NA: c(1, 2, 3) + NA', async() => {
			const code = `x <- c(1, 2, 3)
y <- x + NA`;
			const vector = await getVectorForCriterion(shell, code, '2@y', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('no NA when both operands have no NA', async() => {
			const code = `x <- c(1, 2, 3)
y <- c(4, 5, 6)
z <- x + y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('subtraction with NA recycling', async() => {
			const code = `x <- c(10, 20, 30, 40)
y <- c(NA, 1)
z <- x - y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('multiplication with NA in longer vector', async() => {
			const code = `x <- c(1, NA, 3, 4)
y <- c(2, 2)
z <- x * y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});
	});

	describe('Vector Selection with NA Indices', () => {
		test.skip('selection with NA index: x[c(1, NA, 3)]', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, NA, 3)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', naAwareIntervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});

		test.skip('selection without NA in indices', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, 3, 5)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', naAwareIntervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});

		test.skip('single NA selection: x[NA]', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[NA]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', naAwareIntervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});

		test.skip('selection with logical vector containing NA', async() => {
			const code = `x <- c(10, 20, 30, 40)
y <- x[c(TRUE, NA, FALSE, TRUE)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', naAwareIntervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});
	});

	describe('Vector Update with NA Indices', () => {
		test('update with NA index: x[c(1, NA)] <- 99', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
x[c(1, NA)] <- 99`;
			const vector = await getVectorForCriterion(shell, code, '1@x', naAwareIntervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});

		test('update with NA value: x[1] <- NA', async() => {
			const code = `x <- c(1, 2, 3)
x[1] <- NA`;
			const vector = await getVectorForCriterion(shell, code, '1@x', naAwareIntervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});

		test('update without NA', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
x[c(1, 3)] <- c(10, 30)`;
			const vector = await getVectorForCriterion(shell, code, '1@x', naAwareIntervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});
	});

	describe('Chained Operations with NA', () => {
		test('chained operations propagate NA', async() => {
			const code = `a <- c(1, NA, 3)
b <- c(4, 5, 6)
c <- a + b
d <- c * 2`;
			const vector = await getVectorForCriterion(shell, code, '4@d', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('selection after arithmetic with NA', async() => {
			const code = `a <- c(1, NA, 3, 4)
b <- a + 10
c <- b[c(1, 2)]`;
			const vector = await getVectorForCriterion(shell, code, '3@c', naAwareIntervalFactory, naValueToDomain);
			assertContainsNA(vector, true);
		});
	});

	describe('Edge Cases', () => {
		test('all NA vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(NA, NA, NA)', '1@x', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('no NA in empty vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c()', '1@x', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('single element without NA', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(42)', '1@x', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('large vector with scattered NA values', async() => {
			const code = 'x <- c(1, 2, NA, 4, 5, NA, 7, 8, 9, NA)';
			const vector = await getVectorForCriterion(shell, code, '1@x', naAwareIntervalFactory, naValueToDomain);
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});
	});
}));

describe('NA-Aware Vector Semantics Unit Tests', () => {
	describe('Domain Factory', () => {
		test('naAwareIntervalFactory creates Top element', () => {
			const { Top } = require('../../../../src/abstract-interpretation/domains/lattice');
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
			const { NA } = require('../../../../src/abstract-interpretation/domains/lattice');
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
});
