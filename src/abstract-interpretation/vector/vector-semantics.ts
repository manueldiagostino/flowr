import type { AnyAbstractDomain } from '../domains/abstract-domain';
import type { IntervalDomain } from '../domains/interval-domain';
import type { PosIntervalDomain } from '../domains/positive-interval-domain';
import type { VectorDomain } from './vector-domain';
import { ConstraintType } from '../data-frame/semantics';

export { ConstraintType };

/**
 * Computes the cardinality (number of integers) in a positive interval.
 * Per paper section 4.6: card([a, b]) = |b - a| + 1
 * Returns +Infinity if the upper bound is +Infinity.
 * @param interval - The positive interval domain
 * @returns The cardinality as a number, or +Infinity
 */
export function card(interval: PosIntervalDomain): number {
	if(interval.isBottom()) {
		return 0;
	}
	if(interval.isTop()) {
		return +Infinity;
	}
	if(!interval.isValue()) {
		return +Infinity;
	}
	const [l, u] = interval.value;
	if(u === +Infinity) {
		return +Infinity;
	}
	return u - l + 1;
}

/**
 * Checks if an interval is enumerable (has finite cardinality ≤ threshold).
 * Per paper section 4.6: Enumerable([a,b], θ) = card([a,b]) ≤ θ
 * @param interval - The positive interval domain
 * @param threshold - The maximum cardinality to consider enumerable (default: 50)
 * @returns True if the interval's cardinality is finite and ≤ threshold
 */
export function isEnumerable(interval: PosIntervalDomain, threshold = 50): boolean {
	const c = card(interval);
	return c !== +Infinity && c <= threshold;
}

/**
 * Squashes (joins) all values in a vector's known positions and summary.
 * Per paper section 4.6: Squash(p, s) = ⊔ᵢ pᵢ ⊔ s
 * This joins all known positions with the summary to get a single abstract value.
 * @param value - The abstract vector
 * @returns The joined abstract value representing all elements
 */
export function squash<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>
): Domain {
	if(value.isBottom()) {
		return value.summary.bottom();
	}
	if(value.isTop()) {
		return value.summary.top();
	}

	let result = value.summary;

	if(value.values.isValue()) {
		const valuesArray = value.values.value as readonly Domain[];
		for(const elem of valuesArray) {
			result = result.join(elem);
		}
	}

	return result;
}

/**
 * Propagates values forward through positions containing zero.
 * Per paper Section 4.8: Propagate : V_Itv^* × V_Itv × N → V_Itv
 * The counter k tracks pending zeros to absorb.
 *
 * Note: Uses IntervalDomain (not PosIntervalDomain) as the paper specifies
 * V_Itv for the general interval domain allowing negative values.
 * @param knownPositions - The remaining known positions to process
 * @param summary - The summary value for positions beyond the known positions
 * @param k - The count of pending zeros
 * @returns The propagated abstract value
 */
export function propagate(
	knownPositions: readonly IntervalDomain[],
	summary: IntervalDomain,
	k: number
): IntervalDomain {
	if(knownPositions.length === 0) {
		return summary;
	}

	const first = knownPositions[0];
	const rest = knownPositions.slice(1);

	if(first.isValue()) {
		const [l, u] = first.value;

		// Check if definitely zero: γ(c₁) = {0}
		if(l === 0 && u === 0) {
			// Skip and increment counter
			return propagate(rest, summary, k + 1);
		}

		// Check if may contain zero: 0 ∈ γ(c₁) but γ(c₁) ≠ {0}
		if(l <= 0 && u >= 0) {
			// Join with propagated value from rest (paper specifies ⊔)
			const propagated = propagate(rest, summary, k);
			return first.join(propagated.value);
		}
	}

	// Non-zero value
	if(k > 0) {
		// Decrement counter and continue
		return propagate(rest, summary, k - 1);
	}

	// k = 0, return this value
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
	if(vector.isBottom()) {
		return vector;
	}
	if(vector.isTop()) {
		return vector;
	}

	const { length, values, summary, attributes } = vector;

	if(!length.isValue()) {
		return vector.top();
	}

	const [l, u] = length.value;

	// Count zeros in known positions
	let definiteZeros = 0; // |{i : γ(pᵢ) = {0}}|
	let possibleZeros = 0; // |{i : 0 ∈ γ(pᵢ)}|

	if(values.isValue() && Array.isArray(values.value)) {
		const knownPositionValues = values.value as readonly IntervalDomain[];
		for(const val of knownPositionValues) {
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
	const newKnownPositionValues: PosIntervalDomain[] = [];

	if(values.isValue() && Array.isArray(values.value)) {
		const knownPositionValues = values.value as readonly PosIntervalDomain[];

		for(let i = 0; i < knownPositionValues.length; i++) {
			// Count zeros before position i
			let zerosBefore = 0;
			for(let j = 0; j < i; j++) {
				const prevVal = knownPositionValues[j];
				if(prevVal.isValue()) {
					const [pl, pu] = prevVal.value;
					if(pl <= 0 && pu >= 0) {
						zerosBefore++;
					}
				}
			}

			const propagated = propagate(knownPositionValues.slice(i), summary, zerosBefore);
			if(!propagated.isBottom()) {
				newKnownPositionValues.push(propagated);
			}
		}
	}

	const newValues = values.create(newKnownPositionValues);

	return vector.create({
		length:  newLength,
		values:  newValues,
		summary: summary,
		attributes
	});
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
	knownPositions: readonly Domain[],
	l: number,
	u: number,
	uR: number,
	naValue: Domain
): Domain[] {
	const result: Domain[] = [];

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
	knownPositions: Domain[],
	selectorPositions: readonly PosIntervalDomain[],
	values: readonly Domain[]
): Domain[] {
	if(selectorPositions.length === 0 || values.length === 0) {
		return knownPositions;
	}

	const result = [...knownPositions];
	let valueIdx = 0;

	for(const posInterval of selectorPositions) {
		if(posInterval.isBottom()) {
			continue;
		}

		const valueToWrite = values[valueIdx % values.length];
		valueIdx++;

		if(posInterval.isValue()) {
			const [l, u] = posInterval.value;

			// Skip zero index
			if(l === 0 && u === 0) {
				continue;
			}

			// Get actual positions (1-indexed to 0-indexed)
			const startPos = l <= 0 ? 1 : l;
			const endPos = u;

			if(isEnumerable(posInterval)) {
				// Enumerable: update specific positions
				const isSingleton = card(posInterval) === 1;
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
	}

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
): Domain[] {
	const result: Domain[] = [];

	if(vector.isBottom()) {
		return result;
	}

	const knownPositions = vector.values.isValue()
		? (vector.values.value as readonly Domain[])
		: [];

	for(let i = 0; i < targetLength; i++) {
		if(i < knownPositions.length) {
			result.push(knownPositions[i]);
		} else {
			// Cycle through: use summary, then wrap around
			const cyclicIdx = (i - knownPositions.length) % Math.max(1, knownPositions.length || 1);
			if(knownPositions.length > 0 && cyclicIdx < knownPositions.length) {
				result.push(knownPositions[cyclicIdx]);
			} else {
				result.push(vector.summary);
			}
		}
	}

	return result;
}

/**
 * Helper: Access abstract value at position j from vector.
 * Per paper: ν*♯(j) = p_ν,j if 1 ≤ j ≤ u_ν, otherwise α(NA)
 * Note: Uses 0-based indexing internally.
 */
export function accessPosition<Domain extends AnyAbstractDomain>(
	vector: VectorDomain<Domain>,
	pos: number,
	naValue: Domain
): Domain {
	if(vector.isBottom()) {
		return vector.summary.bottom();
	}
	if(vector.isTop()) {
		return vector.summary.top();
	}

	// Get upper bound of vector length (0-indexed, so u_ν - 1)
	let upperBound: number;
	if(vector.length.isValue()) {
		upperBound = vector.length.value[1];
		if(upperBound === +Infinity) {
			// For infinite length, check known positions
			if(vector.values.isValue()) {
				const values = vector.values.value as readonly Domain[];
				if(pos < values.length) {
					return values[pos];
				}
			}
			return vector.summary;
		}
	} else {
		// Cannot determine bounds, return join of all possible values
		return squash(vector);
	}

	// Position is 0-indexed, paper uses 1-indexed
	const oneIndexedPos = pos + 1;
	if(oneIndexedPos >= 1 && oneIndexedPos <= upperBound) {
		if(vector.values.isValue()) {
			const values = vector.values.value as readonly Domain[];
			if(pos < values.length) {
				return values[pos];
			}
		}
		// Position exists but not in known positions - use summary
		return vector.summary;
	}

	// Position out of bounds - return NA
	return naValue;
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
	if(selector.isBottom()) {
		return selector.length.bottom();
	}
	if(selector.isTop()) {
		return selector.length.create([0, +Infinity]);
	}

	let definiteZeros = 0;
	let possibleZeros = 0;

	// Check known position values for zeros
	if(selector.values.isValue()) {
		const values = selector.values.value as readonly PosIntervalDomain[];
		for(const val of values) {
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

	return selector.length.create([definiteZeros, possibleZeros]);
}

/**
 * Classification of an abstract position interval by its sign.
 * Used for abstract filtering in vector selection (paper section 4.7).
 */
export type PositionClassification = 'positive' | 'negative' | 'ambiguous' | 'bottom';

/**
 * Classifies an abstract position interval by its sign.
 * Per paper section 4.7: positions are filtered into positive (≥ 0) and negative (≤ 0) sets.
 *
 * @param position - The PosIntervalDomain to classify
 * @returns The classification: 'positive' if definitely > 0, 'negative' if definitely < 0,
 *          'ambiguous' if spans 0 or includes 0, 'bottom' if Bottom
 */
export function classifyPosition(position: PosIntervalDomain): PositionClassification {
	if(position.isBottom()) {
		return 'bottom';
	}
	if(position.isTop()) {
		// [0, +Infinity] - spans both sides
		return 'ambiguous';
	}
	if(!position.isValue()) {
		return 'ambiguous';
	}

	const [lower, upper] = position.value;

	if(lower > 0) {
		// Definitely positive (strictly greater than 0)
		return 'positive';
	}
	if(upper < 0) {
		// Definitely negative (strictly less than 0)
		return 'negative';
	}
	// Spans 0 or includes 0: [lower ≤ 0 ≤ upper]
	return 'ambiguous';
}

/**
 * Result of splitting an ambiguous position into positive and negative parts.
 */
export interface SplitPosition {
	/** The positive part (≥ 0), or Bottom if no positive values */
	positive: PosIntervalDomain;
	/** The negative part (≤ 0), or Bottom if no negative values */
	negative: PosIntervalDomain;
}

/**
 * Splits an ambiguous position (one that spans or includes 0) into positive and negative parts.
 * Per paper section 4.7: ambiguous positions contribute to both positive and negative filters.
 *
 * Examples:
 * - [-2, 3] → positive: [0, 3], negative: [-2, 0]
 * - [0, 5] → positive: [0, 5], negative: [0, 0] (just zero)
 * - [-5, 0] → positive: [0, 0], negative: [-5, 0]
 * - [1, 5] → positive: [1, 5], negative: Bottom (no negative values)
 * - [-5, -1] → positive: Bottom, negative: [-5, -1]
 *
 * @param position - The position to split (must not be Bottom)
 * @returns Object with positive and negative parts
 */
export function splitAmbiguousPosition(position: PosIntervalDomain): SplitPosition {
	const bottom = position.bottom();

	if(position.isBottom()) {
		return { positive: bottom, negative: bottom };
	}
	if(!position.isValue()) {
		// Top or other non-specific value - return as-is for both
		return { positive: position, negative: position };
	}

	const [lower, upper] = position.value;

	// Positive part: [max(lower, 0), upper] if upper >= 0
	let positive: PosIntervalDomain;
	if(upper >= 0) {
		positive = position.create([Math.max(lower, 0), upper]);
	} else {
		positive = bottom;
	}

	// Negative part: [lower, min(upper, 0)] if lower <= 0
	let negative: PosIntervalDomain;
	if(lower <= 0) {
		negative = position.create([lower, Math.min(upper, 0)]);
	} else {
		negative = bottom;
	}

	return { positive, negative };
}

/**
 * Creates a new selector VectorDomain with filtered/split positions.
 * Used in abstract filtering to build positive and negative filtered selectors.
 *
 * @param selector - The original selector VectorDomain
 * @param positions - The new positions array (already filtered and split)
 * @returns A new VectorDomain with the given positions
 */
export function createFilteredSelector<Domain extends AnyAbstractDomain>(
	selector: VectorDomain<PosIntervalDomain>,
	positions: readonly PosIntervalDomain[]
): VectorDomain<PosIntervalDomain> {
	if(positions.length === 0) {
		return selector.bottom();
	}

	return selector.create({
		length: selector.length,
		values: selector.values.create(positions),
		summary: selector.summary,
		attributes: selector.attributes
	});
}
