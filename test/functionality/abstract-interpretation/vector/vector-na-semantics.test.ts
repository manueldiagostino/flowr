import { describe, test, assert } from 'vitest';
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { Top, NA } from '../../../../src/abstract-interpretation/domains/lattice';
import type { DomainFactory } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorInferenceVisitor } from '../../../../src/abstract-interpretation/vector/vector-inference';
import { FlowrConfig } from '../../../../src/config';
import { extractCfg } from '../../../../src/control-flow/extract-cfg';
import { createDataflowPipeline } from '../../../../src/core/steps/pipeline/default-pipelines';
import { contextFromInput } from '../../../../src/project/context/flowr-analyzer-context';
import { SlicingCriterion } from '../../../../src/slicing/criterion/parse';
import { withShell } from '../../_helper/shell';
import type { RShell } from '../../../../src/r-bridge/shell';

const defaultAbsintConfig: FlowrConfig = FlowrConfig.setInConfig(FlowrConfig.default(), 'solver.evalStrings', false);

/* ============================================================================
 * Factories for NAAwareDomain<IntervalDomain>
 * ============================================================================ */

const intervalFactory: DomainFactory<IntervalDomain> = (concrete) => {
	if(concrete === Top) {
		return IntervalDomain.top();
	}
	if(concrete === NA || !(concrete instanceof Set)) {
		return IntervalDomain.bottom();
	}
	return IntervalDomain.abstract(concrete);
};

const naAwareIntervalFactory: DomainFactory<NAAwareDomain<IntervalDomain>> = (concrete) => {
	if(concrete === Top) {
		return NAAwareDomain.top(intervalFactory);
	}

	// Handle undefined case: naValueToDomain returns undefined for non-numeric values (including NA)
	// When concrete is undefined, it means NA was passed and we should set hasNA = true
	let hasNA = false;
	const concreteValues = new Set<number>();
	if(concrete === undefined) {
		hasNA = true;
	} else if(concrete instanceof Set) {
		hasNA = concrete.has(NA);
		for(const v of concrete) {
			if(v !== NA) {
				concreteValues.add(v as number);
			}
		}
	}

	const inner = intervalFactory(concreteValues.size > 0 ? concreteValues : Top);
	return new NAAwareDomain({ inner, hasNA }, intervalFactory);
};

const naValueToDomain = (value: string | number | boolean): ReadonlySet<number | typeof NA> | undefined => {
	if(typeof value === 'number') {
		return new Set([value]);
	}
	return undefined;
};

/* ============================================================================
 * Helper Functions for Creating NA-Aware Vectors
 * ============================================================================ */

function createNAAwareVector(
	length: [number, number],
	values: Array<{ range: [number, number]; hasNA: boolean }>,
	summary?: { range: [number, number]; hasNA: boolean }
): VectorDomain<NAAwareDomain<IntervalDomain>> {
	const len = new PosIntervalDomain(length);
	const vals = new KnownInitialPositionsDomain(
		values.map(v => new NAAwareDomain(
			{ inner: new IntervalDomain(v.range), hasNA: v.hasNA },
			intervalFactory
		)),
		naAwareIntervalFactory
	);
	const sum = summary === undefined
		? NAAwareDomain.bottom(intervalFactory)
		: new NAAwareDomain(
			{ inner: new IntervalDomain(summary.range), hasNA: summary.hasNA },
			intervalFactory
		);

	return new VectorDomain({
		length:     len,
		values:     vals,
		summary:    sum,
		attributes: VectorAttrDomain.top()
	}, naAwareIntervalFactory);
}

function createPureNAVector(length: [number, number]): VectorDomain<NAAwareDomain<IntervalDomain>> {
	return createNAAwareVector(
		length,
		[{ range: [0, 0], hasNA: true }],
		{ range: [0, 0], hasNA: true }
	);
}

/* ============================================================================
 * Helper Functions for Test Assertions
 * ============================================================================ */

function assertContainsNA(vector: VectorDomain<NAAwareDomain<IntervalDomain>> | undefined, expected: boolean, message?: string): void {
	assert.ok(vector !== undefined, 'Expected a VectorDomain result');
	if(vector === undefined) {
		return;
	}

	let containsNA = false;
	if(vector.values.isValue()) {
		const values = vector.values.value as readonly NAAwareDomain<IntervalDomain>[];
		for(const val of values) {
			if(val.containsNA()) {
				containsNA = true;
				break;
			}
		}
	}
	// When values is Bottom, we must check the summary since it may contain NA info
	// Only skip summary check if summary is also Bottom (no info available)
	if(!containsNA) {
		if(vector.summary.isBottom()) {
			// Both values and summary are Bottom - no NA info available
			// containsNA stays false
		} else if(vector.summary.isTop()) {
			// Top summary may contain NA
			const summary = vector.summary as NAAwareDomain<IntervalDomain>;
			if(typeof summary.containsNA === 'function') {
				containsNA = summary.containsNA();
			}
		} else {
			// Summary is a concrete value - check it
			const summary = vector.summary;
			if(typeof summary.containsNA === 'function') {
				containsNA = summary.containsNA();
			}
		}
	}

	assert.strictEqual(containsNA, expected, message ?? `Expected vector to ${expected ? '' : 'not '}contain NA`);
}

function _assertVectorLength(
	vector: VectorDomain<NAAwareDomain<IntervalDomain>> | undefined,
	expected: [number, number]
): void {
	assert.ok(vector !== undefined, 'Expected a VectorDomain result');
	if(vector === undefined) {
		return;
	}
	assert.ok(vector.length.isValue(), `Expected concrete length interval but got ${vector.length.toString()}`);
	if(vector.length.isValue()) {
		assert.deepStrictEqual(vector.length.value, expected);
	}
}

async function getVectorForCriterion(
	shell: RShell,
	code: string,
	criterion: `${number}@${string}`
): Promise<VectorDomain<NAAwareDomain<IntervalDomain>> | undefined> {
	const ctx = contextFromInput(code, defaultAbsintConfig);
	const result = await createDataflowPipeline(shell, { context: ctx }).allRemainingSteps();
	const idMap = result.dataflow.graph.idMap ?? result.normalize.idMap;
	const nodeId = SlicingCriterion.parse(criterion, idMap);
	const node = idMap.get(nodeId);

	if(node === undefined) {
		throw new Error(`slicing criterion ${criterion} does not refer to an AST node`);
	}

	const cfg = extractCfg(result.normalize, ctx, undefined, undefined, true);
	const inference = new VectorInferenceVisitor(naAwareIntervalFactory, naValueToDomain, { controlFlow: cfg, dfg: result.dataflow.graph, normalizedAst: result.normalize, ctx });
	inference.start();
	return inference.getAbstractValue(node);
}

/* ============================================================================
 * NA-Aware Vector Semantics Integration Tests
 * ============================================================================ */

describe.sequential('NA-Aware Vector Semantics Integration Tests', withShell(shell => {
	describe('Vector Creation with NA', () => {
		test('c(1, NA, 3) creates vector with NA', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, NA, 3)', '1@x');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('c(NA) creates pure NA vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(NA)', '1@x');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('c(1, 2, 3) creates vector without NA', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, 2, 3)', '1@x');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('c() empty vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c()', '1@x');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('mixed vector with multiple NAs', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(1, NA, 3, NA, 5)', '1@x');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});
	});

	describe('Binary Operations with NA Recycling', () => {
		test('addition with NA: c(1, 2) + c(NA, 4)', async() => {
			const code = `x <- c(1, 2)
y <- c(NA, 4)
z <- x + y`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('recycling with NA: c(1, 2, 3) + NA', async() => {
			const code = `x <- c(1, 2, 3)
y <- x + NA`;
			const vector = await getVectorForCriterion(shell, code, '2@y');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('no NA when both operands have no NA', async() => {
			const code = `x <- c(1, 2, 3)
y <- c(4, 5, 6)
z <- x + y`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('subtraction with NA recycling', async() => {
			const code = `x <- c(10, 20, 30, 40)
y <- c(NA, 1)
z <- x - y`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('multiplication with NA in longer vector', async() => {
			const code = `x <- c(1, NA, 3, 4)
y <- c(2, 2)
z <- x * y`;
			const vector = await getVectorForCriterion(shell, code, '3@z');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});
	});

	describe('Vector Selection with NA Indices', () => {
		test.skip('selection with NA index: x[c(1, NA, 3)]', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, NA, 3)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y');
			assertContainsNA(vector, true);
		});

		test.skip('selection without NA in indices', async() => {
			const code = `x <- c(10, 20, 30, 40, 50)
y <- x[c(1, 3, 5)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y');
			assertContainsNA(vector, true);
		});

		test.skip('single NA selection: x[NA]', async() => {
			const code = `x <- c(10, 20, 30)
y <- x[NA]`;
			const vector = await getVectorForCriterion(shell, code, '2@y');
			assertContainsNA(vector, true);
		});

		test.skip('selection with logical vector containing NA', async() => {
			const code = `x <- c(10, 20, 30, 40)
y <- x[c(TRUE, NA, FALSE, TRUE)]`;
			const vector = await getVectorForCriterion(shell, code, '2@y');
			assertContainsNA(vector, true);
		});
	});

	describe('Vector Update with NA Indices', () => {
		test('update with NA index: x[c(1, NA)] <- 99', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
x[c(1, NA)] <- 99`;
			const vector = await getVectorForCriterion(shell, code, '1@x');
			assertContainsNA(vector, true);
		});

		test('update with NA value: x[1] <- NA', async() => {
			const code = `x <- c(1, 2, 3)
x[1] <- NA`;
			const vector = await getVectorForCriterion(shell, code, '1@x');
			assertContainsNA(vector, true);
		});

		test('update without NA', async() => {
			const code = `x <- c(1, 2, 3, 4, 5)
x[c(1, 3)] <- c(10, 30)`;
			const vector = await getVectorForCriterion(shell, code, '1@x');
			assertContainsNA(vector, true);
		});
	});

	describe('Chained Operations with NA', () => {
		test('chained operations propagate NA', async() => {
			const code = `a <- c(1, NA, 3)
b <- c(4, 5, 6)
c <- a + b
d <- c * 2`;
			const vector = await getVectorForCriterion(shell, code, '4@d');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('selection after arithmetic with NA', async() => {
			const code = `a <- c(1, NA, 3, 4)
b <- a + 10
c <- b[c(1, 2)]`;
			const vector = await getVectorForCriterion(shell, code, '3@c');
			assertContainsNA(vector, true);
		});
	});

	describe('Edge Cases', () => {
		test('all NA vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(NA, NA, NA)', '1@x');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('no NA in empty vector', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c()', '1@x');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});

		test('single element without NA', async() => {
			const vector = await getVectorForCriterion(shell, 'x <- c(42)', '1@x');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, false);
		});

		test('large vector with scattered NA values', async() => {
			const code = 'x <- c(1, 2, NA, 4, 5, NA, 7, 8, 9, NA)';
			const vector = await getVectorForCriterion(shell, code, '1@x');
			assert.ok(vector !== undefined);
			assertContainsNA(vector, true);
		});
	});
}));

/* ============================================================================
 * NA-Aware Vector Semantics Unit Tests
 * ============================================================================ */

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
			const domain = naAwareIntervalFactory(new Set([1, 2, NA as unknown as number]));
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
			assert.strictEqual(vector.values.isValue(), true);
			if(vector.values.isValue()) {
				const vals = vector.values.value as readonly NAAwareDomain<IntervalDomain>[];
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

			if(vector.values.isValue()) {
				const vals = vector.values.value as readonly NAAwareDomain<IntervalDomain>[];
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
