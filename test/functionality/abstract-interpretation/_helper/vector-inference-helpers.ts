import { VectorInferenceVisitor } from '../../../../src/abstract-interpretation/vector/vector-inference';
import type { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import type { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { FlowrConfig } from '../../../../src/config';
import { extractCfg } from '../../../../src/control-flow/extract-cfg';
import type { PipelineOutput } from '../../../../src/core/steps/pipeline/pipeline';
import { type DEFAULT_DATAFLOW_PIPELINE, createDataflowPipeline } from '../../../../src/core/steps/pipeline/default-pipelines';
import { contextFromInput } from '../../../../src/project/context/flowr-analyzer-context';
import { SlicingCriterion } from '../../../../src/slicing/criterion/parse';
import type { RShell } from '../../../../src/r-bridge/shell';
import type { ParentInformation } from '../../../../src/r-bridge/lang-4.x/ast/model/processing/decorate';
import type { RNode } from '../../../../src/r-bridge/lang-4.x/ast/model/model';
import type { AnyAbstractDomain } from '../../../../src/abstract-interpretation/domains/abstract-domain';
import type { ArithmeticDomain } from '../../../../src/abstract-interpretation/domains/arithmetic-domain';
import type { ValueToDomainConverter } from '../../../../src/abstract-interpretation/vector/resolve-vector-args';
import { assert } from 'vitest';

const defaultAbsintConfig: FlowrConfig = FlowrConfig.setInConfig(FlowrConfig.default(), 'solver.evalStrings', false);

/**
 * Default value converter for IntervalDomain (non-NA-aware).
 * Returns a Set with the numeric value, or undefined for non-numeric values.
 */
export const defaultValueToDomain: ValueToDomainConverter<IntervalDomain> = (value) => {
	if(typeof value === 'number') {
		return new Set([value]);
	}
	return undefined;
};

/**
 * Result of running vector inference, providing methods to query abstract values.
 */
export interface VectorInferenceResult<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>> {
	/** Get the abstract vector value for a specific slicing criterion */
	getForCriterion(criterion: `${number}@${string}`): VectorDomain<Domain> | undefined;
	/** Get the abstract vector value for a specific AST node */
	getForNode(node: RNode<ParentInformation>): VectorDomain<Domain> | undefined;
	/** Get all abstract values that were inferred (for debugging) */
	getAllValues(): Map<string, VectorDomain<Domain> | undefined>;
	/** The underlying visitor for advanced use cases */
	visitor:        VectorInferenceVisitor<Domain>;
	/** The pipeline result with dataflow graph and normalized AST */
	pipelineResult: PipelineOutput<typeof DEFAULT_DATAFLOW_PIPELINE>;
}

/**
 * Runs vector inference on the given R code and returns a result object
 * that can be used to query multiple abstract values without re-running
 * the analysis.
 * @param shell - The RShell instance for parsing
 * @param code - The R code to analyze
 * @param factory - Domain factory function (e.g., intervalFactory or naAwareIntervalFactory)
 * @param valueConverter - Function to convert concrete values to domain sets
 * @returns A result object with methods to get abstract values for different criteria
 * @example
 * ```typescript
 * const result = await runVectorInference(shell, 'x <- c(1, 2, 3)', intervalFactory, defaultValueToDomain);
 * const xValue = result.getForCriterion('1@x');
 * // Can call getForCriterion multiple times without re-running inference
 * ```
 */
export async function runVectorInference<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	shell: RShell,
	code: string,
	factory: import('../../../../src/abstract-interpretation/vector/vector-domain').DomainFactory<Domain>,
	valueConverter: ValueToDomainConverter<Domain>
): Promise<VectorInferenceResult<Domain>> {
	const ctx = contextFromInput(code, defaultAbsintConfig);
	const result = await createDataflowPipeline(shell, { context: ctx }).allRemainingSteps();
	const idMap = result.dataflow.graph.idMap ?? result.normalize.idMap;
	const cfg = extractCfg(result.normalize, ctx, undefined, undefined, true);
	const visitor = new VectorInferenceVisitor(factory, valueConverter, { controlFlow: cfg, dfg: result.dataflow.graph, normalizedAst: result.normalize, ctx });
	visitor.start();

	const valueCache = new Map<string, VectorDomain<Domain> | undefined>();

	return {
		getForCriterion(criterion: `${number}@${string}`): VectorDomain<Domain> | undefined {
			if(valueCache.has(criterion)) {
				return valueCache.get(criterion);
			}

			const nodeId = SlicingCriterion.parse(criterion, idMap);
			const node = idMap.get(nodeId);

			if(node === undefined) {
				throw new Error(`slicing criterion ${criterion} does not refer to an AST node`);
			}

			const value = visitor.getAbstractValue(node);
			valueCache.set(criterion, value);
			return value;
		},

		getForNode(node: RNode<ParentInformation>): VectorDomain<Domain> | undefined {
			return visitor.getAbstractValue(node);
		},

		getAllValues(): Map<string, VectorDomain<Domain> | undefined> {
			return new Map(valueCache);
		},

		visitor,
		pipelineResult: result
	};
}

/**
 * Gets the abstract vector value for a specific slicing criterion.
 * This is a convenience wrapper around runVectorInference for single-criterion queries.
 * If you need to query multiple criteria, use runVectorInference directly to avoid
 * re-running the analysis multiple times.
 * @param shell - The RShell instance for parsing
 * @param code - The R code to analyze
 * @param criterion - The slicing criterion (e.g., '1\@x')
 * @param factory - Domain factory function (e.g., intervalFactory or naAwareIntervalFactory)
 * @param valueConverter - Function to convert concrete values to domain sets
 * @returns The VectorDomain for the given criterion, or undefined
 * @example
 * ```typescript
 * const vector = await getVectorForCriterion(shell, 'x <- c(1, 2, 3)', '1@x', intervalFactory, defaultValueToDomain);
 * assertLength(vector, [3, 3]);
 * ```
 */
export async function getVectorForCriterion<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	shell: RShell,
	code: string,
	criterion: `${number}@${string}`,
	factory: import('../../../../src/abstract-interpretation/vector/vector-domain').DomainFactory<Domain>,
	valueConverter: ValueToDomainConverter<Domain>
): Promise<VectorDomain<Domain> | undefined> {
	const result = await runVectorInference(shell, code, factory, valueConverter);
	return result.getForCriterion(criterion);
}

/**
 * Assertion helper: Assert that a vector has a specific length interval.
 * @param vector - The VectorDomain to check (may be undefined)
 * @param expected - Tuple of [min, max] for the expected length
 * @throws AssertionError if the vector is undefined or has unexpected length
 * @example
 * ```typescript
 * const vector = await getVectorForCriterion(...);
 * assertLength(vector, [3, 3]); // Exact length of 3
 * ```
 */
export function assertLength<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	vector: VectorDomain<Domain> | undefined,
	expected: [number, number]
): void {
	assert.ok(vector !== undefined, 'Expected an inferred vector value but got undefined');
	if(vector === undefined) {
		return;
	}
	assert.ok(vector.length.isValue(), `Expected concrete length interval but got ${vector.length.toString()}`);
	if(vector.length.isValue()) {
		assert.deepStrictEqual(vector.length.value, expected);
	}
}

/**
 * Assertion helper: Assert that a vector exists (is not undefined).
 * Use this when you only care that inference returned a result, not the specific length.
 * @param vector - The VectorDomain to check (may be undefined)
 * @throws AssertionError if the vector is undefined
 * @example
 * ```typescript
 * const vector = await getVectorForCriterion(...);
 * assertLengthOrTop(vector); // Just check that we got a result
 * ```
 */
export function assertLengthOrTop<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	vector: VectorDomain<Domain> | undefined
): void {
	assert.ok(vector !== undefined, 'Expected a VectorDomain result but got undefined');
}

/**
 * Assertion helper: Assert that a vector's length is within an expected range.
 * @param vector - The VectorDomain to check (may be undefined)
 * @param min - Minimum expected length
 * @param max - Maximum expected length
 * @throws AssertionError if the vector is undefined or length is outside range
 * @example
 * ```typescript
 * const vector = await getVectorForCriterion(...);
 * assertLengthRange(vector, 2, 5); // Length between 2 and 5
 * ```
 */
export function assertLengthRange<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	vector: VectorDomain<Domain> | undefined,
	min: number,
	max: number
): void {
	assert.ok(vector !== undefined, 'Expected an inferred vector value but got undefined');
	if(vector === undefined) {
		return;
	}
	assert.ok(vector.length.isValue(), `Expected concrete length interval but got ${vector.length.toString()}`);
	if(vector.length.isValue()) {
		const [actualMin, actualMax] = vector.length.value;
		assert.ok(actualMin >= min && actualMax <= max,
			`Expected length in range [${min}, ${max}] but got [${actualMin}, ${actualMax}]`);
	}
}

/**
 * Assertion helper: Assert that a vector has specific known position values.
 * Checks that the values domain matches expected intervals at given positions.
 * @param vector - The VectorDomain to check (may be undefined)
 * @param expectedValues - Array of expected [min, max] intervals for positions 1..N
 * @throws AssertionError if values don't match
 * @example
 * ```typescript
 * const vector = await getVectorForCriterion(...);
 * assertKnownPositions(vector, [[1, 1], [2, 2], [3, 3]]); // Positions 1, 2, 3 have values 1, 2, 3
 * ```
 */
export function assertKnownPositions<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	vector: VectorDomain<Domain> | undefined,
	expectedValues: [number, number][]
): void {
	assert.ok(vector !== undefined, 'Expected an inferred vector value but got undefined');
	if(vector === undefined) {
		return;
	}
	assert.ok(vector.known.isValue(), `Expected concrete known positions but got ${vector.known.toString()}`);
	if(vector.known.isValue()) {
		const values = vector.known.value;
		assert.strictEqual(values.length, expectedValues.length,
			`Expected ${expectedValues.length} known positions but got ${values.length}`);

		for(let i = 0; i < expectedValues.length; i++) {
			const actual = values[i];
			const expected = expectedValues[i];
			assert.ok(actual.isValue(), `Expected position ${i + 1} to have concrete value`);
			if(actual.isValue()) {
				const innerDomain = (actual as unknown as { inner?: IntervalDomain }).inner;
				const inner = innerDomain ?? actual;
				assert.ok(inner.isValue(), `Expected position ${i + 1} to have concrete interval`);
				if(inner.isValue()) {
					const intervalVal = inner.value as [number, number];
					assert.deepStrictEqual(intervalVal, expected,
						`Position ${i + 1}: expected [${expected[0]}, ${expected[1]}] but got [${intervalVal[0]}, ${intervalVal[1]}]`);
				}
			}
		}
	}
}

/**
 * Assertion helper: Assert that a selection result has expected properties.
 * Combines length and known position checks for selection operations.
 * @param vector - The VectorDomain to check (may be undefined)
 * @param expectedLength - Expected [min, max] length
 * @param expectedPositions - Optional: expected values at known positions
 * @throws AssertionError if selection doesn't match expectations
 * @example
 * ```typescript
 * // Check only length
 * assertSelection(vector, [2, 2]);
 * // Check length and specific values
 * assertSelection(vector, [2, 2], [[10, 10], [30, 30]]);
 * ```
 */
export function assertSelection<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	vector: VectorDomain<Domain> | undefined,
	expectedLength: [number, number],
	expectedPositions?: [number, number][]
): void {
	assertLength(vector, expectedLength);
	if(expectedPositions !== undefined && vector !== undefined) {
		assertKnownPositions(vector, expectedPositions);
	}
}
