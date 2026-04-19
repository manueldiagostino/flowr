/* eslint-disable tsdoc/syntax */
import { type AnyAbstractDomain } from '../domains/abstract-domain';
import { type IntervalDomain } from '../domains/interval-domain';
import { type PosIntervalDomain } from '../domains/positive-interval-domain';
import { type VectorDomain } from './vector-domain';
import { KnownInitialPositionsDomain, type DomainFactory } from './known-initial-positions-domain';
import type { NAAwareDomain } from './na-aware-domain';
import { ConstraintType } from '../data-frame/semantics';
import { guard } from '../../util/assert';
import { vectorLogger } from './logger';
import { expensiveTrace } from '../../util/log';
import { formatVectorDomain, formatExtremeResult } from './log-utils';

export { ConstraintType };

/**
 * Computes the cardinality (number of integers) in a positive interval.
 * Per paper section 4.6: card([a, b]) = |b - a| + 1
 * Returns +Infinity if the upper bound is +Infinity.
 * @param interval - The positive interval domain
 * @returns The cardinality as a number, or +Infinity
 */
export function card(interval: PosIntervalDomain): number {
	vectorLogger.debug('Semantic: card');
	if(interval.isBottom()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('bottom', 'interval is bottom'));
		return 0;
	}
	if(interval.isTop()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('top', 'interval is top'));
		return +Infinity;
	}
	if(!interval.isValue()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('top', 'interval is not a value'));
		return +Infinity;
	}
	const [l, u] = interval.value;
	if(u === +Infinity) {
		expensiveTrace(vectorLogger, () => 'Semantic: card result = +Infinity (upper bound is infinity)');
		return +Infinity;
	}
	const result = u - l + 1;
	expensiveTrace(vectorLogger, () => `Semantic: card result = ${result}`);
	return result;
}

/**
 * Checks if an interval is enumerable (has finite cardinality ≤ threshold).
 * Per paper section 4.6: Enumerable([a,b], θ) = card([a,b]) ≤ θ
 * @param interval - The positive interval domain
 * @param threshold - The maximum cardinality to consider enumerable (default: 50)
 * @returns True if the interval's cardinality is finite and ≤ threshold
 */
export function isEnumerable(interval: PosIntervalDomain, threshold = 50): boolean {
	vectorLogger.debug(`Semantic: isEnumerable [threshold=${threshold}]`);
	const c = card(interval);
	const result = c !== +Infinity && c <= threshold;
	expensiveTrace(vectorLogger, () => `Semantic: isEnumerable result = ${result} (card=${c}, threshold=${threshold})`);
	return result;
}

/**
 * Squashes (joins) all values in a vector's known positions and summary.
 * Per paper section 4.6: Squash(p, s) = ⊔ᵢ pᵢ ⊔ s
 * This joins all known positions with the summary to get a single abstract value.
 * @param value - The abstract vector
 * @returns The joined abstract value representing all elements (as NAAwareDomain)
 */
export function squash<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>
): NAAwareDomain<Domain> {
	vectorLogger.debug('Semantic: squash');
	if(value.isBottom()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('bottom', 'vector is bottom'));
		return value.summary.bottom();
	}
	if(value.isTop()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('top', 'vector is top'));
		return value.summary;
	}

	let result = value.summary;

	for(const elem of value.known.toArray()) {
		result = result.join(elem);
	}

	expensiveTrace(vectorLogger, () => `Semantic: squash result = ${result.toString()}`);
	return result;
}

/**
 * Squashes (joins) all values in a vector's known positions and summary, except those in the excluded set.
 * Per paper section 4.6: SquashedExcept(([l, u], prefix, s, a), E) = ⊔_{i=1, i∉E}^{|prefix|} pᵢ ⊔ s
 * This joins all known positions (except excluded indices) with the summary to get a single abstract value.
 * @param value - The abstract vector
 * @param excludedIndices - Set of 1-based indices to exclude from the join
 * @returns The joined abstract value representing all non-excluded elements (as NAAwareDomain)
 */
export function squashedExcept<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>,
	excludedIndices: ReadonlySet<number>
): NAAwareDomain<Domain> {
	vectorLogger.debug(`Semantic: squashedExcept [excluded=${excludedIndices.size}]`);
	if(value.isBottom()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('bottom', 'vector is bottom'));
		return value.summary.bottom();
	}
	if(value.isTop()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('top', 'vector is top'));
		return value.summary.top();
	}

	let result = value.summary;

	if(value.known.isValue()) {
		const valuesArray = value.known.value as readonly NAAwareDomain<Domain>[];
		for(let i = 0; i < valuesArray.length; i++) {
			if(!excludedIndices.has(i + 1)) {
				result = result.join(valuesArray[i]);
			}
		}
	}

	expensiveTrace(vectorLogger, () => `Semantic: squashedExcept result = ${result.toString()}`);
	return result;
}

/**
 * Propagates values forward through positions containing zero.
 * Per paper Section 4.8: Propagate : Itv^* × Itv × N → Itv
 * The counter k tracks pending zeros to absorb.
 *
 * Note: Uses IntervalDomain (not PosIntervalDomain) as the paper specifies
 * Itv for the general interval domain allowing negative values.
 * @param knownPositions - The remaining known positions to process
 * @param summary - The summary value for positions beyond the known positions
 * @param k - The count of pending zeros
 * @returns The propagated abstract value
 */
export function propagate(
	knownPositions: readonly NAAwareDomain<IntervalDomain>[],
	summary: NAAwareDomain<IntervalDomain>,
	k: number
): NAAwareDomain<IntervalDomain> {
	vectorLogger.debug(`Semantic: propagate [knownPositions=${knownPositions.length}, k=${k}]`);
	if(knownPositions.length === 0) {
		expensiveTrace(vectorLogger, () => `Semantic: propagate base case result = ${summary.toString()}`);
		return summary;
	}

	const first = knownPositions[0];
	const rest = knownPositions.slice(1);

	if(first.inner.isValue()) {
		const [l, u] = first.inner.value;

		// Check if definitely zero: γ(c₁) = {0}
		if(l === 0 && u === 0) {
			// Skip and increment counter
			const result = propagate(rest, summary, k + 1);
			expensiveTrace(vectorLogger, () => `Semantic: propagate zero-skip result = ${result.toString()}`);
			return result;
		}

		// Check if may contain zero: 0 ∈ γ(pᵢ) but γ(pᵢ) ≠ {0}
		if(l <= 0 && u >= 0) {
			// Join with propagated value from rest (paper specifies ⊔)
			const propagated = propagate(rest, summary, k);
			const result = first.join(propagated);
			expensiveTrace(vectorLogger, () => `Semantic: propagate may-zero result = ${result.toString()}`);
			return result;
		}
	} else if(first.isNA()) {
		// position is a pure NA - treat as non-zero and continue
		// NA values are not zeros, so they don't affect the zero counter
	} else if(first.isBottom()) {
		// position is bottom (no possible values) - propagate bottom
		const result = summary.bottom();
		expensiveTrace(vectorLogger, () => `Semantic: propagate bottom result = ${result.toString()}`);
		return result;
	}
	// For Top or pure NA, continue to non-zero handling below

	// Non-zero value
	if(k > 0) {
		// Decrement counter and continue, joining with first (per paper L411)
		return first.join(propagate(rest, summary, k - 1));
	}

	// k = 0, return this value
	expensiveTrace(vectorLogger, () => `Semantic: propagate non-zero k=0 result = ${first.toString()}`);
	return first;
}

/**
 * Adjusts selector length bounds by accounting for zeros in the known positions.
 * Per paper Section 4.8: AdjustForZeros([l, u], p, s, a) = ([l', u'], p', s, a) where p = known positions
 *
 * Computes:
 * - l' = l - |\{i ≤ n : 0 ∈ γ(pᵢ)\}|
 * - u' = u - |\{i ≤ n : γ(pᵢ) = \{0\}\}|
 *
 * And builds modified known positions using Propagate.
 *
 * Note: Uses IntervalDomain for the selector values as per paper's V_Itv,
 * but returns the adjusted vector with the original domain type.
 * @param vector - The selector abstract vector with IntervalDomain elements
 * @returns The adjusted abstract vector
 */
export function adjustForZeros(
	vector: VectorDomain<IntervalDomain>
): VectorDomain<IntervalDomain> {
	vectorLogger.debug('Semantic: adjustForZeros');
	if(vector.isBottom()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('bottom', 'vector is bottom'));
		return vector;
	}
	if(vector.isTop()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('top', 'vector is top'));
		return vector;
	}

	const { length, known, summary, attributes } = vector;

	if(!length.isValue()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('top', 'length is not value'));
		return vector.top();
	}

	const [l, u] = length.value;

	// Count zeros in known positions
	let definiteZeros = 0; // |{i : γ(pᵢ) = {0}}|
	let possibleZeros = 0; // |{i : 0 ∈ γ(pᵢ)}|

	if(known.isValue() && Array.isArray(known.value)) {
		const knownPositionValues = known.value as readonly NAAwareDomain<IntervalDomain>[];
		for(const naVal of knownPositionValues) {
			const val = naVal.inner;
			if(val.isValue()) {
				const [vl, vu] = val.value;
				if(vl === 0 && vu === 0) {
					definiteZeros++;
					possibleZeros++;
				} else if(vl <= 0 && vu >= 0) {
					possibleZeros++;
				}
			} else if(!val.isBottom()) {
				// Top or other non-specific - may contain zero
				possibleZeros++;
			}
		}
	}

	// Compute new length bounds
	const newL = Math.max(0, l - possibleZeros);
	const newU = u === +Infinity ? +Infinity : Math.max(0, u - definiteZeros);
	const newLength = length.create([newL, newU]);

	// Build modified known positions using Propagate
	const newKnownPositionValues: NAAwareDomain<IntervalDomain>[] = [];

	if(known.isValue() && Array.isArray(known.value)) {
		const knownPositionValues = known.value as readonly NAAwareDomain<IntervalDomain>[];

		for(let i = 0; i < knownPositionValues.length; i++) {
			// Count zeros before position i
			let zerosBefore = 0;
			for(let j = 0; j < i; j++) {
				const prevVal = knownPositionValues[j].inner;
				if(prevVal.isValue()) {
					const [pl, pu] = prevVal.value;
					if(pl <= 0 && pu >= 0) {
						zerosBefore++;
					}
				}
			}

			const remainingValues = knownPositionValues.slice(i);
			const propagated = propagate(remainingValues, summary, zerosBefore);
			if(!propagated.isBottom()) {
				newKnownPositionValues.push(propagated);
			}
		}
	}

	const newValues = known.create(newKnownPositionValues);

	const result = vector.create({
		length:     newLength,
		known:      newValues,
		summary:    summary,
		attributes: attributes,
		type:       vector.type
	});
	expensiveTrace(vectorLogger, () => `Semantic: adjustForZeros result = ${formatVectorDomain(result)}`);
	return result;
}

/**
 * Initializes a known positions array with a specific pattern.
 * Per paper Section 4.8: InitPrefix(prefix, l, u, u_r)
 *
 * Pattern: [p_1 ... p_l] ++ [p_\{l+1\} ⊔ NA ... p_u ⊔ NA] ++ [NA ... NA]^(u_r - u)
 * @param knownPositions - The source known positions array
 * @param l - Lower bound of original vector length
 * @param u - Upper bound of original vector length
 * @param uR - Target upper bound for result
 * @param naValue - The NA abstract value
 * @returns Initialized known positions array
 */
export function initKnownPositions<Domain extends AnyAbstractDomain>(
	knownPositions: readonly NAAwareDomain<Domain>[],
	l: number,
	u: number,
	uR: number,
	naValue: NAAwareDomain<Domain>
): NAAwareDomain<Domain>[] {
	vectorLogger.debug(`Semantic: initKnownPositions [l=${l}, u=${u}, uR=${uR}]`);
	const result: NAAwareDomain<Domain>[] = [];

	// First l elements: keep as-is (positions 1 to l)
	for(let i = 0; i < Math.min(l, knownPositions.length); i++) {
		result.push(knownPositions[i]);
	}

	// Positions l+1 to u: join with NA
	for(let i = l; i < Math.min(u, knownPositions.length); i++) {
		result.push(knownPositions[i].join(naValue));
	}

	// Positions u+1 to u_r: fill with NA
	for(let i = u; i < uR; i++) {
		result.push(naValue);
	}

	expensiveTrace(vectorLogger, () => `Semantic: initKnownPositions result length=${result.length}`);
	return result;
}

/**
 * Recursively updates positions in a target known positions array.
 * Per paper Section 4.8: UpdatePrefix(prefix, selectorPositions, values)
 *
 * For each position in selectorPositions:
 * - If enumerable and singleton: strong update (replace)
 * - If enumerable but not singleton: weak update (join)
 * - If not enumerable: weak update all positions
 * @param knownPositions - The target known positions to update
 * @param selectorPositions - The selector intervals (positions to update)
 * @param values - The values to write (cyclic)
 * @returns Updated known positions array
 */
export function updateKnownPositions<Domain extends AnyAbstractDomain>(
	knownPositions: NAAwareDomain<Domain>[],
	selectorPositions: readonly NAAwareDomain<IntervalDomain>[],
	values: readonly NAAwareDomain<Domain>[]
): NAAwareDomain<Domain>[] {
	vectorLogger.debug(`Semantic: updateKnownPositions [selectorPositions=${selectorPositions.length}]`);
	if(selectorPositions.length === 0 || values.length === 0) {
		expensiveTrace(vectorLogger, () => 'Semantic: updateKnownPositions early return');
		return knownPositions;
	}

	const result = [...knownPositions];
	let valueIdx = 0;

	for(const posInterval of selectorPositions) {
		if(posInterval.isBottom()) {
			continue;
		}

		const valueToWrite = values[valueIdx % values.length];

		if(posInterval.isValue() && posInterval.inner.isValue()) {
			const [l, u] = posInterval.inner.value;

			// Skip zero index
			if(l === 0 && u === 0) {
				continue;
			}
			guard(l>=0, `Negative index detected for position ${valueIdx}.`);

			// Get actual positions (1-indexed to 0-indexed)
			const startPos = l == 0 ? 1 : l;
			const endPos = u;

			if(isEnumerable(posInterval.inner)) {
				// Enumerable: update specific positions
				const isSingleton = card(posInterval.inner) === 1;
				for(let pos = startPos; pos <= endPos && pos <= result.length; pos++) {
					const idx = pos - 1;
					if(isSingleton) {
						// Strong update: replace
						result[idx] = valueToWrite;
					} else {
						// Weak update: join
						result[idx] = result[idx].join(valueToWrite);
					}
				}
			} else {
				// Not enumerable: weak update all positions
				for(let i = 0; i < result.length; i++) {
					result[i] = result[i].join(valueToWrite);
				}
			}
		} else {
			// Non-specific interval: weak update all
			for(let i = 0; i < result.length; i++) {
				result[i] = result[i].join(valueToWrite);
			}
		}

		valueIdx++;
	}

	expensiveTrace(vectorLogger, () => `Semantic: updateKnownPositions result length=${result.length}`);
	return result;
}

/**
 * Generates cyclic known positions from a vector up to a target length.
 * Per paper Section 4.8: ρ_f^♯(ν, l, u_r)
 *
 * Cycles through the vector's known positions and summary to generate
 * values up to the target length.
 * @param vector - The source vector
 * @param targetLength - The target length to generate
 * @returns Array of abstract values
 */
export function generateCyclicKnownPositions<Domain extends AnyAbstractDomain>(
	vector: VectorDomain<Domain>,
	targetLength: number
): NAAwareDomain<Domain>[] {
	vectorLogger.debug(`Semantic: generateCyclicKnownPositions [targetLength=${targetLength}]`);
	const result: NAAwareDomain<Domain>[] = [];

	if(vector.isBottom()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('bottom', 'vector is bottom'));
		return result;
	}

	const knownPositions = vector.known.isValue()
		? (vector.known.value as readonly NAAwareDomain<Domain>[])
		: [];

	for(let i = 0; i < targetLength; i++) {
		if(i < knownPositions.length) {
			result.push(knownPositions[i]);
		} else {
			const cyclicIdx = (i - knownPositions.length) % Math.max(1, knownPositions.length || 1);
			if(knownPositions.length > 0 && cyclicIdx < knownPositions.length) {
				result.push(knownPositions[cyclicIdx]);
			} else {
				result.push(vector.summary);
			}
		}
	}

	expensiveTrace(vectorLogger, () => `Semantic: generateCyclicKnownPositions result length=${result.length}`);
	return result;
}

/**
 * Helper: Access abstract value at position j from vector.
 * Per paper: ν*♯(j) = p_ν,j if 1 ≤ j ≤ u_ν, otherwise α(NA)
 * Note: Uses 0-based indexing internally.
 */
/**
 *
 */
export function accessPosition<Domain extends AnyAbstractDomain>(
	vector: VectorDomain<Domain>,
	pos: number,
	naValue: NAAwareDomain<Domain>
): NAAwareDomain<Domain> {
	vectorLogger.debug(`Semantic: accessPosition [pos=${pos}]`);
	if(vector.isBottom()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('bottom', 'vector is bottom'));
		return vector.summary;
	}
	if(vector.isTop()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('top', 'vector is top'));
		return vector.summary;
	}

	const lengthUpperBound = getLengthUpperBound(vector.length);

	if(lengthUpperBound === undefined) {
		const result = squash(vector);
		expensiveTrace(vectorLogger, () => `Semantic: accessPosition undefined-bound result = ${result.toString()}`);
		return result;
	}

	if(lengthUpperBound === +Infinity) {
		const result = accessFromInfiniteLengthVector(vector, pos);
		expensiveTrace(vectorLogger, () => `Semantic: accessPosition infinite-length result = ${result.toString()}`);
		return result;
	}

	const result = accessFromFiniteLengthVector(vector, pos, naValue, lengthUpperBound);
	expensiveTrace(vectorLogger, () => `Semantic: accessPosition finite-length result = ${result.toString()}`);
	return result;
}

function getLengthUpperBound(length: PosIntervalDomain): number | undefined {
	if(!length.isValue()) {
		return undefined;
	}
	return length.value[1];
}

function accessFromInfiniteLengthVector<Domain extends AnyAbstractDomain>(
	vector: VectorDomain<Domain>,
	pos: number,
): NAAwareDomain<Domain> {
	if(vector.known.isValue()) {
		const values = vector.known.value as readonly NAAwareDomain<Domain>[];
		if(pos < values.length) {
			return values[pos];
		}
	}
	return vector.summary;
}

function accessFromFiniteLengthVector<Domain extends AnyAbstractDomain>(
	vector: VectorDomain<Domain>,
	pos: number,
	naValue: NAAwareDomain<Domain>,
	lengthUpperBound: number
): NAAwareDomain<Domain> {
	const oneIndexedPos = pos + 1;
	if(oneIndexedPos < 1 || oneIndexedPos > lengthUpperBound) {
		return naValue;
	}

	if(vector.known.isValue()) {
		const values = vector.known.value as readonly NAAwareDomain<Domain>[];
		if(pos < values.length) {
			return values[pos];
		}
	}

	return vector.summary;
}

/**
 * Helper: Counts zeros in a PosIntervalDomain vector (for AdjustForZeros).
 * Returns interval representing the number of zeros in the selector.
 *
 * For PosIntervalDomain: zero is represented as [0, 0].
 * A position definitely contains zero if the interval is exactly [0, 0].
 * A position may contain zero if 0 is in the interval range.
 */
export function countZerosInIntervalVector(
	selector: VectorDomain<PosIntervalDomain>
): PosIntervalDomain {
	vectorLogger.debug('Semantic: countZerosInIntervalVector');
	if(selector.isBottom()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('bottom', 'selector is bottom'));
		return selector.length.bottom();
	}
	if(selector.isTop()) {
		expensiveTrace(vectorLogger, () => formatExtremeResult('top', 'selector is top'));
		return selector.length.create([0, +Infinity]);
	}

	let definiteZeros = 0;
	let possibleZeros = 0;

	// Check known position values for zeros
	if(selector.known.isValue()) {
		const values = selector.known.value;
		for(const naVal of values) {
			const val = naVal.inner;
			if(val.isValue()) {
				const [l, u] = val.value;
				if(l === 0 && u === 0) {
					// Definitely zero
					definiteZeros++;
					possibleZeros++;
				} else if(l <= 0 && u >= 0) {
					// May contain zero
					possibleZeros++;
				}
			} else if(!val.isBottom()) {
				// Top or other non-specific value - may contain zero
				possibleZeros++;
			}
		}
	}

	// For summary: conservatively assume it may contain zeros
	if(!selector.summary.isBottom()) {
		// Summary represents all positions beyond the known positions
		// We don't know how many, so return unbounded
		if(selector.length.isValue()) {
			const [, u] = selector.length.value;
			if(u === +Infinity) {
				return selector.length.create([definiteZeros, +Infinity]);
			}
		}
	}

	const result = selector.length.create([definiteZeros, possibleZeros]);
	expensiveTrace(vectorLogger, () => `Semantic: countZerosInIntervalVector result = ${result.toString()}`);
	return result;
}

/**
 * Concrete recycle function (paper Section 4.5: ρ_c^♯).
 * Cycles the first i' = min(i, |prefix|) elements of the prefix
 * to reach length h.
 *
 * More formally:
 * ρ_c^♯(prefix, i, h) ≡
 *   (p_1 ⊔ ... ⊔ p_{i'} ⊔ ... ⊔ p_1 ⊔ ... ⊔ p_{i'}) [floor(h/i') times]
 *   ⊕ (p_1 ⊔ ... ⊔ p_r) [first r = h mod i' elements]
 * @param prefix - The known positions domain (genvaldom^* in paper)
 * @param i - Starting position (1-indexed in paper)
 * @param h - Target length to reach
 * @param factory - Domain factory for creating known positions
 * @returns KnownInitialPositionsDomain of length h
 */
export function rhoC<Domain extends AnyAbstractDomain>(
	prefix: KnownInitialPositionsDomain<Domain>,
	i: number,
	h: number,
	factory: DomainFactory<Domain>
): KnownInitialPositionsDomain<Domain> {
	vectorLogger.debug(`Semantic: rhoC [i=${i}, h=${h}]`);

	if(prefix.isBottom() || prefix.isTop() || h === 0) {
		expensiveTrace(vectorLogger, () => 'Semantic: rhoC early return (bottom/top or h=0)');
		return KnownInitialPositionsDomain.top(factory);
	}

	if(!prefix.isValue()) {
		return KnownInitialPositionsDomain.top(factory);
	}

	const prefixLen = prefix.length;
	guard(prefixLen !== undefined, 'KnownInitialPositionsDomain.length is undefined after isValue check');
	const sourceElements = prefix.value;

	// i' = min(i, |prefix|), paper uses 1-indexed math
	const iPrime = Math.min(i, prefixLen);

	if(iPrime === 0) {
		return KnownInitialPositionsDomain.top(factory);
	}

	const result: Domain[] = [];

	// repeat floor(h / i') times
	const fullRepeats = Math.floor(h / iPrime);
	const remainder = h % iPrime;

	for(let repeat = 0; repeat < fullRepeats; repeat++) {
		for(let j = 0; j < iPrime; j++) {
			result.push(sourceElements[j]);
		}
	}

	// first r = h mod i' elements
	for(let j = 0; j < remainder; j++) {
		result.push(sourceElements[j]);
	}

	expensiveTrace(vectorLogger, () => `Semantic: rhoC result length=${result.length}`);
	return new KnownInitialPositionsDomain(result, factory);
}

/**
 * Abstract recycle helper function (paper Section 4.5: ρ_f^♯).
 * Joins all ρ_c^♯ results from i=l to n.
 *
 * More formally:
 * ρ_f^♯(prefix, l, n) ≡ ⊔_{i=l}^{n} ρ_c^♯(prefix, i, n)
 *
 * This is used in the abstract recycling operation (paper Section 4.5)
 * to compute the joined prefix for all possible starting positions.
 * @param prefix - The known positions domain (genvaldom^* in paper)
 * @param i - Starting position (1-indexed in paper)
 * @param h - Target length to reach
 * @param factory - Domain factory for creating elements
 * @returns Joined abstract value (callers must handle wrapping if needed)
 */
export function rhoF<Domain extends AnyAbstractDomain>(
	prefix: KnownInitialPositionsDomain<Domain>,
	l: number,
	n: number,
	factory: DomainFactory<Domain>
): KnownInitialPositionsDomain<Domain> {
	vectorLogger.debug(`Semantic: rhoF [l=${l}, n=${n}]`);

	if(prefix.isBottom() || prefix.isTop() || n === 0) {
		expensiveTrace(vectorLogger, () => 'Semantic: rhoF early return (bottom/top or n=0)');
		return KnownInitialPositionsDomain.bottom(factory);
	}

	if(!prefix.isValue()) {
		return KnownInitialPositionsDomain.bottom(factory);
	}

	const prefixLen = prefix.length;
	guard(prefixLen !== undefined, 'KnownInitialPositionsDomain.length is undefined after isValue check');

	let result = rhoC(prefix, l, n, factory);
	for(let i = l + 1; i <= n; i++) {
		result = result.join(rhoC(prefix, i, n, factory));
	}

	expensiveTrace(vectorLogger, () => `Semantic: rhoF result = ${result.toString()}`);
	return result;
}
