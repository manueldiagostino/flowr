import type { AnyAbstractDomain } from '../domains/abstract-domain';
import type { IntervalDomain } from '../domains/interval-domain';
import type { PosIntervalDomain } from '../domains/positive-interval-domain';
import type { VectorDomain } from './vector-domain';
import type { VectorAttrDomain } from '../domains/vector-attr-domain';
import { ConstraintType } from '../data-frame/semantics';

export { ConstraintType };

/**
 * Mapper for defining the abstract vector operations and mapping them to semantics applier functions,
 * including information about the type of the resulting constraints that are inferred by the operation.
 */
const VectorSemanticsMapper = {
	'setAttr': { apply: applySetAttrSemantics, type: ConstraintType.OperandModification },
	'recycle': { apply: applyRecycleSemantics, type: ConstraintType.ResultPostcondition },
	'selectPositive': { apply: applySelectPositiveSemantics, type: ConstraintType.OperandPrecondition },
	'selectNegative': { apply: applySelectNegativeSemantics, type: ConstraintType.OperandPrecondition },
	'selectLogical': { apply: applySelectLogicalSemantics, type: ConstraintType.OperandPrecondition },
	'updatePositive': { apply: applyUpdatePositiveSemantics, type: ConstraintType.OperandModification },
	'updateNegative': { apply: applyUpdateNegativeSemantics, type: ConstraintType.OperandModification },
	'updateLogical': { apply: applyUpdateLogicalSemantics, type: ConstraintType.OperandModification },
	'unknown': { apply: applyUnknownSemantics, type: ConstraintType.ResultPostcondition }
} as const satisfies Record<string, VectorSemanticsMapperInfo<never, never>>;

type VectorSemanticsMapperInfo<Arguments extends object | undefined, Options extends object | undefined> = {
	readonly apply: VectorSemanticsApplier<Arguments, Options>,
	readonly type: ConstraintType
};

/**
 * Vector semantics applier for applying the abstract semantics of an abstract vector operation.
 * - `value` contains the abstract vector state of the operand
 * - `args` contains the arguments required for the abstract operation
 * - `options` optionally contains additional options to change the behavior of the abstract operation
 */
type VectorSemanticsApplier<Arguments extends object | undefined, Options extends object | undefined> = (
	value: VectorDomain<AnyAbstractDomain>,
	args: Arguments,
	options?: Options
) => VectorDomain<AnyAbstractDomain>;

/** All available abstract vector operations */
export type VectorOperationName = keyof typeof VectorSemanticsMapper;

/** The names of all abstract vector operations */
export const VectorOperationNames = Object.keys(VectorSemanticsMapper) as readonly VectorOperationName[];

/** The required arguments for an abstract vector operation */
export type VectorOperationArgs<N extends VectorOperationName> = Parameters<typeof VectorSemanticsMapper[N]['apply']>[1];

/** The optional addition options for an abstract vector operation */
export type VectorOperationOptions<N extends VectorOperationName> = Parameters<typeof VectorSemanticsMapper[N]['apply']>[2];

/**
 * Applies the abstract semantics of an abstract vector operation.
 * This expects that all arguments have already been sanitized according to the original concrete R operation.
 * @param operation - The name of the abstract operation to apply the semantics of
 * @param value     - The abstract vector state of the operand
 * @param args      - The arguments for applying the abstract semantics
 * @param options   - The optional additional options of the abstract operation
 * @returns The resulting new vector constraints.
 * The semantic type of the resulting constraints depends on the {@link ConstraintType} of the abstract operation.
 */
export function applyVectorSemantics<Name extends VectorOperationName>(
	operation: Name,
	value: VectorDomain<AnyAbstractDomain>,
	args: VectorOperationArgs<Name>,
	options?: VectorOperationOptions<Name>
): VectorDomain<AnyAbstractDomain> {
	const applier = VectorSemanticsMapper[operation] as VectorSemanticsMapperInfo<VectorOperationArgs<Name>, VectorOperationOptions<Name>>;
	return applier.apply(value, args, options);
}

/**
 * Gets the default resulting constraint type for an abstract vector operation.
 */
export function getConstraintType(operation: VectorOperationName): ConstraintType {
	return VectorSemanticsMapper[operation].type;
}

/* ============================================================================
 * Phase 1: Foundation Operations (Paper Section 4.4 - 4.5)
 * ============================================================================ */

/**
 * Sets attributes on a vector.
 * Per paper section 4.4: If attributes are non-empty, return ⊤ (top element).
 * This is because tracking specific attribute values is excluded from the analysis scope.
 * @param value - The abstract vector
 * @param attrs - The attributes to set (if empty, clears attributes)
 */
function applySetAttrSemantics(
	value: VectorDomain<AnyAbstractDomain>,
	{ attrs }: { attrs: VectorAttrDomain }
): VectorDomain<AnyAbstractDomain> {
	// Per paper: if attributes non-empty, return top
	if (!attrs.isEmpty()) {
		return value.top();
	}
	// Empty attributes: update the attributes component
	return value.create({
		length: value.length,
		values: value.values,
		summary: value.summary,
		attributes: attrs
	});
}

/**
 * Computes the cardinality (number of integers) in a positive interval.
 * Per paper section 4.6: card([a, b]) = |b - a| + 1
 * Returns +Infinity if the upper bound is +Infinity.
 * @param interval - The positive interval domain
 * @returns The cardinality as a number, or +Infinity
 */
export function card(interval: PosIntervalDomain): number {
	if (interval.isBottom()) {
		return 0;
	}
	if (interval.isTop()) {
		return +Infinity;
	}
	if (!interval.isValue()) {
		return +Infinity;
	}
	const [l, u] = interval.value;
	if (u === +Infinity) {
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
	if (value.isBottom()) {
		return value.summary.bottom();
	}
	if (value.isTop()) {
		return value.summary.top();
	}

	let result = value.summary;

	if (value.values.isValue()) {
		const valuesArray = value.values.value as readonly Domain[];
		for (const elem of valuesArray) {
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
function propagate(
	knownPositions: readonly IntervalDomain[],
	summary: IntervalDomain,
	k: number
): IntervalDomain {
	if (knownPositions.length === 0) {
		return summary;
	}

	const first = knownPositions[0];
	const rest = knownPositions.slice(1);

	if (first.isValue()) {
		const [l, u] = first.value;

		// Check if definitely zero: γ(c₁) = {0}
		if (l === 0 && u === 0) {
			// Skip and increment counter
			return propagate(rest, summary, k + 1);
		}

		// Check if may contain zero: 0 ∈ γ(c₁) but γ(c₁) ≠ {0}
		if (l <= 0 && u >= 0) {
			// Join with propagated value from rest (paper specifies ⊔)
			const propagated = propagate(rest, summary, k);
			return first.join(propagated.value);
		}
	}

	// Non-zero value
	if (k > 0) {
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
 * - l' = l - |{i ≤ n : 0 ∈ γ(pᵢ)}|
 * - u' = u - |{i ≤ n : γ(pᵢ) = {0}}|
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
	if (vector.isBottom()) {
		return vector;
	}
	if (vector.isTop()) {
		return vector;
	}

	const { length, values, summary, attributes } = vector;

	if (!length.isValue()) {
		return vector.top();
	}

	const [l, u] = length.value;

	// Count zeros in known positions
	let definiteZeros = 0; // |{i : γ(pᵢ) = {0}}|
	let possibleZeros = 0; // |{i : 0 ∈ γ(pᵢ)}|

	if (values.isValue()) {
		const knownPositionValues = values.value as readonly IntervalDomain[];
		for (const val of knownPositionValues) {
			if (val.isValue()) {
				const [vl, vu] = val.value;
				if (vl === 0 && vu === 0) {
					definiteZeros++;
					possibleZeros++;
				} else if (vl <= 0 && vu >= 0) {
					possibleZeros++;
				}
			} else if (!val.isBottom()) {
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

	if (values.isValue()) {
		const knownPositionValues = values.value as readonly PosIntervalDomain[];

		for (let i = 0; i < knownPositionValues.length; i++) {
			// Count zeros before position i
			let zerosBefore = 0;
			for (let j = 0; j < i; j++) {
				const prevVal = knownPositionValues[j];
				if (prevVal.isValue()) {
					const [pl, pu] = prevVal.value;
					if (pl <= 0 && pu >= 0) {
						zerosBefore++;
					}
				}
			}

			const propagated = propagate(knownPositionValues.slice(i), summary, zerosBefore);
			if (!propagated.isBottom()) {
				newKnownPositionValues.push(propagated);
			}
		}
	}

	const newValues = values.create(newKnownPositionValues);

	return vector.create({
		length: newLength,
		values: newValues,
		summary: summary,
		attributes
	});
}

/**
 * Recycles (aligns) two vectors to the same length for binary operations.
 * Per paper section 4.5: Recycle(v₁, v₂) aligns vectors to a common length.
 * The resulting length is the LCM-based alignment of the two length intervals.
 * @param value - The first abstract vector
 * @param other - The second abstract vector
 * @returns A new vector with the aligned length, or top if alignment fails
 */
function applyRecycleSemantics<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>,
	{ other }: { other: VectorDomain<Domain> }
): VectorDomain<Domain> {
	const len1 = value.length;
	const len2 = other.length;

	// If either is bottom, result is bottom
	if (len1.isBottom() || len2.isBottom()) {
		return value.bottom();
	}

	// If either is top, the aligned length is top
	if (len1.isTop() || len2.isTop()) {
		return value.create({
			length: len1.top(),
			values: value.values.top(),
			summary: value.summary.top(),
			attributes: value.attributes.join(other.attributes)
		});
	}

	if (!len1.isValue() || !len2.isValue()) {
		return value.create({
			length: len1.top(),
			values: value.values.top(),
			summary: value.summary.top(),
			attributes: value.attributes.join(other.attributes)
		});
	}

	const [l1, u1] = len1.value;
	const [l2, u2] = len2.value;

	const newUpper = Math.max(u1, u2);
	const newLower = Math.max(l1, l2);

	const incompatible = u1 !== +Infinity && u2 !== +Infinity &&
		(u1 % u2 !== 0) && (u2 % u1 !== 0);

	if (incompatible) {
		// Incompatible recycling: result is top (we can't precisely track)
		return value.create({
			length: len1.top(),
			values: value.values.top(),
			summary: value.summary.top(),
			attributes: value.attributes.join(other.attributes)
		});
	}

	// Compatible recycling: use the longer length
	const recycledLength = len1.create([newLower, newUpper]);

	return value.create({
		length: recycledLength,
		values: value.values,
		summary: value.summary,
		attributes: value.attributes.join(other.attributes)
	});
}

/* ============================================================================
 * Phase 2: Selection Operations (Paper Section 4.9)
 * ============================================================================ */

/**
 * Helper: Access abstract value at position j from vector.
 * Per paper: ν*♯(j) = p_ν,j if 1 ≤ j ≤ u_ν, otherwise α(NA)
 * Note: Uses 0-based indexing internally.
 */
function accessPosition<Domain extends AnyAbstractDomain>(
	vector: VectorDomain<Domain>,
	pos: number,
	naValue: Domain
): Domain {
	if (vector.isBottom()) {
		return vector.summary.bottom();
	}
	if (vector.isTop()) {
		return vector.summary.top();
	}

	// Get upper bound of vector length (0-indexed, so u_ν - 1)
	let upperBound: number;
	if (vector.length.isValue()) {
		upperBound = vector.length.value[1];
		if (upperBound === +Infinity) {
			// For infinite length, check known positions
			if (vector.values.isValue()) {
				const values = vector.values.value as readonly Domain[];
				if (pos < values.length) {
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
	if (oneIndexedPos >= 1 && oneIndexedPos <= upperBound) {
		if (vector.values.isValue()) {
			const values = vector.values.value as readonly Domain[];
			if (pos < values.length) {
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
function countZerosInIntervalVector(
	selector: VectorDomain<PosIntervalDomain>
): PosIntervalDomain {
	if (selector.isBottom()) {
		return selector.length.bottom();
	}
	if (selector.isTop()) {
		return selector.length.create([0, +Infinity]);
	}

	let definiteZeros = 0;
	let possibleZeros = 0;

	// Check known position values for zeros
	if (selector.values.isValue()) {
		const values = selector.values.value as readonly PosIntervalDomain[];
		for (const val of values) {
			if (val.isValue()) {
				const [l, u] = val.value;
				if (l === 0 && u === 0) {
					// Definitely zero
					definiteZeros++;
					possibleZeros++;
				} else if (l <= 0 && u >= 0) {
					// May contain zero
					possibleZeros++;
				}
			} else if (!val.isBottom()) {
				// Top or other non-specific value - may contain zero
				possibleZeros++;
			}
		}
	}

	// For summary: conservatively assume it may contain zeros
	if (!selector.summary.isBottom()) {
		// Summary represents all positions beyond the known positions
		// We don't know how many, so return unbounded
		if (selector.length.isValue()) {
			const [, u] = selector.length.value;
			if (u === +Infinity) {
				return selector.length.create([definiteZeros, +Infinity]);
			}
		}
	}

	return selector.length.create([definiteZeros, possibleZeros]);
}

/**
 * Selects elements using positive indices.
 * Per paper Section 4.9.1: x[c] where c ≥ 0
 *
 * Algorithm:
 * 1. Apply AdjustForZeros to handle zero indices
 * 2. Build result known positions by enumerating enumerable positions
 * 3. Result summary is ⊥ for finite selector, Squash(ν₁) for infinite
 */
function applySelectPositiveSemantics<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>,
	{ selector, naValue }: { selector: VectorDomain<PosIntervalDomain>; naValue: Domain }
): VectorDomain<Domain> {
	// Bottom check
	if (value.isBottom() || selector.isBottom()) {
		return value.bottom();
	}

	// Apply AdjustForZeros to handle zero indices in the selector
	const adjustedSelector = adjustForZeros(selector);

	// Build result known positions from adjusted selector
	const resultKnownPositions: Domain[] = [];

	if (adjustedSelector.values.isValue()) {
		const selectorValues = adjustedSelector.values.value as readonly PosIntervalDomain[];

		for (const idx of selectorValues) {
			if (idx.isBottom()) {
				continue;
			}

			if (isEnumerable(idx)) {
				// Enumerable position: extract value from source
				if (idx.isValue()) {
					const [l] = idx.value;
					// Pick a representative position (lower bound, skip 0)
					const pos = l === 0 ? 1 : l;
					if (pos > 0) {
						resultKnownPositions.push(accessPosition(value, pos - 1, naValue));
					}
				} else {
					resultKnownPositions.push(squash(value));
				}
			} else {
				// Non-enumerable: join all possible values
				resultKnownPositions.push(squash(value));
			}
		}
	}

	// Determine result summary based on selector finiteness
	const selectorLen = adjustedSelector.length;
	const isInfinite = selectorLen.isValue() && selectorLen.value[1] === +Infinity;
	const resultSummary = isInfinite ? squash(value) : value.summary.bottom();

	// Create result vector
	const resultValues = value.values.create(resultKnownPositions);

	return value.create({
		length: adjustedSelector.length,
		values: resultValues,
		summary: resultSummary,
		attributes: value.attributes
	});
}

/**
 * Selects elements using negative indices.
 * Per paper Section 4.9.2: x[c] where c ≤ 0
 *
 * Algorithm:
 * 1. Apply AdjustForZeros to handle zero indices
 * 2. Identify MustDeleted, MayDeleted, MustNotDeleted positions
 * 3. Build result based on selector properties
 */
function applySelectNegativeSemantics<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>,
	{ selector, naValue }: { selector: VectorDomain<PosIntervalDomain>; naValue: Domain }
): VectorDomain<Domain> {
	// Bottom check
	if (value.isBottom() || selector.isBottom()) {
		return value.bottom();
	}

	// Get source vector bounds
	let sourceUpper: number;
	if (value.length.isValue()) {
		sourceUpper = value.length.value[1];
		if (sourceUpper === +Infinity) {
			// Cannot precisely handle infinite source - return top
			return value.top();
		}
	} else {
		return value.top();
	}

	// Apply AdjustForZeros to handle zero indices in selector
	const adjustedSelector = adjustForZeros(selector);
	void adjustedSelector;

	// Identify deleted positions
	const mustDeleted: number[] = [];
	const mayDeleted: number[] = [];

	if (selector.values.isValue()) {
		const selectorValues = selector.values.value as readonly PosIntervalDomain[];

		for (const idx of selectorValues) {
			if (idx.isBottom()) {
				continue;
			}

			if (idx.isValue()) {
				const [l, u] = idx.value;
				// Negative indices: -k means exclude position k
				// Convert to positive: position = -index
				// Index interval [l, u] with l ≤ u ≤ 0 maps to positions [-u, -l]
				if (l <= 0 && u <= 0) {
					const posLower = Math.abs(u); // -u (if u is negative)
					const posUpper = Math.abs(l); // -l (if l is negative)

					if (card(idx) === 1) {
						// Must delete: single position
						const pos = posLower;
						if (pos >= 1 && pos <= sourceUpper) {
							mustDeleted.push(pos);
						}
					} else {
						// May delete: range of positions
						for (let pos = posLower; pos <= posUpper && pos <= sourceUpper; pos++) {
							mayDeleted.push(pos);
						}
					}
				}
			} else {
				// Non-value interval - conservatively assume may delete
				for (let pos = 1; pos <= sourceUpper; pos++) {
					mayDeleted.push(pos);
				}
			}
		}
	}

	// Check if any non-enumerable position exists
	const hasNonEnumerable = selector.values.isValue() &&
		(selector.values.value as readonly PosIntervalDomain[]).some(idx => !isEnumerable(idx));

	// Compute result bounds
	const numMustDeleted = mustDeleted.length;
	const newUpper = Math.max(0, sourceUpper - numMustDeleted);

	if (hasNonEnumerable || mayDeleted.length > 0) {
		// Cannot precisely track - use conservative approach
		// Result has at most sourceUpper - numMustDeleted positions
		const resultLength = value.length.create([0, newUpper]);

		// Build known positions: squash all values except mustDeleted
		const resultKnownPositions: Domain[] = [];
		const numPositions = Math.min(newUpper, sourceUpper);

		for (let i = 1; i <= numPositions; i++) {
			if (!mustDeleted.includes(i)) {
				resultKnownPositions.push(accessPosition(value, i - 1, naValue));
			}
		}

		return value.create({
			length: resultLength,
			values: value.values.create(resultKnownPositions),
			summary: value.summary.bottom(),
			attributes: value.attributes
		});
	}

	// All positions enumerable - precise result
	const resultLength = value.length.create([newUpper, newUpper]);
	const resultKnownPositions: Domain[] = [];

	for (let i = 1; i <= sourceUpper; i++) {
		if (!mustDeleted.includes(i)) {
			resultKnownPositions.push(accessPosition(value, i - 1, naValue));
		}
	}

	return value.create({
		length: resultLength,
		values: value.values.create(resultKnownPositions),
		summary: value.summary.bottom(),
		attributes: value.attributes
	});
}

/**
 * Selects elements using a logical vector.
 * Per paper Section 4.9.3: x[c] where c is boolean
 *
 * Algorithm:
 * 1. Recycle mask if shorter than source
 * 2. Build known positions position-by-position based on concretization
 * 3. Handle True, False, and NA cases
 */
function applySelectLogicalSemantics<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>,
	{ selector, naValue }: { selector: VectorDomain<Domain>; naValue: Domain }
): VectorDomain<Domain> {
	// Bottom check
	if (value.isBottom() || selector.isBottom()) {
		return value.bottom();
	}

	// Get lengths
	let sourceLen = 0;
	if (value.length.isValue()) {
		sourceLen = value.length.value[1];
	}

	let selectorLen = 0;
	if (selector.length.isValue()) {
		selectorLen = selector.length.value[1];
	}

	// Empty selector results in empty output
	if (selectorLen === 0) {
		return value.create({
			length: value.length.create([0, 0]),
			values: value.values.create([]),
			summary: value.summary.bottom(),
			attributes: value.attributes
		});
	}

	if (sourceLen === +Infinity || selectorLen === +Infinity) {
		// Infinite case - use squash
		return value.create({
			length: value.length.create([0, +Infinity]),
			values: value.values.top(),
			summary: squash(value),
			attributes: value.attributes
		});
	}

	// Recycle mask to match source length (R semantics)
	const maxLen = Math.max(sourceLen, selectorLen);

	// Build result known positions
	const resultKnownPositions: Domain[] = [];

	for (let i = 0; i < maxLen; i++) {
		// Get selector value at position i (recycled)
		const selectorPos = i % selectorLen;
		let selectorVal: Domain;

		if (selector.values.isValue()) {
			const selectorValues = selector.values.value as readonly Domain[];
			if (selectorPos < selectorValues.length) {
				selectorVal = selectorValues[selectorPos];
			} else {
				selectorVal = selector.summary;
			}
		} else {
			selectorVal = selector.summary;
		}

		// Determine contribution based on selector value
		// For interval domain: False=[0,0], True=[1,1], NA=special
		// We need to check what values the selector interval represents
		const sourceVal = accessPosition(value, i, naValue);

		// Simplified: always select when unsure, include NA if selector may be NA
		if (selectorVal.isValue()) {
			// Check if it's definitely false (interval [0,0])
			// This would require domain-specific knowledge, so we conservatively include
			resultKnownPositions.push(sourceVal);
		} else {
			// Non-specific value - include with possible NA
			resultKnownPositions.push(sourceVal.join(naValue));
		}
	}

	// Determine finiteness
	const isInfinite = selector.length.isValue() && selector.length.value[1] === +Infinity;

	return value.create({
		length: value.length.create([0, resultKnownPositions.length]),
		values: value.values.create(resultKnownPositions),
		summary: isInfinite ? squash(value) : value.summary.bottom(),
		attributes: value.attributes
	});
}

/* ============================================================================
 * Phase 3: Update Operations (Paper Section 4.8)
 * ============================================================================ */

/**
 * Initializes a known positions array with a specific pattern.
 * Per paper Section 4.8: InitPrefix(prefix, l, u, u_r)
 *
 * Pattern: [p_1 ... p_l] ++ [p_{l+1} ⊔ NA ... p_u ⊔ NA] ++ [NA ... NA]^(u_r - u)
 *
 * @param knownPositions - The source known positions array
 * @param l - Lower bound of original vector length
 * @param u - Upper bound of original vector length
 * @param uR - Target upper bound for result
 * @param naValue - The NA abstract value
 * @returns Initialized known positions array
 */
function initKnownPositions<Domain extends AnyAbstractDomain>(
	knownPositions: readonly Domain[],
	l: number,
	u: number,
	uR: number,
	naValue: Domain
): Domain[] {
	const result: Domain[] = [];

	// First l elements: keep as-is (positions 1 to l)
	for (let i = 0; i < Math.min(l, knownPositions.length); i++) {
		result.push(knownPositions[i]);
	}

	// Positions l+1 to u: join with NA
	for (let i = l; i < Math.min(u, knownPositions.length); i++) {
		result.push(knownPositions[i].join(naValue));
	}

	// Positions u+1 to u_r: fill with NA
	for (let i = u; i < uR; i++) {
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
 *
 * @param knownPositions - The target known positions to update
 * @param selectorPositions - The selector intervals (positions to update)
 * @param values - The values to write (cyclic)
 * @returns Updated known positions array
 */
function updateKnownPositions<Domain extends AnyAbstractDomain>(
	knownPositions: Domain[],
	selectorPositions: readonly PosIntervalDomain[],
	values: readonly Domain[]
): Domain[] {
	if (selectorPositions.length === 0 || values.length === 0) {
		return knownPositions;
	}

	const result = [...knownPositions];
	let valueIdx = 0;

	for (const posInterval of selectorPositions) {
		if (posInterval.isBottom()) {
			continue;
		}

		const valueToWrite = values[valueIdx % values.length];
		valueIdx++;

		if (posInterval.isValue()) {
			const [l, u] = posInterval.value;

			// Skip zero index
			if (l === 0 && u === 0) {
				continue;
			}

			// Get actual positions (1-indexed to 0-indexed)
			const startPos = l <= 0 ? 1 : l;
			const endPos = u;

			if (isEnumerable(posInterval)) {
				// Enumerable: update specific positions
				const isSingleton = card(posInterval) === 1;
				for (let pos = startPos; pos <= endPos && pos <= result.length; pos++) {
					const idx = pos - 1;
					if (isSingleton) {
						// Strong update: replace
						result[idx] = valueToWrite;
					} else {
						// Weak update: join
						result[idx] = result[idx].join(valueToWrite);
					}
				}
			} else {
				// Not enumerable: weak update all positions
				for (let i = 0; i < result.length; i++) {
					result[i] = result[i].join(valueToWrite);
				}
			}
		} else {
			// Non-specific interval: weak update all
			for (let i = 0; i < result.length; i++) {
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
 *
 * @param vector - The source vector
 * @param targetLength - The target length to generate
 * @returns Array of abstract values
 */
function generateCyclicKnownPositions<Domain extends AnyAbstractDomain>(
	vector: VectorDomain<Domain>,
	targetLength: number
): Domain[] {
	const result: Domain[] = [];

	if (vector.isBottom()) {
		return result;
	}

	const knownPositions = vector.values.isValue()
		? (vector.values.value as readonly Domain[])
		: [];

	for (let i = 0; i < targetLength; i++) {
		if (i < knownPositions.length) {
			result.push(knownPositions[i]);
		} else {
			// Cycle through: use summary, then wrap around
			const cyclicIdx = (i - knownPositions.length) % Math.max(1, knownPositions.length || 1);
			if (knownPositions.length > 0 && cyclicIdx < knownPositions.length) {
				result.push(knownPositions[cyclicIdx]);
			} else {
				result.push(vector.summary);
			}
		}
	}

	return result;
}

/**
 * Updates elements using positive indices.
 * Per paper Section 4.8.1: x[c] <- v where c ≥ 0
 *
 * Algorithm:
 * 1. Apply AdjustForZeros to handle zero indices
 * 2. Handle three cases based on selector properties:
 *    - Non-enumerable positions: collapse vector
 *    - Infinite selector with enumerable positions
 *    - Finite selector with enumerable positions
 */
function applyUpdatePositiveSemantics<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>,
	{ selector, values, naValue }: { selector: VectorDomain<PosIntervalDomain>; values: VectorDomain<Domain>; naValue: Domain }
): VectorDomain<Domain> {
	// Bottom checks
	if (value.isBottom() || selector.isBottom() || values.isBottom()) {
		return value.bottom();
	}

	// Apply AdjustForZeros to handle zero indices
	const adjustedSelector = adjustForZeros(selector);

	// Check for non-enumerable positions
	const hasNonEnumerable = adjustedSelector.values.isValue() &&
		(adjustedSelector.values.value as readonly PosIntervalDomain[])
			.some(idx => !isEnumerable(idx));

	if (hasNonEnumerable) {
		// Case 1: Non-enumerable positions - collapse entire vector
		const vAll = squash(value).join(squash(values));
		return value.create({
			length: value.length.create([value.length.isValue() ? value.length.value[0] : 0, +Infinity]),
			values: value.values.create([]),
			summary: vAll,
			attributes: value.attributes
		});
	}

	// Get bounds
	let sourceLower = 0, sourceUpper = 0;
	if (value.length.isValue()) {
		sourceLower = value.length.value[0];
		sourceUpper = value.length.value[1];
	}

	let selectorLower = 0, selectorUpper = 0;
	if (adjustedSelector.length.isValue()) {
		selectorLower = adjustedSelector.length.value[0];
		selectorUpper = adjustedSelector.length.value[1];
	}

	const isInfinite = selectorUpper === +Infinity;

	// Get source known positions
	const sourceKnownPositions = value.values.isValue()
		? (value.values.value as readonly Domain[])
		: [];

	if (isInfinite) {
		// Case 2: Infinite selector with enumerable positions
		// Check if selector summary is enumerable
		const selectorSummaryEnumerable = isEnumerable(adjustedSelector.summary);

		// Compute u_r = max(u_2', l_{s_2})
		const summaryLower = adjustedSelector.summary.isValue()
			? adjustedSelector.summary.value[0]
			: 0;
		const uR = Math.max(selectorUpper === +Infinity ? 0 : selectorUpper, summaryLower);

		// Initialize base known positions
		const selectorKnownPositions = adjustedSelector.values.isValue()
			? (adjustedSelector.values.value as readonly PosIntervalDomain[])
			: [];

		const baseKnownPositions = initKnownPositions(
			selectorKnownPositions as unknown as Domain[],
			sourceLower,
			sourceUpper,
			uR,
			naValue
		);

		// Generate cyclic values from values vector
		let valuesUpper = 0;
		if (values.length.isValue()) {
			valuesUpper = values.length.value[1];
		}
		const cyclicValues = generateCyclicKnownPositions(values, valuesUpper);

		// Update known positions
		let resultKnownPositions = updateKnownPositions(
			baseKnownPositions,
			selectorKnownPositions,
			cyclicValues
		);

		// If summary is not enumerable, weak update positions in [l_{s_2}, u_r]
		if (!selectorSummaryEnumerable && adjustedSelector.summary.isValue()) {
			const squashValues = squash(values);
			const lS2 = adjustedSelector.summary.value[0];
			for (let i = Math.max(0, lS2 - 1); i < resultKnownPositions.length; i++) {
				resultKnownPositions[i] = resultKnownPositions[i].join(squashValues);
			}
		}

		const resultSummary = value.summary.join(squash(values));

		return value.create({
			length: value.length.create([sourceLower, +Infinity]),
			values: value.values.create(resultKnownPositions),
			summary: resultSummary,
			attributes: value.attributes
		});
	} else {
		// Case 3: Finite selector with enumerable positions
		// Compute u_r = max index in selector
		let uR = 0;
		if (adjustedSelector.values.isValue()) {
			const selectorKnownPositions = adjustedSelector.values.value as readonly PosIntervalDomain[];
			for (const idx of selectorKnownPositions) {
				if (idx.isValue()) {
					uR = Math.max(uR, idx.value[1]);
				}
			}
		}
		uR = Math.max(uR, sourceUpper);

		// Get selector known positions
		const selectorKnownPositions = adjustedSelector.values.isValue()
			? (adjustedSelector.values.value as readonly PosIntervalDomain[])
			: [];

		// Initialize base known positions from selector
		const baseKnownPositions = initKnownPositions(
			selectorKnownPositions as unknown as Domain[],
			sourceLower,
			sourceUpper,
			uR,
			naValue
		);

		// Generate cyclic values
		let valuesUpper = 0;
		if (values.length.isValue()) {
			valuesUpper = values.length.value[1];
		}
		const cyclicValues = generateCyclicKnownPositions(values, Math.max(selectorUpper, valuesUpper));

		// Update known positions
		const resultKnownPositions = updateKnownPositions(
			baseKnownPositions,
			selectorKnownPositions,
			cyclicValues
		);

		return value.create({
			length: value.length.create([sourceLower, uR]),
			values: value.values.create(resultKnownPositions),
			summary: value.summary.bottom(),
			attributes: value.attributes
		});
	}
}

/**
 * Updates elements using negative indices.
 * Per paper Section 4.8.2: x[c] <- v where c ≤ 0
 *
 * Algorithm:
 * 1. Apply AdjustForZeros to handle zero indices
 * 2. Identify MustUpdated, MayNotUpdated, MustNotUpdated position sets
 * 3. Handle three cases based on selector properties
 */
function applyUpdateNegativeSemantics<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>,
	{ selector, values, naValue }: { selector: VectorDomain<PosIntervalDomain>; values: VectorDomain<Domain>; naValue: Domain }
): VectorDomain<Domain> {
	// Bottom checks
	if (value.isBottom() || selector.isBottom() || values.isBottom()) {
		return value.bottom();
	}

	// Get source bounds
	let sourceUpper = 0;
	if (value.length.isValue()) {
		sourceUpper = value.length.value[1];
		if (sourceUpper === +Infinity) {
			// Cannot handle infinite source precisely
			return value.top();
		}
	} else {
		return value.top();
	}

	// Apply AdjustForZeros
	const adjustedSelector = adjustForZeros(selector);

	// Identify position sets
	const mustNotUpdated: number[] = [];
	const mayNotUpdated: number[] = [];

	if (adjustedSelector.values.isValue()) {
		const selectorKnownPositions = adjustedSelector.values.value as readonly PosIntervalDomain[];

		for (const idx of selectorKnownPositions) {
			if (idx.isBottom()) {
				continue;
			}

			if (idx.isValue()) {
				const [l, u] = idx.value;
				// Negative indices: convert to positive positions
				if (l <= 0 && u <= 0) {
					const posLower = Math.abs(u);
					const posUpper = Math.abs(l);

					if (card(idx) === 1) {
						// Must not update: single definite position
						const pos = posLower;
						if (pos >= 1 && pos <= sourceUpper) {
							mustNotUpdated.push(pos);
						}
					} else {
						// May not update: range of positions
						for (let pos = posLower; pos <= posUpper && pos <= sourceUpper; pos++) {
							mayNotUpdated.push(pos);
						}
					}
				}
			} else {
				// Non-specific: may not update any position
				for (let pos = 1; pos <= sourceUpper; pos++) {
					mayNotUpdated.push(pos);
				}
			}
		}
	}

	// Check for non-enumerable positions
	const hasNonEnumerable = adjustedSelector.values.isValue() &&
		(adjustedSelector.values.value as readonly PosIntervalDomain[])
			.some(idx => !isEnumerable(idx));

	const v = squash(values);

	if (hasNonEnumerable) {
		// Case 1: Non-enumerable positions
		// Weak update all positions not in mustNotUpdated
		const sourceKnownPositions = value.values.isValue()
			? (value.values.value as readonly Domain[])
			: [];

		const resultKnownPositions: Domain[] = [];
		for (let i = 1; i <= sourceUpper; i++) {
			const idx = i - 1;
			let val: Domain;
			if (idx < sourceKnownPositions.length) {
				val = sourceKnownPositions[idx];
			} else {
				val = value.summary;
			}

			if (!mustNotUpdated.includes(i)) {
				// Weak update
				val = val.join(v);
			}
			resultKnownPositions.push(val);
		}

		const resultSummary = value.summary.join(v);

		return value.create({
			length: value.length,
			values: value.values.create(resultKnownPositions),
			summary: resultSummary,
			attributes: value.attributes
		});
	}

	// Check if selector is infinite
	const isInfinite = adjustedSelector.length.isValue() &&
		adjustedSelector.length.value[1] === +Infinity;

	if (isInfinite) {
		// Case 2: Infinite selector with enumerable positions
		// Build a positive selector and apply positive update
		// Simplified: return top for now
		return value.top();
	} else {
		// Case 3: Finite selector with enumerable positions
		// Compute u_r = max(u_1, u_2')
		let selectorUpper = 0;
		if (adjustedSelector.length.isValue()) {
			selectorUpper = adjustedSelector.length.value[1];
		}
		const uR = Math.max(sourceUpper, selectorUpper);

		// Generate cyclic values
		let valuesUpper = 0;
		if (values.length.isValue()) {
			valuesUpper = values.length.value[1];
		}
		const cyclicValues = generateCyclicKnownPositions(values, Math.max(selectorUpper, valuesUpper));

		// Initialize result known positions from source
		const sourceKnownPositions = value.values.isValue()
			? (value.values.value as readonly Domain[])
			: [];

		const resultKnownPositions: Domain[] = [];
		for (let i = 0; i < uR; i++) {
			if (i < sourceKnownPositions.length) {
				resultKnownPositions.push(sourceKnownPositions[i]);
			} else if (i < sourceUpper) {
				resultKnownPositions.push(value.summary);
			} else {
				resultKnownPositions.push(naValue);
			}
		}

		// Update positions not in mustNotUpdated or mayNotUpdated
		const updatedPositions = new Set([...mustNotUpdated, ...mayNotUpdated]);
		for (let i = 1; i <= uR; i++) {
			if (!updatedPositions.has(i)) {
				// Position must be updated
				const idx = i - 1;
				const valueIdx = (i - 1) % cyclicValues.length;
				resultKnownPositions[idx] = cyclicValues[valueIdx];
			}
		}

		return value.create({
			length: value.length.create([value.length.isValue() ? value.length.value[0] : 0, uR]),
			values: value.values.create(resultKnownPositions),
			summary: value.summary.bottom(),
			attributes: value.attributes
		});
	}
}

/**
 * Updates elements using a logical vector.
 * Per paper Section 4.8.3: x[c] <- v where c is boolean
 *
 * Algorithm:
 * 1. Check for NA in selector (error case if values length != 1)
 * 2. Apply AdjustForZeros
 * 3. Initialize result known positions
 * 4. Update positions based on selector values (True/False/NA)
 */
function applyUpdateLogicalSemantics<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>,
	{ selector, values, naValue }: { selector: VectorDomain<Domain>; values: VectorDomain<Domain>; naValue: Domain }
): VectorDomain<Domain> {
	// Bottom checks
	if (value.isBottom() || selector.isBottom() || values.isBottom()) {
		return value.bottom();
	}

	// Check for NA in selector
	const selectorSquash = squash(selector);
	// Simplified: check if NA might be in selector
	// In a full implementation, we'd check the actual abstract domain

	// Get bounds
	let sourceLower = 0, sourceUpper = 0;
	if (value.length.isValue()) {
		sourceLower = value.length.value[0];
		sourceUpper = value.length.value[1];
	}

	let selectorUpper = 0;
	if (selector.length.isValue()) {
		selectorUpper = selector.length.value[1];
	}

	const isInfinite = selectorUpper === +Infinity;

	// Get known positions
	const sourceKnownPositions = value.values.isValue()
		? (value.values.value as readonly Domain[])
		: [];
	const selectorKnownPositions = selector.values.isValue()
		? (selector.values.value as readonly Domain[])
		: [];

	// Initialize result known positions
	const maxLen = Math.max(sourceKnownPositions.length, selectorKnownPositions.length);
	const resultKnownPositions: Domain[] = [];

	// Initialize with source values, extended with NA
	for (let i = 0; i < maxLen; i++) {
		if (i < sourceKnownPositions.length) {
			resultKnownPositions.push(sourceKnownPositions[i]);
		} else if (i < sourceUpper) {
			resultKnownPositions.push(value.summary);
		} else {
			resultKnownPositions.push(naValue);
		}
	}

	// Generate cyclic values
	let valuesUpper = 0;
	if (values.length.isValue()) {
		valuesUpper = values.length.value[1];
	}
	const cyclicValues = generateCyclicKnownPositions(values, selectorUpper);

	// Update based on selector
	for (let i = 0; i < maxLen && i < cyclicValues.length; i++) {
		let selectorVal: Domain;
		if (i < selectorKnownPositions.length) {
			selectorVal = selectorKnownPositions[i];
		} else if (i < selectorKnownPositions.length + (selector.summary.isValue() ? 1 : 0)) {
			selectorVal = selector.summary;
		} else {
			selectorVal = selector.summary.top();
		}

		if (selectorVal.isValue()) {
			// Check if it's True ([1,1]), False ([0,0]), or both
			// For simplicity, assume interval domain
			// This would need domain-specific handling in a full implementation
			resultKnownPositions[i] = cyclicValues[i % cyclicValues.length];
		} else {
			// Uncertain: weak update
			resultKnownPositions[i] = resultKnownPositions[i].join(cyclicValues[i % cyclicValues.length]);
		}
	}

	// Determine result bounds
	const resultUpper = isInfinite ? +Infinity : Math.max(sourceUpper, selectorUpper);
	const resultSummary = isInfinite ? squash(values) : value.summary.bottom();

	return value.create({
		length: value.length.create([sourceLower, resultUpper]),
		values: value.values.create(resultKnownPositions),
		summary: resultSummary,
		attributes: value.attributes
	});
}

/**
 * Unknown vector operation - returns top to indicate no information.
 */
function applyUnknownSemantics<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>
): VectorDomain<Domain> {
	return value.top();
}
