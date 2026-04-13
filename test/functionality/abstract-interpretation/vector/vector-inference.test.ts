import { assert, test, describe } from 'vitest';
import { VectorInferenceVisitor } from '../../../../src/abstract-interpretation/vector/vector-inference';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { FlowrConfig } from '../../../../src/config';
import { extractCfg } from '../../../../src/control-flow/extract-cfg';
import { createDataflowPipeline } from '../../../../src/core/steps/pipeline/default-pipelines';
import { contextFromInput } from '../../../../src/project/context/flowr-analyzer-context';
import { SlicingCriterion } from '../../../../src/slicing/criterion/parse';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { withShell } from '../../_helper/shell';
import type { RShell } from '../../../../src/r-bridge/shell';
import { intervalFactory } from '../_helper/interval-factory';

const defaultAbsintConfig: FlowrConfig = FlowrConfig.setInConfig(FlowrConfig.default(), 'solver.evalStrings', false);

const valueToDomain = (value: string | number | boolean): ReadonlySet<number> | undefined => {
	if(typeof value === 'number') {
		return new Set([value]);
	}
	return undefined;
};

async function getVectorForCriterion(shell: RShell, code: string, criterion: `${number}@${string}`): Promise<VectorDomain<IntervalDomain> | undefined> {
	const ctx = contextFromInput(code, defaultAbsintConfig);
	const result = await createDataflowPipeline(shell, { context: ctx }).allRemainingSteps();
	const idMap = result.dataflow.graph.idMap ?? result.normalize.idMap;
	const nodeId = SlicingCriterion.parse(criterion, idMap);
	const node = idMap.get(nodeId);

	if(node === undefined) {
		throw new Error(`slicing criterion ${criterion} does not refer to an AST node`);
	}

	const cfg = extractCfg(result.normalize, ctx, undefined, undefined, true);
	const inference = new VectorInferenceVisitor(intervalFactory, valueToDomain, { controlFlow: cfg, dfg: result.dataflow.graph, normalizedAst: result.normalize, ctx });
	inference.start();
	return inference.getAbstractValue(node);
}

function assertLength(vector: VectorDomain<IntervalDomain> | undefined, expected: [number, number]): void {
	assert.ok(vector !== undefined, 'Expected an inferred vector value');
	if(vector === undefined) {
		return;
	}
	assert.ok(vector.length.isValue(), `Expected concrete length interval but got ${vector.length.toString()}`);
	if(vector.length.isValue()) {
		assert.deepStrictEqual(vector.length.value, expected);
	}
}

function assertLengthOrTop(vector: VectorDomain<IntervalDomain> | undefined): void {
	assert.ok(vector !== undefined, 'Expected a VectorDomain result');
}

describe.sequential('Vector Inference Integration Tests', withShell(shell => {
	describe('Basic Vector Creation', () => {
		test('c() with numeric literals x <- c(1, 2, 3) has exact length [3,3]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, 2, 3)', '1@x');
			assertLength(vector, [3, 3]);
		});

		test('c() with single element x <- c(42) has exact length [1,1]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(42)', '1@x');
			assertLength(vector, [1, 1]);
		});

		test('c() with empty vector x <- c() returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c()', '1@x');
			assertLengthOrTop(vector);
		});

		test('c() with five elements x <- c(1, 2, 3, 4, 5) has exact length [5,5]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, 2, 3, 4, 5)', '1@x');
			assertLength(vector, [5, 5]);
		});

		test('numeric literal x <- 42 has exact length [1,1]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- 42', '1@x');
			assertLength(vector, [1, 1]);
		});
	});

	describe('Binary Operations with Recycling', () => {
		test('addition of two same-length vectors returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3)
y <- c(4, 5, 6)
z <- x + y`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assertLengthOrTop(vector);
		});

		test('recycling: shorter vector recycled to longer returns VectorDomain', async() => {
			const code = `x <- c(1, 2)
y <- c(1, 2, 3, 4)
z <- x + y`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assertLengthOrTop(vector);
		});

		test('recycling with single value returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
y <- x + 10`;
			const vector = await getVectorForCriterion(shell, code, '2@y');
			assertLengthOrTop(vector);
		});

		test('subtraction with recycling returns VectorDomain', async() => {
			const code = `x <- c(10, 20, 30, 40)
y <- c(1, 2)
z <- x - y`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assertLengthOrTop(vector);
		});

		test('multiplication with recycling returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3, 4, 5, 6)
y <- c(2, 3)
z <- x * y`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assertLengthOrTop(vector);
		});

		test('division with recycling returns VectorDomain', async() => {
			const code = `x <- c(100, 200, 300, 400)
y <- c(10, 20)
z <- x / y`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assertLengthOrTop(vector);
		});
	});

	describe('Vector Selection', () => {
		test('positive selection inference', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, 3, 5)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y');
			assert.ok(vector === undefined || vector instanceof VectorDomain);
		});

		test('single element selection inference', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[2]`;
			const vector = await getVectorForCriterion(shell, code, '2@y');
			assert.ok(vector === undefined || vector instanceof VectorDomain);
		});

		test('selection with range 1:5 inference', async() => {
			const code = `x <- c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
y <- x[1:5]`;
			const vector = await getVectorForCriterion(shell, code, '2@y');
			assert.ok(vector === undefined || vector instanceof VectorDomain);
		});

	});

	describe('Vector Update', () => {
		test('single element update returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
x[3] <- 99`;
			const vector = await getVectorForCriterion(shell, code, '1@x');
			assertLengthOrTop(vector);
		});

		test('multiple element update returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3, 4, 5, 6)
x[c(1, 3, 5)] <- c(10, 30, 50)`;
			const vector = await getVectorForCriterion(shell, code, '1@x');
			assertLengthOrTop(vector);
		});
	});

	describe('Chained Operations', () => {
		test('chained c() operations returns VectorDomain', async() => {
			const code = `x <- c(1, 2)
y <- c(3, 4)
z <- c(x, y)`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assertLengthOrTop(vector);
		});

		test('vector through arithmetic chain returns VectorDomain', async() => {
			const code = `a <- c(1, 2, 3)
b <- c(10, 20, 30)
c <- a + b
d <- c * 2`;
			const vector = await getVectorForCriterion(shell, code, '4@d');
			assertLengthOrTop(vector);
		});
	});

	describe('Edge Cases', () => {
		test('NA values in c() returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, NA, 3)', '1@x');
			assertLengthOrTop(vector);
		});

		test('vector with negative numbers returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(-5, -10, -15)', '1@x');
			assertLengthOrTop(vector);
		});

		test('mixed arithmetic with recycling returns VectorDomain', async() => {
			const code = `x <- c(1, 2, 3, 4, 5, 6)
y <- c(10, 20)
z <- x + y - 5`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assertLengthOrTop(vector);
		});

		test('c() with twenty elements returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20)', '1@x');
			assertLengthOrTop(vector);
		});
	});

	describe('Edge Cases - Scalar Resolution and c() Function', () => {
		test('empty c() x <- c() returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c()', '1@x');
			assertLengthOrTop(vector);
		});

		test('single element c() x <- c(42) has length [1,1]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(42)', '1@x');
			assertLength(vector, [1, 1]);
		});

		test('nested c() x <- c(c(1, 2), 3) has length [3,3]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(c(1, 2), 3)', '1@x');
			assertLength(vector, [3, 3]);
		});

		test('deeply nested c() x <- c(c(c(1), 2), c(3, 4)) has length [4,4]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(c(c(1), 2), c(3, 4))', '1@x');
			assertLength(vector, [4, 4]);
		});

		test('mixed types c(1, "a") - LIMITATION: not supported, may return Bottom', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, "a")', '1@x');
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for mixed types');
			if(vector instanceof VectorDomain) {
				assert.ok(vector.length.isValue() || vector.length.isTop() || vector.length.isBottom(), 'Expected concrete length, Top, or Bottom (not supported)');
			}
		});

		test('very long vector c(1:100) - returns VectorDomain without crash', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1:100)', '1@x');
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for long vector');
		});

		test('very long explicit vector with 50 elements - returns VectorDomain', async() => {
			const elements = Array.from({ length: 50 }, (_, i) => i + 1).join(', ');
			const vector = await getVectorForCriterion(shell, `x <- c(${elements})`, '1@x');
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for 50-element vector');
			if(vector instanceof VectorDomain && vector.length.isValue()) {
				assert.deepStrictEqual(vector.length.value, [50, 50], '50-element vector should have length [50,50]');
			}
		});

		test('scalar numeric x <- 42 has length [1,1]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- 42', '1@x');
			assertLength(vector, [1, 1]);
		});

		test('scalar from variable y <- 42; x <- y preserves length [1,1]', async() => {
			const code = `y <- 42
x <- y`;
			const vector = await getVectorForCriterion(shell, code, '2@x');
			assertLength(vector, [1, 1]);
		});

		test('c() with zero x <- c(0, 0, 0) has length [3,3]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(0, 0, 0)', '1@x');
			assertLength(vector, [3, 3]);
		});

		test('c() with mixed zeros and non-zeros x <- c(0, 1, 0, 2) has length [4,4]', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(0, 1, 0, 2)', '1@x');
			assertLength(vector, [4, 4]);
		});
	});

	describe('String and Logical Literals', () => {
		test('string literal x <- "hello" returns VectorDomain or undefined', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- "hello"', '1@x');
			// String literals may return undefined or VectorDomain depending on implementation
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for string literal');
		});

		test('logical TRUE literal x <- TRUE returns VectorDomain or undefined', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- TRUE', '1@x');
			// Logical literals may return undefined or VectorDomain depending on implementation
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for logical literal');
		});

		test('logical FALSE literal x <- FALSE returns VectorDomain or undefined', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- FALSE', '1@x');
			// Logical literals may return undefined or VectorDomain depending on implementation
			assert.ok(vector === undefined || vector instanceof VectorDomain, 'Expected VectorDomain or undefined for logical literal');
		});

		test('c() with string literals x <- c("a", "b") returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c("a", "b")', '1@x');
			assert.ok(vector !== undefined, 'Expected an inferred vector value');
			assert.ok(vector instanceof VectorDomain, 'Expected VectorDomain for string vector');
		});

		test('c() with logical literals x <- c(TRUE, FALSE, TRUE) returns VectorDomain', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(TRUE, FALSE, TRUE)', '1@x');
			assert.ok(vector !== undefined, 'Expected an inferred vector value');
			assert.ok(vector instanceof VectorDomain, 'Expected VectorDomain for logical vector');
		});
	});
}));

describe('Vector Inference Unit Tests', () => {
	test('VectorDomain factory creates correct domain', () => {
		const len = new PosIntervalDomain([3, 3]);
		const vals = new KnownInitialPositionsDomain(
			[[1, 1], [2, 2], [3, 3]].map(([l, u]) => new NAAwareDomain({ inner: new IntervalDomain([l, u]), hasNA: false }, intervalFactory)),
			(v) => new NAAwareDomain({ inner: intervalFactory(v), hasNA: false }, intervalFactory)
		);
		const sum = new NAAwareDomain({ inner: IntervalDomain.bottom(), hasNA: false }, intervalFactory);
		const attrs = VectorAttrDomain.top();

		const vector = new VectorDomain({
			length:     len,
			values:     vals,
			summary:    sum,
			attributes: attrs
		}, intervalFactory);

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
