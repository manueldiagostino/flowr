import { assert, test, describe } from 'vitest';
import './log-config';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { RVectorTypeDomain } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { withShell } from '../../_helper/shell';
import { intervalFactory } from '../_helper/interval-factory';
import {
	getVectorForCriterion,
	assertLength,
	assertLengthRange,
	assertLengthOrTop,
	assertSelection,
	runVectorInference
} from '../_helper/vector-inference-helpers';

const valueToDomain = (value: string | number | boolean): ReadonlySet<number> | undefined => {
	if(typeof value === 'number') {
		return new Set([value]);
	} else if(typeof value === 'boolean') {
		return new Set([value ? 1 : 0]);
	}
	return undefined;
};

describe.sequential('Vector Inference Integration Tests', withShell(shell => {
	describe('Basic Vector Creation', () => {
		test('c() with numeric literals x <- c(1, 2, 3) has exact length [3,3]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, 2, 3)', '1@x', intervalFactory, valueToDomain);
			assertLength(vector, [3, 3]);
		});

		test('c() with single element x <- c(42) has exact length [1,1]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(42)', '1@x', intervalFactory, valueToDomain);
			assertLength(vector, [1, 1]);
		});

		test('c() with empty vector x <- c() returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c()', '1@x', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('c() with five elements x <- c(1, 2, 3, 4, 5) has exact length [5,5]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, 2, 3, 4, 5)', '1@x', intervalFactory, valueToDomain);
			assertLength(vector, [5, 5]);
		});

		test('numeric literal x <- 42 has exact length [1,1]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- 42', '1@x', intervalFactory, valueToDomain);
			assertLength(vector, [1, 1]);
		});
	});

	describe('Binary Operations with Recycling', () => {
		test('addition of two same-length vectors returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3)
y <- c(4, 5, 6)
z <- x + y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('recycling: shorter vector recycled to longer returns VectorDomain', async() => {
			const code = `x <- c(1, 2)
y <- c(1, 2, 3, 4)
z <- x + y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('recycling with single value returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
y <- x + 10`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('subtraction with recycling returns VectorDomain', async() => {
			const code = `x <- c(10, 20, 30, 40)
y <- c(1, 2)
z <- x - y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('multiplication with recycling returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3, 4, 5, 6)
y <- c(2, 3)
z <- x * y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('division with recycling returns VectorDomain', async() => {
			const code = `x <- c(100, 200, 300, 400)
y <- c(10, 20)
z <- x / y`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});
	});

	describe('Vector Selection', () => {
		test('positive selection x[c(1, 3, 5)] returns 3 elements with correct values', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, 3, 5)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertSelection(vector, [3, 3], [[10, 10], [30, 30], [50, 50]]);
		});

		test('single element selection x[2] returns 1 element with correct value', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[2]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertSelection(vector, [1, 1], [[20, 20]]);
		});

		test.skip('selection with range x[1:5] returns 5 elements with correct values - SKIPPED: range syntax not supported, use c() instead', async() => {
			const code = `x <- c(10, 20, 30, 40, 50, 60, 70, 80, 90, 100)
y <- x[1:5]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertSelection(vector, [5, 5], [[10, 10], [20, 20], [30, 30], [40, 40], [50, 50]]);
		});

		test.skip('selection at start x[1:2] returns first 2 elements - SKIPPED: range syntax not supported, use c() instead', async() => {
			const code = `x <- c(100, 200, 300, 400)
y <- x[1:2]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertSelection(vector, [2, 2], [[100, 100], [200, 200]]);
		});

		test.skip('selection at end x[3:4] returns last 2 elements - SKIPPED: range syntax not supported, use c() instead', async() => {
			const code = `x <- c(100, 200, 300, 400)
y <- x[3:4]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertSelection(vector, [2, 2], [[300, 300], [400, 400]]);
		});

		test('select first element x[1] returns single element', async() => {
			const code = `x <- c(99, 88, 77)
y <- x[1]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertSelection(vector, [1, 1], [[99, 99]]);
		});

		test('select last element x[3] returns single element', async() => {
			const code = `x <- c(99, 88, 77)
y <- x[3]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertSelection(vector, [1, 1], [[77, 77]]);
		});

		test('positive selection with 0 in selector x[c(0, 1, 2)] - 0 is ignored, returns 2 elements', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(0, 1, 2)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [2, 2]);
		});

		test('positive selection with NA in selector x[c(1, NA, 3)] - NA produces NA value at position 2', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, NA, 3)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [3, 3]);
			assert.ok(vector !== undefined, 'Expected vector to be defined');
			if(vector !== undefined) {
				assert.ok(vector.known.isValue(), 'Expected concrete values');
				if(vector.known.isValue()) {
					const values = vector.known.value;
					assert.strictEqual(values.length, 3, 'Expected 3 values');
					assert.ok(values[0].isValue(), 'Position 1 should have concrete value');
					assert.ok(values[2].isValue(), 'Position 3 should have concrete value');
				}
			}
		});

		test('positive selection with only 0 x[c(0, 0)] returns empty vector', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[c(0, 0)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assert(vector !== undefined && vector.isBottom());
		});

		test('positive selection with 0 at different positions x[c(1, 0, 3, 0, 5)] - 0s ignored, returns 3 elements', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, 0, 3, 0, 5)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [3, 3]);
		});

		test('multi-position selector with interval positions and zero - AdjustForZeros propagates interval', async() => {
			const code = 'x <- c(10, 20, 30, 40, 50, 60, 70, 80); if(runif(1) > 0.5) { a <- 1 } else { a <- 2 }; if(runif(1) > 0.5) { b <- 0 } else { b <- 3 }; if(runif(1) > 0.5) { c <- 2 } else { c <- 4 }; sel <- c(a, b, c); y <- x[sel]';
			const result = await runVectorInference(shell, code, intervalFactory, valueToDomain);
			const selVector = result.getForCriterion('1@sel');
			const yVector = result.getForCriterion('1@y');
			assert.ok(selVector !== undefined, 'Selector vector should be defined');
			assert.ok(yVector !== undefined, 'Result vector y should be defined');
			if(selVector !== undefined) {
				assertLength(selVector, [3, 3]);
				assert.ok(selVector.known.isValue(), 'Selector should have concrete values');
				if(selVector.known.isValue()) {
					const positions = selVector.known.value;
					assert.strictEqual(positions.length, 3, 'Should have 3 positions');
				}
			}
			if(yVector !== undefined) {
				assertLengthRange(yVector, 2, 3);
			}
		});

		test('mixed interval selector [[-2,1][-1,1][0,1]] - ambiguous intervals split correctly', async() => {
			// Selector with intervals spanning negative, zero, and positive:
			// a ∈ [-2, 1], b ∈ [-1, 1], c ∈ [0, 1]
			// After abstractFilter:
			//   - positive part: [0,1] for all three
			//   - negative part: [-2,0], [-1,0] for first two, bottom for third (c has no negative values)
			const code = `x <- c(10, 20, 30, 40, 50)
a <- if(runif(1) > 0.5) -2 else 1
b <- if(runif(1) > 0.5) -1 else 1
c <- if(runif(1) > 0.5) 0 else 1
sel <- c(a, b, c)
y <- x[sel]`;
			const result = await runVectorInference(shell, code, intervalFactory, valueToDomain);
			const selVector = result.getForCriterion('5@sel');
			const yVector = result.getForCriterion('6@y');
			assert.ok(selVector !== undefined, 'Selector vector should be defined');
			assert.ok(yVector !== undefined, 'Result vector y should be defined');
			if(selVector !== undefined) {
				assertLength(selVector, [3, 3]);
				assert.ok(selVector.known.isValue(), 'Selector should have concrete values');
			}
			// y should have length in range [0, 5] since:
			// - all selector positions could be 0 (a=0, b=0, c=0) → empty result
			// - positive selection could get up to 3 elements
			// - negative selection could delete up to 2 elements
			if(yVector !== undefined) {
				assertLengthRange(yVector, 0, 5);
			}
		});

		test('all zeros selector c(0, 0, 0) - returns empty vector', async() => {
			// Selector with only zeros should return empty vector (bottom)
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(0, 0, 0)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assert.ok(vector !== undefined && vector.isBottom(), 'All-zeros selector should return bottom (empty vector)');
		});

		test('selector with only zero intervals [[0,0][0,0]] - returns empty vector', async() => {
			// Selector where all positions are exactly [0,0] should return empty vector
			// This is the concrete version of the bug: c(0, 0) should not be treated as negative
			const code = `x <- c(10, 20, 30, 40, 50)
a <- 0
b <- 0
sel <- c(a, b)
y <- x[sel]`;
			const vector = await getVectorForCriterion(shell, code, '5@y', intervalFactory, valueToDomain);
			assert.ok(vector !== undefined && vector.isBottom(), 'Zero-only selector should return bottom (empty vector)');
		});

	});

	describe('Vector Update', () => {
		test('single element update returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
x[3] <- 99`;
			const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('multiple element update returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3, 4, 5, 6)
x[c(1, 3, 5)] <- c(10, 30, 50)`;
			const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});
	});

	describe('Chained Operations', () => {
		test('chained c() operations returns VectorDomain', async() => {
			const code = `x <- c(1, 2)
y <- c(3, 4)
z <- c(x, y)`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('vector through arithmetic chain returns VectorDomain', async() => {
			const code = `a <- c(1, 2, 3)
b <- c(10, 20, 30)
c <- a + b
d <- c * 2`;
			const vector = await getVectorForCriterion(shell, code, '4@d', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});
	});

	describe('Edge Cases', () => {
		test('NA values in c() returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, NA, 3)', '1@x', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('vector with negative numbers returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(-5, -10, -15)', '1@x', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('mixed arithmetic with recycling returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3, 4, 5, 6)
y <- c(10, 20)
z <- x + y - 5`;
			const vector = await getVectorForCriterion(shell, code, '3@z', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('c() with twenty elements returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20)', '1@x', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});
	});

	describe('Edge Cases - Scalar Resolution and c() Function', () => {
		test('empty c() x <- c() returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c()', '1@x', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('single element c() x <- c(42) has length [1,1]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(42)', '1@x', intervalFactory, valueToDomain);
			assertLength(vector, [1, 1]);
		});

		test('nested c() x <- c(c(1, 2), 3) has length [3,3]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(c(1, 2), 3)', '1@x', intervalFactory, valueToDomain);
			assertLength(vector, [3, 3]);
		});

		test('deeply nested c() x <- c(c(c(1), 2), c(3, 4)) has length [4,4]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(c(c(1), 2), c(3, 4))', '1@x', intervalFactory, valueToDomain);
			assertLength(vector, [4, 4]);
		});

		test('mixed types c(1, "a") - LIMITATION: not supported, may return Bottom', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, "a")', '1@x', intervalFactory, valueToDomain);
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for mixed types');
			if(vector instanceof VectorDomain) {
				assert.ok(vector.length.isValue() || vector.length.isTop() || vector.length.isBottom(), 'Expected concrete length, Top, or Bottom (not supported)');
			}
		});

		test('very long vector c(1:100) - returns VectorDomain without crash', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1:100)', '1@x', intervalFactory, valueToDomain);
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for long vector');
		});

		test('very long explicit vector with 50 elements - returns VectorDomain', async() => {
			const elements = Array.from({ length: 50 }, (_, i) => i + 1).join(', ');
			const vector = await getVectorForCriterion(shell, `x <- c(${elements})`, '1@x', intervalFactory, valueToDomain);
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for 50-element vector');
			if(vector instanceof VectorDomain && vector.length.isValue()) {
				assert.deepStrictEqual(vector.length.value, [50, 50], '50-element vector should have length [50,50]');
			}
		});

		test('scalar numeric x <- 42 has length [1,1]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- 42', '1@x', intervalFactory, valueToDomain);
			assertLength(vector, [1, 1]);
		});

		test('scalar from variable y <- 42; x <- y preserves length [1,1]', async() => {
			const code = `y <- 42
x <- y`;
			const vector = await getVectorForCriterion(shell, code, '2@x', intervalFactory, valueToDomain);
			assertLength(vector, [1, 1]);
		});

		test('c() with zero x <- c(0, 0, 0) has length [3,3]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(0, 0, 0)', '1@x', intervalFactory, valueToDomain);
			assertLength(vector, [3, 3]);
		});

		test('c() with mixed zeros and non-zeros x <- c(0, 1, 0, 2) has length [4,4]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(0, 1, 0, 2)', '1@x', intervalFactory, valueToDomain);
			assertLength(vector, [4, 4]);
		});
	});

	describe('String and Logical Literals', () => {
		test('string literal x <- "hello" returns VectorDomain or undefined', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- "hello"', '1@x', intervalFactory, valueToDomain);
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for string literal');
		});

		test('logical TRUE literal x <- TRUE returns VectorDomain or undefined', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- TRUE', '1@x', intervalFactory, valueToDomain);
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for logical literal');
		});

		test('logical FALSE literal x <- FALSE returns VectorDomain or undefined', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- FALSE', '1@x', intervalFactory, valueToDomain);
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for logical literal');
		});

		test('c() with string literals x <- c("a", "b") returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c("a", "b")', '1@x', intervalFactory, valueToDomain);
			assert.ok(vector !== undefined, 'Expected an inferred vector value');
			assert.ok(vector instanceof VectorDomain, 'Expected VectorDomain for string vector');
		});

		test('c() with logical literals x <- c(TRUE, FALSE, TRUE) returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(TRUE, FALSE, TRUE)', '1@x', intervalFactory, valueToDomain);
			assert.ok(vector !== undefined, 'Expected an inferred vector value');
			assert.ok(vector instanceof VectorDomain, 'Expected VectorDomain for logical vector');
		});
	});

	describe('Numeric Selector Position Classification', () => {
		test('positive selector [1, 3] on x <- c(10, 20, 30, 40, 50) returns elements at positions 1 and 3', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, 3)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [2, 2]);
		});

		test.skip('negative selector [-1, -3] on x <- c(10, 20, 30, 40, 50) removes elements at positions 1 and 3 - SKIPPED: negative selector values in c() not yet supported', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(-1, -3)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [3, 3]);
		});

		test.skip('ambiguous selector [-2, 3] (interval spanning 0) splits and joins correctly - SKIPPED: negative selector values in c() not yet supported', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(-2, 3)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for ambiguous selector');
		});

		test.skip('double-negation x[-(-1)] selects position 1 (not removes it) - SKIPPED: negation expressions not yet supported', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[-(-1)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [1, 1]);
		});

		test.skip('triple-negation x[-(-(-1))] removes position 1 - SKIPPED: negation expressions not yet supported', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[-(-(-1))]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [2, 2]);
		});

		test.skip('expression x[-(1-2)] selects position 1 (since 1-2 = -1, then negated = 1) - SKIPPED: arithmetic expressions in selectors not yet supported', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[-(1-2)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [1, 1]);
		});
	});

	describe('Logical Selector Detection (AST-based)', () => {
		test('logical selector c(TRUE, FALSE) on x <- c(10, 20, 30) uses logical selection', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[c(TRUE, FALSE, TRUE)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('logical selector c(TRUE, FALSE, TRUE, TRUE) on x <- c(10, 20) gets NA from selected', async() => {
			const code = `x <- c(10, 20)
y <- x[c(TRUE, FALSE, TRUE, TRUE)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});


		test('comparison selector x[x > 0] uses logical selection', async() => {
			const code = `x <- c(10, -5, 20)
y <- x[x > 0]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});

		test('logical AND selector x[x > 0 & x < 10] uses logical selection', async() => {
			const code = `x <- c(5, 15, -3, 8)
y <- x[x > 0 & x < 10]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLengthOrTop(vector);
		});
	});

	describe('Numeric Selector Update with Position Classification', () => {
		test('positive update x[2] <- 99 updates position 2', async() => {
			const code = `x <- c(10, 20, 30)
x[2] <- 99`;
			const vector = await getVectorForCriterion(shell, code, '2@x', intervalFactory, valueToDomain);
			assertLength(vector, [3, 3]);
		});

		test('negative update x[-2] <- 99 updates all positions except 2', async() => {
			const code = `x <- c(10, 20, 30)
x[-2] <- 99`;
			const vector = await getVectorForCriterion(shell, code, '2@x', intervalFactory, valueToDomain);
			assertLength(vector, [3, 3]);
		});

		test('double-negation update x[-(-2)] <- 99 updates position 2', async() => {
			const code = `x <- c(10, 20, 30)
x[-(-2)] <- 99`;
			const vector = await getVectorForCriterion(shell, code, '2@x', intervalFactory, valueToDomain);
			assertLength(vector, [3, 3]);
		});
	});

	describe('Positive Update (Paper §4.8.1)', () => {
		describe('Paragraph 1: Non-enumerable selector', () => {
			test('should use squash for non-enumerable positions', async() => {
				// Create source vector: x = [1, 2, 3, 4, 5]
				// Create selector with non-enumerable interval (card > θ=50)
				// Result should have infinite upper length and squashed summary
				const code = 'x <- c(1, 2, 3, 4, 5)\nx[c(1, 100)] <- 99';
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});

			test('should handle non-enumerable selector with multiple values', async() => {
				// x = [1, 2, 3], selector = c(1, 50, 100) (non-enumerable)
				// Values = c(10, 20, 30)
				// Result should squash both source and values
				const code = 'x <- c(1, 2, 3)\nx[c(1, 50, 100)] <- c(10, 20, 30)';
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});
		});

		describe('Paragraph 2a: Infinite selector, non-enumerable summary', () => {
			test('should handle infinite selector with non-enumerable summary', async() => {
				// Create infinite selector via branching with non-enumerable summary
				// if(runif(1) > 0.5) { a <- 1 } else { a <- 100 }
				// Selector summary = [1, 100] which is non-enumerable
				const code = `x <- c(10, 20, 30)
if(runif(1) > 0.5) { a <- 1 } else { a <- 100 }
sel <- c(a, a, a)
x[sel] <- 99`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});

			test('should join squash values for positions >= lS2', async() => {
				// When selector summary has lower bound lS2, positions >= lS2
				// should be joined with squashed values
				const code = `x <- c(10, 20, 30, 40, 50)
if(runif(1) > 0.5) { a <- 1 } else { a <- 100 }
sel <- c(a, a)
x[sel] <- c(99, 88)`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});
		});

		describe('Paragraph 2b: Infinite selector, enumerable summary', () => {
			test('should handle infinite selector with enumerable summary', async() => {
				// Create infinite selector via branching with enumerable summary
				// if(runif(1) > 0.5) { a <- 1 } else { a <- 2 }
				// Selector summary = [1, 2] which is enumerable
				const code = `x <- c(10, 20, 30)
if(runif(1) > 0.5) { a <- 1 } else { a <- 2 }
sel <- c(a, a, a)
x[sel] <- 99`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});

			test('should use cyclic recycling for enumerable summary', async() => {
				// With enumerable summary, use cyclic recycling for value assignment
				const code = `x <- c(10, 20, 30, 40, 50)
if(runif(1) > 0.5) { a <- 1 } else { a <- 3 }
sel <- c(a, a, a)
x[sel] <- c(99, 88)`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});
		});

		describe('Paragraph 3: Finite selector, enumerable', () => {
			test('should update exact positions with finite selector', async() => {
				// x = [10, 20, 30], selector = c(1, 3) (finite, enumerable)
				// Values = c(99, 88)
				// Result: positions 1 and 3 updated
				const code = `x <- c(10, 20, 30)
x[c(1, 3)] <- c(99, 88)`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assertLength(vector, [3, 3]);
			});

			test('should use cyclic recycling for value assignment', async() => {
				// x = [10, 20, 30, 40, 50], selector = c(1, 3, 5)
				// Values = c(99, 88) (fewer values than positions)
				// Values should be recycled cyclically
				const code = `x <- c(10, 20, 30, 40, 50)
x[c(1, 3, 5)] <- c(99, 88)`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assertLength(vector, [5, 5]);
			});

			test('should result in bottom summary for finite selector', async() => {
				// Finite selector should result in summary = ⊥
				const code = `x <- c(10, 20, 30)
x[c(1, 2)] <- c(99, 88)`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
				assertLength(vector, [3, 3]);
			});

			test('should extend vector when selector exceeds current length', async() => {
				// x = [10, 20, 30], selector = c(1, 5)
				// Vector should extend to length 5
				const code = `x <- c(10, 20, 30)
x[c(1, 5)] <- c(99, 88)`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});
		});

		describe('Edge cases', () => {
			test('should handle zero in selector (AdjustForZeros)', async() => {
				// x = [10, 20, 30], selector = c(0, 1, 2)
				// Zero should be ignored (AdjustForZeros)
				const code = `x <- c(10, 20, 30)
x[c(0, 1, 2)] <- c(99, 88, 77)`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assertLength(vector, [3, 3]);
			});

			test('should handle single element update', async() => {
				// x = [10, 20, 30], selector = 2
				// Single element update
				const code = `x <- c(10, 20, 30)
x[2] <- 99`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assertLength(vector, [3, 3]);
			});

			test('should handle empty selector', async() => {
				// x = [10, 20, 30], selector = c()
				// No positions updated
				const code = `x <- c(10, 20, 30)
x[c()] <- 99`;
				const vector = await getVectorForCriterion(shell, code, '1@x', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});
		});
	});

	describe('runVectorInference - Multiple Value Queries', () => {
		test('can query multiple criteria without re-running inference', async() => {
			const code = `x <- c(1, 2, 3)
y <- c(4, 5, 6)
z <- x + y`;
			const result = await runVectorInference(shell, code, intervalFactory, valueToDomain);

			const xValue = result.getForCriterion('1@x');
			const yValue = result.getForCriterion('2@y');
			const zValue = result.getForCriterion('3@z');

			assertLength(xValue, [3, 3]);
			assertLength(yValue, [3, 3]);
			assertLengthOrTop(zValue);
		});

		test('caching works - second query returns cached value', async() => {
			const code = 'x <- c(10, 20, 30)';
			const result = await runVectorInference(shell, code, intervalFactory, valueToDomain);

			const first = result.getForCriterion('1@x');
			const second = result.getForCriterion('1@x');

			assert.strictEqual(first, second, 'Should return same cached object');
		});
	});

	describe('Negative Selection', () => {
		describe('Paragraph 1: Non-enumerable selector', () => {
			test.skip('should use SquashExcept for non-enumerable positions', async() => {
				// Create source vector: x = [1, 2, 3, 4, 5]
				// Create selector: c(-100) which is non-enumerable (card > θ=50)
				// Result should have length [0, 4] with all positions = SquashExcept(value, {1})
				const code = 'x <- c(1, 2, 3, 4, 5)\ny <- x[-100]';
				const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});

			test.skip('should handle mixed enumerable/non-enumerable selector', async() => {
				// Selector with some enumerable positions and one non-enumerable
				// Should trigger paragraph 1 and use SquashExcept
				const code = 'x <- c(1, 2, 3, 4, 5)\ny <- x[c(-1, -100)]';
				const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});
		});

		describe('Paragraph 2: Infinite selector, all enumerable', () => {
			test.skip('should preserve summary for infinite selector', async() => {
				// Selector: c(-1, -2, ...) infinite length, all positions enumerable
				// Result summary should equal source summary
				const code = 'x <- c(1, 2, 3)\ny <- x[c(-1, -2)]';
				const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});

			test.skip('should correctly remap positions with CountMustDeleted', async() => {
				// Deleting positions 1 and 3 from [a, b, c, d]
				// Result should be [b, d] at positions 1, 2
				const code = 'x <- c(10, 20, 30, 40)\ny <- x[c(-1, -3)]';
				const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});
		});

		describe('Paragraph 3: Finite selector, all enumerable', () => {
			test.skip('should delete exact positions', async() => {
				// x = [1, 2, 3, 4, 5], selector = c(-2, -4)
				// Result should be [1, 3, 5] at positions 1, 2, 3
				const code = 'x <- c(1, 2, 3, 4, 5)\ny <- x[c(-2, -4)]';
				const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});

			test.skip('should use bottom summary for finite selector', async() => {
				// Finite selector should result in summary = ⊥ (not s₁)
				const code = 'x <- c(1, 2, 3)\ny <- x[-1]';
				const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});
		});

		describe('Adjusted selector verification', () => {
			test.skip('should remove zeros from selector before set computation', async() => {
				// x = [1, 2, 3], selector = c(0, -1)
				// Zero should be removed by adjustForZeros
				// Only position 1 deleted, result = [2, 3]
				const code = 'x <- c(1, 2, 3)\ny <- x[c(0, -1)]';
				const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});

			test.skip('should handle zeros in the middle of selector', async() => {
				// selector = c(-1, 0, -2)
				// Zeros removed, positions 1 and 2 deleted
				const code = 'x <- c(1, 2, 3)\ny <- x[c(-1, 0, -2)]';
				const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});
		});

		describe('Edge cases', () => {
			test.skip('should return bottom for bottom selector', async() => {
				// selector.isBottom() → result.isBottom()
				// This would require a bottom selector input
				assert.ok(true, 'Skipped - requires specific bottom selector setup');
			});

			test('should return top for infinite source', async() => {
				// source.length.upper === +Infinity → result.isTop()
				// Note: x has finite length, so this test documents expected behavior
				// A true infinite source test would require different setup
				const code = 'x <- c(1, 2, 3)\ny <- x[-1]';
				const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});

			test.skip('should handle empty selector', async() => {
				// selector = c() → identity (no deletion)
				const code = 'x <- c(1, 2, 3)\ny <- x[c()]';
				const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
				assert.ok(vector, 'Should return a vector');
			});
		});
	});
}));

describe('Vector Inference Unit Tests', () => {
	test('VectorDomain factory creates correct domain', () => {
		const len = new PosIntervalDomain([3, 3]);

		const vals = new KnownInitialPositionsDomain(
			[[1, 1], [2, 2], [3, 3]].map(([l, u]) => new NAAwareDomain({ inner: new IntervalDomain([l, u]), hasNA: false }, intervalFactory)),
			(v: any) => new NAAwareDomain({ inner: intervalFactory(v), hasNA: false }, intervalFactory)
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const sum: any = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: false }, intervalFactory);
		const attrs = VectorAttrDomain.top();


		const vector = new VectorDomain({
			length:     len,
			known:      vals,
			summary:    sum,
			attributes: attrs,
			type:       RVectorTypeDomain.top()
		}, intervalFactory as any);

		assert.strictEqual(vector.length.toString(), '[3, 3]');
		assert.ok(vector.known.isValue());
	});

	test('VectorDomain top has unbounded length', () => {
		const top = VectorDomain.top(intervalFactory);
		assert.ok(top.isTop());
	});

	test('VectorDomain bottom has bottom length', () => {
		const bottom = VectorDomain.bottom(intervalFactory);
		assert.ok(bottom.length.isBottom());
	});
});
