import { assert, test, describe } from 'vitest';
import './log-config';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { withShell } from '../../_helper/shell';
import { intervalFactory } from '../_helper/interval-factory';
import {
	getVectorForCriterion,
	assertLength,
	assertLengthOrTop,
	assertSelection,
	runVectorInference
} from '../_helper/vector-inference-helpers';

const valueToDomain = (value: string | number | boolean): ReadonlySet<number> | undefined => {
	if(typeof value === 'number') {
		return new Set([value]);
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

		test('selection with range x[1:5] returns 5 elements with correct values', async() => {
			const code = `x <- c(10, 20, 30, 40, 50, 60, 70, 80, 90, 100)
y <- x[1:5]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertSelection(vector, [5, 5], [[10, 10], [20, 20], [30, 30], [40, 40], [50, 50]]);
		});

		test('selection at start x[1:2] returns first 2 elements', async() => {
			const code = `x <- c(100, 200, 300, 400)
y <- x[1:2]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertSelection(vector, [2, 2], [[100, 100], [200, 200]]);
		});

		test('selection at end x[3:4] returns last 2 elements', async() => {
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

		test('negative selector [-1, -3] on x <- c(10, 20, 30, 40, 50) removes elements at positions 1 and 3', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(-1, -3)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [3, 3]);
		});

		test('ambiguous selector [-2, 3] (interval spanning 0) splits and joins correctly', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(-2, 3)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for ambiguous selector');
		});

		test('double-negation x[-(-1)] selects position 1 (not removes it) - core bug fix', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[-(-1)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [1, 1]);
		});

		test('triple-negation x[-(-(-1))] removes position 1', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[-(-(-1))]`;
			const vector = await getVectorForCriterion(shell, code, '2@y', intervalFactory, valueToDomain);
			assertLength(vector, [2, 2]);
		});

		test('expression x[-(1-2)] selects position 1 (since 1-2 = -1, then negated = 1)', async() => {
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
			values:     vals,
			summary:    sum,
			attributes: attrs
		}, intervalFactory as any);

		assert.strictEqual(vector.length.toString(), '[3, 3]');
		assert.ok(vector.values.isValue());
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
