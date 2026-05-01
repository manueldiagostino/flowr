/* eslint-disable tsdoc/syntax */
import type { AnyAbstractDomain } from '../../domains/abstract-domain';
import type { ArithmeticDomain } from '../../domains/arithmetic-domain';
import { VectorDomain } from '../vector-domain';
import { NAAwareDomain } from '../na-aware-domain';
import type { IntervalDomain } from '../../domains/interval-domain';
import { PosIntervalDomain } from '../../domains/positive-interval-domain';
import { vectorLogger } from '../logger';
import { guard } from '../../../util/assert';
import {
	squash,
	squashedExcept,
	isEnumerable,
	adjustForZeros,
	accessPosition,
	rhoF,
	card
} from '../vector-semantics';
import { buildPosIntervalSelector, buildPosIntervalSelectorFromSource } from '../helpers/selector-builders';

/**
 * Applies the select operation to choose elements from a vector based on a selector.
 * Uses abstract filtering (paper Section 4.7) for numeric selectors and AST-based
 * detection for logical selectors.
 *
 * For numeric selectors, applies `abstractFilter` to classify positions into
 * positive (≥ 0 or NA) and negative (≤ 0), then computes:
 * `select(ν₁, ν₂) = select_pos(ν₁, ν₂⁺) ⊔ select_neg(ν₁, ν₂⁻)`
 * @param value - The source VectorDomain to select from
 * @param selector - The selector VectorDomain (interval or value domain)
 * @param naValue - The NA value for out-of-bounds access
 * @returns The resulting VectorDomain after selection
 */
export function applySelect<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	selector: VectorDomain<IntervalDomain>,
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	// Derive selector kind from the selector's type (logical vs numeric)
	const selectorKind = selector.type.getType() === 'logical' ? 'logical' : 'numeric';
	vectorLogger.debug(`Operation: select [selectorKind=${selectorKind}]`);
	vectorLogger.debug(`Operation: select input [value.length=${value.length.toString()}, value.known=${value.known.toString()}, selector.length=${selector.length.toString()}]`);

	// INVARIANT 1: Bottom Propagation
	// If either source vector or selector is Bottom, return Bottom
	if(value.isBottom() || selector.isBottom()) {
		vectorLogger.debug('Operation: select returning bottom (input is bottom)');
		return value.bottom();
	}

	// Paper Section 4.7 (L498-503): Empty selector is a special case
	// rSelectSharp(ν1, genvecalpha(rEmpty)) = ν1
	// The empty vector has length [0,0]
	const isEmptySelector = selector.length.isValue() &&
		selector.length.value[0] === 0 &&
		selector.length.value[1] === 0;
	if(isEmptySelector) {
		vectorLogger.debug('Operation: select with empty selector, returning source vector');
		return value;
	}

	// INVARIANT 3: Selector Kind Detection
	// Determine selector kind (logical or numeric) based on selector's type
	if(selectorKind === 'logical') {
		const result = applySelectLogical(value, selector as VectorDomain<PosIntervalDomain>, naValue);
		vectorLogger.debug(`Operation: select logical result [length=${result.length.toString()}, values=${result.known.toString()}]`);
		return result;
	}

	// INVARIANT 4: No Early Return on Top
	// Do NOT handle Top selector with immediate return. Top selector means indices could be anything.
	// Logical vs numeric selection have completely different behaviors.
	// Top selector must be filtered by abstractFilter into positive/negative/logical components.

	// Numeric Selector: Use abstract filtering to classify positions
	const numericSelector = selector;

	// If selector values cannot be enumerated, use conservative positive selector
	if(!numericSelector.known.isValue() || !Array.isArray(numericSelector.known.value)) {
		vectorLogger.debug('Operation: select cannot enumerate selector values, using conservative positive');
		const conservativeSelector = buildPosIntervalSelectorFromSource(numericSelector);
		const result = applySelectPositive(value, conservativeSelector, naValue);
		vectorLogger.debug(`Operation: select conservative result [length=${result.length.toString()}]`);
		return result;
	}

	// Check if selector is all zeros (will become empty after adjustForZeros)
	// In this case, return empty vector
	const selectorValues = numericSelector.known.value as readonly NAAwareDomain<IntervalDomain>[];
	const allZeros = selectorValues.every(pos => {
		if(!pos.isValue() || !pos.inner.isValue()) {
			return false;
		}
		const [l, u] = pos.inner.value;
		return l === 0 && u === 0;
	});
	if(allZeros && selector.summary.isBottom()) {
		vectorLogger.debug('Operation: select with all-zero selector, returning empty vector');
		return value.create({
			length:     value.length.create([0, 0]),
			known:      value.known.create([]),
			summary:    value.summary.bottom(),
			attributes: value.attributes,
			type:       value.type
		});
	}

	// Paper Section 4.7: abstract filter classifies selector positions
	const filterResult = VectorDomain.abstractFilter(selectorValues, numericSelector.plainFactory);
	vectorLogger.debug(`Operation: select filter [positive=${filterResult.positive.length}, negative=${filterResult.negative.length}, posBottom=${filterResult.positiveHasBottom}, negBottom=${filterResult.negativeHasBottom}]`);

	// Handle bottom propagation: if both groups have bottom elements, result is bottom
	if(filterResult.positiveHasBottom && filterResult.negativeHasBottom) {
		vectorLogger.debug('Operation: select returning bottom (both groups have bottom)');
		return value.bottom();
	}

	let result = value.bottom();

	// Check if any selector positions are non-enumerable (paper Section 4.7, L655)
	// When at least one position is not enumerable, we use conservative handling
	const hasNonEnumerablePositive = filterResult.positive.length > 0 && filterResult.positive.some(
		pos => pos.isValue() && pos.inner.isValue() && !isEnumerable(new PosIntervalDomain(pos.inner.value))
	);
	const hasNonEnumerableNegative = filterResult.negative.length > 0 && filterResult.negative.some(
		pos => pos.isValue() && pos.inner.isValue() && !isEnumerable(new PosIntervalDomain(pos.inner.value))
	);

	// INVARIANT 5: Positive Selector Filtering
	// Ensure selector contains only non-negative positions or NA before calling applySelectPositive
	if(filterResult.positive.length > 0 && !filterResult.positiveHasBottom && !hasNonEnumerablePositive) {
		const positiveSelector = buildPosIntervalSelector(numericSelector, filterResult.positive);
		const resultPos = applySelectPositive(value, positiveSelector, naValue);
		vectorLogger.debug(`Operation: select positive result [length=${resultPos.length.toString()}]`);
		result = result.join(resultPos);
	}

	// INVARIANT 6: Negative Selector Filtering
	// Ensure selector contains only non-positive positions (no NA) before calling applySelectNegative
	if(filterResult.negative.length > 0 && !filterResult.negativeHasBottom && !hasNonEnumerableNegative) {
		const negativeSelector = buildPosIntervalSelector(numericSelector, filterResult.negative);
		const resultNeg = applySelectNegative(value, negativeSelector, naValue);
		vectorLogger.debug(`Operation: select negative result [length=${resultNeg.length.toString()}]`);
		result = result.join(resultNeg);
	}

	// Paper Section 4.7, paragraph 1 (L655-676): When at least one position is not enumerable,
	// we cannot precisely track which positions are excluded. Use conservative fallback.
	// This also handles the case where no positions were classified but selector has summary.
	const noPreciseHandling = (filterResult.positive.length === 0 || filterResult.positiveHasBottom || hasNonEnumerablePositive) &&
		(filterResult.negative.length === 0 || filterResult.negativeHasBottom || hasNonEnumerableNegative);
	if(noPreciseHandling && !numericSelector.summary.isBottom()) {
		vectorLogger.debug('Operation: select using conservative fallback for non-enumerable positions');
		const conservativeSelector = buildPosIntervalSelectorFromSource(numericSelector);

		// Try positive selection
		const resultPos = applySelectPositive(value, conservativeSelector, naValue);
		result = result.join(resultPos);

		// Also try negative selection for cases like s[-v] where v is top or non-enumerable
		// When selector has non-enumerable positions, MustDeleted only contains definitely excluded positions
		const resultNeg = applySelectNegative(value, conservativeSelector, naValue);
		result = result.join(resultNeg);
	}

	vectorLogger.debug(`Operation: select final result [length=${result.length.toString()}, values=${result.known.toString()}], summary=${result.summary.toString()}`);
	return result;
}

// ============================================================================
// Positive Selection Helpers (Paper Section 4.7, L659-L693)
// ============================================================================

/**
 * Constructs the result for positive selection with a finite selector.
 * Paper Section 4.7, L659-L677: Finite selector case.
 * Result length is determined by selector length, summary is ⊥ (unless may exceed bounds).
 * @param value - The source VectorDomain
 * @param adjustedSelector - The selector after adjustForZeros
 * @param resultKnownPositions - The computed known positions for the result
 * @param naValue - The NA value for out-of-bounds access
 * @returns The resulting VectorDomain
 */
export function selectPositiveFinite<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	adjustedSelector: VectorDomain<PosIntervalDomain>,
	resultKnownPositions: NAAwareDomain<Domain>[],
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	// Check if selection may exceed source bounds (paper L611-613)
	const squashedSelector = squash(adjustedSelector);
	const selectorUpper = squashedSelector.inner.isValue() ? squashedSelector.inner.value[1] : +Infinity;
	const sourceLower = value.length.isValue() ? value.length.value[0] : 0;
	const mayExceedBounds = selectorUpper > sourceLower;

	// Summary: ⊥ for finite selectors (paper L666)
	// If may exceed bounds: ⊥ ⊔ NA (paper L611-613)
	let resultSummary = value.summary.bottom();
	if(mayExceedBounds) {
		resultSummary = resultSummary.join(naValue);
		vectorLogger.trace('Subcase: selectPositive - selector may exceed bounds, adding NA to summary');
	}
	const resultValues = value.known.create(resultKnownPositions);
	return value.create({
		length:     adjustedSelector.length,
		known:      resultValues,
		summary:    resultSummary,
		attributes: value.attributes,
		type:       value.type
	});
}

/**
 * Constructs the result for positive selection with an infinite selector.
 * Paper Section 4.7, L680-L693: Infinite selector case.
 * Result length is [l₂', +∞], summary is Squash(value).
 * @param value - The source VectorDomain
 * @param adjustedSelector - The selector after adjustForZeros
 * @param resultKnownPositions - The computed known positions for the result
 * @param naValue - The NA value for out-of-bounds access
 * @returns The resulting VectorDomain
 */
export function selectPositiveInfinite<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	adjustedSelector: VectorDomain<PosIntervalDomain>,
	resultKnownPositions: NAAwareDomain<Domain>[],
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	// Check if selection may exceed source bounds (paper L611-613)
	const squashedSelector = squash(adjustedSelector);
	const selectorUpper = squashedSelector.inner.isValue() ? squashedSelector.inner.value[1] : +Infinity;
	const sourceLower = value.length.isValue() ? value.length.value[0] : 0;
	const mayExceedBounds = selectorUpper > sourceLower;

	// Summary: Squash(value) for infinite selectors (paper L687)
	// If may exceed bounds: Squash(value) ⊔ NA (paper L611-613)
	let resultSummary = squash(value);
	if(mayExceedBounds) {
		resultSummary = resultSummary.join(naValue);
		vectorLogger.trace('Subcase: selectPositive - selector may exceed bounds, adding NA to summary');
	}
	const resultValues = value.known.create(resultKnownPositions);
	return value.create({
		length:     adjustedSelector.length,
		known:      resultValues,
		summary:    resultSummary,
		attributes: value.attributes,
		type:       value.type
	});
}

/**
 * Applies positive indexing selection: x[c] where c >= 0.
 * Preconditions (guaranteed by dispatcher):
 * - value is not Bottom
 * - selector is not Bottom
 * - selector contains only non-negative positions or NA
 *
 * Postconditions:
 * - Result length is determined by selector length
 * - Result summary is ⊥ for finite selectors, Squash(value) for infinite
 * - Result attributes are preserved from source
 * @param value - The source VectorDomain to select from (not Bottom)
 * @param selector - The selector VectorDomain with positive intervals (not Bottom)
 * @param naValue - The NA value for out-of-bounds access
 * @returns The resulting VectorDomain after positive selection
 */
export function applySelectPositive<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	selector: VectorDomain<PosIntervalDomain>,
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	vectorLogger.debug('Operation: selectPositive');
	vectorLogger.debug(`  selector [length=${selector.length.toString()}, values=${selector.known.toString()}]`);

	// Adjust selector for zeros: removes zero indices and adjusts length bounds
	const adjustedSelector = adjustForZeros(selector);
	vectorLogger.debug(`  adjustedSelector [length=${adjustedSelector.length.toString()}, values=${adjustedSelector.known.toString()}]`);

	// Empty selector after adjusting for zeros - return empty vector
	// In positive selection, empty selector means no positions are selected
	if(adjustedSelector.length.isValue()) {
		const [newL, newU] = adjustedSelector.length.value;
		if(newL === 0 && newU === 0) {
			vectorLogger.debug('Operation: selectPositive - empty selector, returning empty vector');
			// Return vector with empty length and no known positions
			return value.create({
				length:     adjustedSelector.length,
				known:      value.known.create([]),
				summary:    value.summary.bottom(),
				attributes: value.attributes,
				type:       value.type
			});
		}
	}

	//
	// === Position enumeration (Paper L659-L693) ===
	// Both the Finite selector (L659) and Infinite selector (L680) cases
	// enumerate each position in the adjusted selector. The cases differ
	// only in the result's length and summary (see below).
	//
	const resultKnownPositions: NAAwareDomain<Domain>[] = [];

	// Check if source has enumerable known positions (paper: can we enumerate positions in ν₁?)
	const sourceKnownEnumerable = value.known.isValue() && Array.isArray(value.known.value);
	// Get source length upper bound for out-of-bounds checking
	const sourceLenUpper = value.length.isValue() ? value.length.value[1] : +Infinity;

	if(adjustedSelector.known.isValue() && Array.isArray(adjustedSelector.known.value)) {
		const selectorValues = adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[];

		let idxNumber = 0;
		for(const idx of selectorValues) {
			// Precondition: dispatcher guarantees selector positions are not bottom
			// No redundant check needed here

			const innerInterval = idx.inner;
			if(isEnumerable(innerInterval)) {
				if(innerInterval.isValue()) {
					const [l, u] = innerInterval.value;
					vectorLogger.trace(`Subcase: selectPositive - enumerable interval [${l}, ${u}]`);
					let joinedAccessed: NAAwareDomain<Domain> | undefined;

					if(sourceKnownEnumerable) {
						// Source has enumerable positions - access each position
						// After adjustForZeros, all positions are guaranteed to be > 0
						// No zero-to-one conversion needed
						for(let pos = l; pos <= u; pos++) {
							if(pos > 0) {
								const accessed = accessPosition(value, pos - 1, naValue);
								joinedAccessed = joinedAccessed === undefined ? accessed : joinedAccessed.join(accessed);
							}
						}
					} else {
						// Source known not enumerable (e.g., Top vector with empty content but valorized summary)
						// Use squash(value) per paper Section 4.3.1
						joinedAccessed = squash(value);
					}

					// Check if selector position may exceed source bounds - join with NA if so
					if(sourceLenUpper !== +Infinity && u > sourceLenUpper) {
						joinedAccessed = (joinedAccessed ?? squash(value)).join(naValue);
					}

					guard(joinedAccessed !== undefined, `applySelectPositive: joinedAccessed undefined for position ${idxNumber}`);
					resultKnownPositions.push(joinedAccessed);
				} else {
					vectorLogger.trace('Subcase: selectPositive - enumerable selector with non-value interval, using squash');
					resultKnownPositions.push(squash(value));
				}
			} else {
				vectorLogger.trace('Subcase: selectPositive - non-enumerable selector, using squash');
				resultKnownPositions.push(squash(value));
			}

			idxNumber += 1;
		}
	}

	// Determine if selector is infinite
	const selectorLen = adjustedSelector.length;
	const isInfinite = !selectorLen.isValue() || selectorLen.value[1] === +Infinity;
	if(isInfinite) {
		vectorLogger.trace('Subcase: selectPositive - infinite selector, valorizing summary');
		return selectPositiveInfinite(value, adjustedSelector, resultKnownPositions, naValue);
	} else {
		return selectPositiveFinite(value, adjustedSelector, resultKnownPositions, naValue);
	}
}

// ============================================================================
// Negative Selection Helpers (Paper Section 4.7, L704-L827)
// ============================================================================

/**
 * Builds the must-deleted and may-deleted sets for negative selection.
 * @param sourceUpper - The upper bound of the source vector length
 * @param selectorValues - The selector's known positions (as PosIntervalDomain)
 * @returns A tuple of [mustDeleted, mayDeleted] sets
 */
export function buildNegativeSets(
	sourceUpper: number,
	selectorValues: readonly NAAwareDomain<PosIntervalDomain>[],
): [mustDeleted: Set<number>, mayDeleted: Set<number>] {
	const mustDeleted = new Set<number>();
	const mayDeleted = new Set<number>();

	let idxPos = 0;
	for(const idx of selectorValues) {
		guard(!idx.isBottom(), `Selector index ${idxPos} is bottom`);

		const innerInterval = idx.inner;
		guard(innerInterval.isValue(), `Selector index ${idxPos} has bottom inner value`);

		const [l, u] = innerInterval.value;
		// After buildPosIntervalSelector conversion, intervals are positive
		// representing the positions to delete (negated from original negative intervals)
		guard(l >= 0 && u >= 0, `Selector index ${idxPos} has invalid positive interval [${l}, ${u}]`);

		const posLower = l;
		const posUpper = u;
		if(card(innerInterval) === 1) {
			const pos = posLower;
			if(pos >= 1 && pos <= sourceUpper) {
				mustDeleted.add(pos);
				mayDeleted.add(pos); // Must ⊆ May invariant
			}
		} else {
			for(let pos = posLower; pos <= posUpper && pos <= sourceUpper; pos++) {
				mayDeleted.add(pos);
			}
		}

		idxPos += 1;
	}

	return [mustDeleted, mayDeleted];
}

/**
 * Handles negative selection when source known positions are not enumerable.
 * Paper Section 4.7, L734-L745: Special case for non-enumerable source.
 * Uses Squash(value) for all positions instead of accessing individual positions.
 * @param value - The source VectorDomain
 * @param mustDeleted - Set of positions definitely deleted
 * @param mayDeleted - Set of positions possibly deleted
 * @param sourceLower - Lower bound of source length
 * @param sourceUpper - Upper bound of source length
 * @returns The resulting VectorDomain
 */
export function selectNegativeSourceNotEnumerable<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	mustDeleted: Set<number>,
	mayDeleted: Set<number>,
	sourceLower: number,
	sourceUpper: number
): VectorDomain<Domain> {
	vectorLogger.debug('Operation: selectNegative - source not enumerable, using squash');
	const mayDeletedU1 = [...mayDeleted].filter(d => d <= sourceUpper).length;
	const mustDeletedU1 = [...mustDeleted].filter(d => d <= sourceUpper).length;
	const newLower = Math.max(0, sourceLower - mayDeletedU1);
	const newUpper = Math.max(0, sourceUpper - mustDeletedU1);

	const resultKnownPositions: NAAwareDomain<Domain>[] = [];
	const squashedValue = squash(value);
	const prefixBound = newUpper === +Infinity ? 0 : Math.min(newUpper, 0);
	for(let i = 0; i < prefixBound; i++) {
		resultKnownPositions.push(squashedValue);
	}

	const resultSummary = newUpper === +Infinity ? value.summary : value.summary.bottom();
	const result = value.create({
		length:     value.length.create([newLower, newUpper]),
		known:      value.known.create(resultKnownPositions),
		summary:    resultSummary,
		attributes: value.attributes,
		type:       value.type
	});
	vectorLogger.trace(`Result [length=${result.length.toString()}, values=${result.known.toString()}]`);
	return result;
}

/**
 * Handles negative selection when selector has non-enumerable positions.
 * Paper Section 4.7, L734-L754 (Paragraph 1): Non-enumerable selector case.
 * Uses SquashExcept with MustDeleted set.
 * @param value - The source VectorDomain
 * @param mustDeleted - Set of positions definitely deleted
 * @param sourceUpper - Upper bound of source length
 * @returns The resulting VectorDomain
 */
export function selectNegativeNonEnumerable<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	mustDeleted: Set<number>,
	sourceUpper: number
): VectorDomain<Domain> {
	vectorLogger.debug('Paragraph 1: Non-enumerable position in selector, using SquashExcept');
	const newUpper = sourceUpper === +Infinity ? +Infinity : Math.max(0, sourceUpper - mustDeleted.size);
	const resultLength = value.length.create([0, newUpper]);
	const resultKnownPositions: NAAwareDomain<Domain>[] = [];

	// prefix_r = [SquashExcept(ν₁, MustDeleted)]_1^(min(k₁, u_r))
	// When u₁ = +∞, u_r = +∞, so min(k₁, u_r) = k₁ (source's known prefix length)
	const squashResult = squashedExcept(value, mustDeleted);
	const sourceKnownCount = value.known.isValue() && Array.isArray(value.known.value)
		? value.known.value.length
		: 0;
	const prefixBound = newUpper === +Infinity ? sourceKnownCount : newUpper;
	for(let i = 0; i < prefixBound; i++) {
		resultKnownPositions.push(squashResult);
	}

	const result = value.create({
		length:     resultLength,
		known:      value.known.create(resultKnownPositions),
		summary:    sourceUpper === +Infinity ? value.summary : value.summary.bottom(),
		attributes: value.attributes,
		type:       value.type
	});
	vectorLogger.trace(`Result [length=${result.length.toString()}, values=${result.known.toString()}]`);
	return result;
}

/**
 * Handles negative selection when all selector positions are enumerable.
 * Paper Section 4.7, L756-L827 (Paragraphs 2 & 3): Enumerable selector case.
 * Uses CountMustDeleted to map positions from source to result.
 * @param value - The source VectorDomain
 * @param mustDeleted - Set of positions definitely deleted
 * @param mayDeleted - Set of positions possibly deleted
 * @param mustNotDeleted - Set of positions definitely kept
 * @param sourceLower - Lower bound of source length
 * @param sourceUpper - Upper bound of source length
 * @param naValue - The NA value for out-of-bounds access
 * @returns The resulting VectorDomain
 */
export function selectNegativeAllEnumerable<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	mustDeleted: Set<number>,
	mayDeleted: Set<number>,
	mustNotDeleted: Set<number>,
	sourceLower: number,
	sourceUpper: number,
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	// CountMustDeleted helper
	const countMustDeleted = (i: number) => [...mustDeleted].filter(d => d < i).length;

	// Length computation (Paper Section 4.7, L629-630)
	const mayDeletedL1 = [...mayDeleted].filter(d => d <= sourceLower).length;
	const mustDeletedU1 = [...mustDeleted].filter(d => d <= sourceUpper).length;
	const newLower = Math.max(0, sourceLower - mayDeletedL1);
	const newUpper = Math.max(0, sourceUpper - mustDeletedU1);

	// Build prefix
	const resultPrefixSize = Math.min(newUpper, value.known.isValue() ? value.known.value.length : 0);
	const resultKnownPositions: NAAwareDomain<Domain>[] = [];

	// Initialize to bottom
	for(let i = 0; i < resultPrefixSize; i++) {
		resultKnownPositions[i] = value.summary.bottom();
	}

	guard([...mustDeleted].filter(d => d > sourceUpper).length == 0, '');
	guard([...mayDeleted].filter(d => d > sourceUpper).length == 0, '');

	// Process MustNotDeleted positions (ascending)
	for(const i of [...mustNotDeleted].sort((a, b) => a - b)) {

		const accessed = accessPosition(value, i - 1, naValue);
		const targetIdx = i - countMustDeleted(i);
		guard(targetIdx >= 1 && targetIdx <= resultPrefixSize, '!(targetIdx >= 1 && targetIdx <= resultPrefixSize)');

		resultKnownPositions[targetIdx - 1] = resultKnownPositions[targetIdx - 1].join(accessed);
	}

	// Process MayDeleted positions (ascending, excluding mustDeleted)
	for(const i of [...mayDeleted].filter(i => !mustDeleted.has(i)).sort((a, b) => a - b)) {

		const accessed = accessPosition(value, i - 1, naValue);
		const targetIdx = i - countMustDeleted(i);
		guard(targetIdx >= 1 && targetIdx <= resultPrefixSize, '!(targetIdx >= 1 && targetIdx <= resultPrefixSize)');

		resultKnownPositions[targetIdx - 1] = resultKnownPositions[targetIdx - 1].join(accessed);
	}

	// Summary: sᵣ for infinite result, ⊥ for finite result (Paper §4.7, domain constraint: (u ≠ +∞) ⇒ (s = ⊥))
	const resultSummary = newUpper === +Infinity ? value.summary : value.summary.bottom();

	const result = value.create({
		length:     value.length.create([newLower, newUpper]),
		known:      value.known.create(resultKnownPositions),
		summary:    resultSummary,
		attributes: value.attributes,
		type:       value.type
	});
	vectorLogger.trace(`Result [length=${result.length.toString()}, values=${result.known.toString()}]`);
	return result;
}

/**
 * Applies negative indexing selection: x[c] where c < 0.
 * Negative indices specify positions to delete from the vector.
 * Preconditions (guaranteed by dispatcher):
 * - value is not Bottom
 * - selector is not Bottom
 * - selector contains only non-positive positions (no NA)
 *
 * Postconditions:
 * - Result length is reduced by number of excluded positions
 * - Result summary is ⊥ for non-enumerable selectors, preserved for enumerable
 * - Result attributes are preserved from source
 * @param value - The source VectorDomain to select from (not Bottom)
 * @param selector - The selector VectorDomain with negative intervals (not Bottom)
 * @param naValue - The NA value for out-of-bounds access
 * @returns The resulting VectorDomain after negative selection
 */
export function applySelectNegative<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	selector: VectorDomain<PosIntervalDomain>,
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	// Entry logging
	vectorLogger.trace(`applySelectNegative [source length=${value.length.toString()}, selector length=${selector.length.toString()}]`);

	// Preconditions (guaranteed by dispatcher):
	// - value is not Bottom
	// - selector is not Bottom

	// Get source bounds
	guard(value.length.isValue(), 'Source length is not value');
	const sourceLower = value.length.value[0];
	const sourceUpper = value.length.value[1];

	// === Compute adjusted selector (Paper L704-L709) ===
	// Apply AdjustForZeros to handle zero indices. If result is empty
	// (u₂' = 0), the selector contains only zeros and we return source unchanged.
	const adjustedSelector = adjustForZeros(selector);

	vectorLogger.trace(`Adjusted selector [length=${adjustedSelector.length.toString()}]`);

	// Empty selector after adjusting for zeros means no positions are deleted
	// Return source vector unchanged (no positions deleted)
	if(adjustedSelector.length.isValue()) {
		const [, newU] = adjustedSelector.length.value;
		if(newU === 0) {
			vectorLogger.debug('Operation: selectNegative - empty selector, returning source vector');
			return value;
		}
	}

	// Compute sets from ADJUSTED selector
	let mustDeleted = new Set<number>();
	let mayDeleted = new Set<number>();

	guard(adjustedSelector.known.isValue() && Array.isArray(adjustedSelector.known.value), 'Adjusted selector known positions not enumerable');
	const selectorValues = adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[];
	// Sets construction
	[mustDeleted, mayDeleted] = buildNegativeSets(sourceUpper, selectorValues);

	// Check if source known positions are enumerable (array of values)
	const sourceKnownEnumerable = value.known.isValue() && Array.isArray(value.known.value);

	// If source is not enumerable (e.g., Top vector with empty content but valorized summary),
	// use squash(value) for all positions instead of trying to access individual positions
	//
	// === Special case: source not enumerable ===
	// When the source vector has non-enumerable known positions (e.g., Top vector
	// with empty content), we cannot access individual positions. Use Squash(value)
	// to represent all possible values.
	//
	if(!sourceKnownEnumerable) {
		return selectNegativeSourceNotEnumerable(value, mustDeleted, mayDeleted, sourceLower, sourceUpper);
	}

	// Compute MustNotDeleted (positions definitely kept = not in MayDeleted)
	const mustNotDeleted = new Set<number>();
	for(let i = 1; i <= value.known.value.length; i++) {
		if(!mayDeleted.has(i)) {
			mustNotDeleted.add(i);
		}
	}

	vectorLogger.trace(`Sets computed [mustDeleted=${mustDeleted.size}, mayDeleted=${mayDeleted.size}, mustNotDeleted=${mustNotDeleted.size}]`);

	//
	// === Three paper paragraphs for negative selection ===
	// The behavior depends on whether the adjusted selector has non-enumerable
	// positions and whether it is finite vs infinite.
	//

	// Paragraph 1 (Paper L734-L754): At least one non-enumerable position.
	// Cannot precisely track which positions are excluded. Uses SquashExcept
	// with MustDeleted set. Result: [0, u₁ - |MustDeleted|] or [0, +∞] if u₁ = +∞.
	const hasNonEnumerable = adjustedSelector.known.isValue() &&
		(adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[])
			.some(idx => !isEnumerable(idx.inner));

	// Paragraph 1: At least one non-enumerable position (Paper §4.7, L591-605)
	if(hasNonEnumerable) {
		return selectNegativeNonEnumerable(value, mustDeleted, sourceUpper);
	}

	//
	// Paragraph 2 (Paper L756-L819): Infinite selector, all enumerable positions.
	// MustDeleted ⊆ MayDeleted. Result summary = s₁. Uses CountMustDeleted
	// to map positions: for each i in MustNotDeleted (ascending), place at
	// j ∈ [1, i - CountMustDeleted(i)]. Same for MayDeleted positions.
	//
	// Paragraph 3 (Paper L820-L827): Finite selector, all enumerable positions.
	// Same as Paragraph 2 but MayDeleted contains only non-singleton abstract
	// values from the content (summary contributes no positions since selector
	// is finite).
	//
	// Determine if selector is finite or infinite
	const selectorUpper = adjustedSelector.length.isValue() ? adjustedSelector.length.value[1] : +Infinity;
	const isInfinite = selectorUpper === +Infinity;

	if(isInfinite) {
		vectorLogger.debug('Paragraph 2: Infinite selector, all enumerable');
	} else {
		vectorLogger.debug('Paragraph 3: Finite selector, all enumerable');
	}

	return selectNegativeAllEnumerable(value, mustDeleted, mayDeleted, mustNotDeleted, sourceLower, sourceUpper, naValue);
}

// ============================================================================
// Logical Selection Helpers (Paper Section 4.7, L846-L884)
// ============================================================================

/**
 * Handles logical selection when source or selector is infinite.
 * Paper Section 4.7, L873-L884: Infinite case.
 * Result is [0, +∞] with summary = Squash(value).
 * @param value - The source VectorDomain
 * @param naValue - The NA value for positions with NA selector
 * @returns The resulting VectorDomain
 */
export function selectLogicalInfinite<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	_naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	vectorLogger.trace('Subcase: selectLogical - infinite source or selector');
	return value.create({
		length:     value.length.create([0, +Infinity]),
		known:      value.known.top(),
		summary:    squash(value),
		attributes: value.attributes,
		type:       value.type
	});
}

/**
 * Handles logical selection with finite source and selector, applying recycling.
 * Paper Section 4.7, L846-L872: Finite case with ρₓ^♯ recycling.
 * For each position, checks γ(cᵢ) to determine if element is selected.
 * @param value - The source VectorDomain
 * @param selector - The logical selector VectorDomain
 * @param naValue - The NA value for positions with NA selector
 * @param sourceLen - Length of source known positions
 * @param selectorLen - Length of selector known positions
 * @returns The resulting VectorDomain
 */
export function selectLogicalFiniteRecycling<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	selector: VectorDomain<PosIntervalDomain>,
	naValue: NAAwareDomain<Domain>,
	sourceLen: number,
	selectorLen: number
): VectorDomain<Domain> {
	vectorLogger.trace('Subcase: selectLogical - finite source and selector with recycling');
	const maxLen = Math.max(sourceLen, selectorLen);
	const resultKnownPositions: NAAwareDomain<Domain>[] = [];

	guard(selector.length.isValue(), 'Selector length is not a value');
	const adjustedSelector = rhoF(selector.known, selector.length.value[0], maxLen, selector.naAwareFactory);
	if(!adjustedSelector.isValue() || adjustedSelector.value.length === undefined) {
		return value.bottom();
	}

	// Empty selector after adjusting for zeros - return bottom
	if(adjustedSelector.value.length == 0) {
		vectorLogger.debug('Operation: selectLogical - empty selector, returning bottom');
		return value.bottom();
	}

	const plainSelector = adjustedSelector.toArray();
	for(let i = 0; i < plainSelector.length; i++) {
		const iVal = plainSelector[i];
		let sourceVal = NAAwareDomain.bottom(value.plainFactory);

		let [u, l] = [0, 0];
		if(iVal.inner.isValue()) {
			[u, l] = iVal.inner.value;

			if(l == 0 && u == 0) {
				vectorLogger.trace(`Extracted FALSE in position ${i}`);
				continue;
			} else if(u == 1) {
				vectorLogger.trace(`Contained TRUE in position ${i}`);
				const accessed = accessPosition(value, i, naValue);
				vectorLogger.trace(`Accessed value [${accessed.toString()}]`);
				sourceVal = sourceVal.join(accessed);
			}
		}

		if(iVal.containsNA()) {
			vectorLogger.trace(`Contained NA in position ${i}`);
			sourceVal = sourceVal.join(naValue);
		}

		guard(sourceVal.isValue(), `Selected position [sourceVal:${sourceVal.toString()}] not valid`);
		resultKnownPositions.push(sourceVal);
	}

	const isInfinite = selector.length.isValue() && selector.length.value[1] === +Infinity;
	const result = value.create({
		length:     value.length.create([0, resultKnownPositions.length]),
		known:      value.known.create(resultKnownPositions),
		summary:    isInfinite ? squash(value) : value.summary.bottom(),
		attributes: value.attributes,
		type:       value.type
	});
	return result;
}

/**
 * Applies logical indexing selection: x[c] where c is a logical vector.
 * Elements are selected where the corresponding selector value is TRUE.
 * @param value - The source VectorDomain to select from
 * @param selector - The logical selector VectorDomain
 * @param naValue - The NA value for positions with NA selector
 * @returns The resulting VectorDomain after logical selection
 */
export function applySelectLogical<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	selector: VectorDomain<PosIntervalDomain>,
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	vectorLogger.trace(`applySelectLogical [source length=${value.length.toString()}, selector length=${selector.length.toString()}]`);

	// Preconditions (guaranteed by dispatcher):
	// - value is not Bottom
	// - selector is not Bottom
	guard(value.known.isValue(), 'Source is Bottom');
	guard(selector.known.isValue(), 'Selector is Bottom');
	guard(selector.length.isValue(), 'Selector length is Bottom');

	const sourceLen = value.known.value.length;
	const selectorLen = selector.known.value.length;

	//
	// === Early guard: empty selector ===
	// Empty logical selector returns source unchanged.
	//

	if(selectorLen === 0) {
		vectorLogger.trace('Subcase: selectLogical - empty selector');
		return value;
	}

	//
	// === Paper L873-L884: Infinite source or selector ===
	// Result is [0, +∞] with summary = Squash(value). Cannot enumerate all positions.
	//

	if(sourceLen === +Infinity || selectorLen === +Infinity) {
		return selectLogicalInfinite(value, naValue);
	}

	//
	// === Paper L846-L872: Finite source and selector (logical selection) ===
	// Apply ρₓ^♯ to cycle selector to match max(|known₁|, |known₂|).
	// For each position i, based on γ(cᵢ):
	//   {1}       → select element from ν₁ (definitely TRUE)
	//   {0,1}     → select element from ν₁ (may be TRUE/FALSE)
	//   {1,NA}    → select ⊔ NA (may be TRUE or NA)
	//   {0,1,NA}  → select ⊔ NA (may be TRUE/FALSE/NA)
	//   {NA}      → result is NA
	//   {0}       → skip (definitely FALSE)
	// Result length: [0, |known_r|], summary: ⊥ if finite, Squash if infinite.
	//

	return selectLogicalFiniteRecycling(value, selector, naValue, sourceLen, selectorLen);
}
