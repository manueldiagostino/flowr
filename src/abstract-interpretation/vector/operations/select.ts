/* eslint-disable tsdoc/syntax */
import type { AnyAbstractDomain } from '../../domains/abstract-domain';
import type { ArithmeticDomain } from '../../domains/arithmetic-domain';
import { VectorDomain } from '../vector-domain';
import { NAAwareDomain } from '../na-aware-domain';
import type { IntervalDomain } from '../../domains/interval-domain';
import type { PosIntervalDomain } from '../../domains/positive-interval-domain';
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
	if(allZeros) {
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

	// INVARIANT 5: Positive Selector Filtering
	// Ensure selector contains only non-negative positions or NA before calling applySelectPositive
	if(filterResult.positive.length > 0 && !filterResult.positiveHasBottom) {
		const positiveSelector = buildPosIntervalSelector(numericSelector, filterResult.positive);
		const resultPos = applySelectPositive(value, positiveSelector, naValue);
		vectorLogger.debug(`Operation: select positive result [length=${resultPos.length.toString()}]`);
		result = result.join(resultPos);
	}

	// INVARIANT 6: Negative Selector Filtering
	// Ensure selector contains only non-positive positions (no NA) before calling applySelectNegative
	if(filterResult.negative.length > 0 && !filterResult.negativeHasBottom) {
		const negativeSelector = buildPosIntervalSelector(numericSelector, filterResult.negative);
		const resultNeg = applySelectNegative(value, negativeSelector, naValue);
		vectorLogger.debug(`Operation: select negative result [length=${resultNeg.length.toString()}]`);
		result = result.join(resultNeg);
	}

	vectorLogger.debug(`Operation: select final result [length=${result.length.toString()}, values=${result.known.toString()}]`);
	return result;
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

	const resultKnownPositions: NAAwareDomain<Domain>[] = [];
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
					// After adjustForZeros, all positions are guaranteed to be > 0
					// No zero-to-one conversion needed
					for(let pos = l; pos <= u; pos++) {
						if(pos > 0) {
							const accessed = accessPosition(value, pos - 1, naValue);
							joinedAccessed = joinedAccessed === undefined ? accessed : joinedAccessed.join(accessed);
						}
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
	const isInfinite = selectorLen.isValue() && selectorLen.value[1] === +Infinity;
	if(isInfinite) {
		vectorLogger.trace('Subcase: selectPositive - infinite selector, valorizing summary');
	}

	// Summary: ⊥ for finite selectors, Squash(value) for infinite
	const resultSummary = isInfinite ? squash(value) : value.summary.bottom();
	const resultValues = value.known.create(resultKnownPositions);
	const result = value.create({
		length:     adjustedSelector.length,
		known:      resultValues,
		summary:    resultSummary,
		attributes: value.attributes,
		type:       value.type
	});
	return result;
}

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
	if(sourceUpper === +Infinity) {
		vectorLogger.trace('Subcase: selectNegative - infinite source, returning top');
		return value.top();
	}

	// Compute adjusted selector: removes zero indices and adjusts length bounds
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


	// Compute MustNotDeleted
	const mustNotDeleted = new Set<number>();
	guard(value.known.isValue() && Array.isArray(value.known.value), 'Source known positions not enumerable');
	for(let i = 1; i <= value.known.value.length; i++) {
		if(!mayDeleted.has(i)) {
			mustNotDeleted.add(i);
		}
	}

	vectorLogger.trace(`Sets computed [mustDeleted=${mustDeleted.size}, mayDeleted=${mayDeleted.size}, mustNotDeleted=${mustNotDeleted.size}]`);

	// Check for non-enumerable positions in adjusted selector
	const hasNonEnumerable = adjustedSelector.known.isValue() &&
		(adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[])
			.some(idx => !isEnumerable(idx.inner));

	// Paragraph 1: At least one non-enumerable position (Paper §4.7, L591-605)
	if(hasNonEnumerable) {
		vectorLogger.debug('Paragraph 1: Non-enumerable position in selector, using SquashExcept');
		const newUpper = Math.max(0, sourceUpper - mustDeleted.size);
		const resultLength = value.length.create([0, newUpper]);
		const resultKnownPositions: NAAwareDomain<Domain>[] = [];

		// prefix_r = [SquashExcept(ν₁, MustDeleted)]_1^(u₁ - |MustDeleted|)
		const squashResult = squashedExcept(value, mustDeleted);
		for(let i = 0; i < newUpper; i++) {
			resultKnownPositions.push(squashResult);
		}

		const result = value.create({
			length:     resultLength,
			known:      value.known.create(resultKnownPositions),
			summary:    value.summary.bottom(),
			attributes: value.attributes,
			type:       value.type
		});
		vectorLogger.trace(`Result [length=${result.length.toString()}, values=${result.known.toString()}]`);
		return result;
	}

	// Paragraphs 2 & 3: All enumerable positions
	// Determine if selector is finite or infinite
	const selectorUpper = adjustedSelector.length.isValue() ? adjustedSelector.length.value[1] : +Infinity;
	const isInfinite = selectorUpper === +Infinity;

	if(isInfinite) {
		vectorLogger.debug('Paragraph 2: Infinite selector, all enumerable');
	} else {
		vectorLogger.debug('Paragraph 3: Finite selector, all enumerable');
	}

	// CountMustDeleted helper
	const countMustDeleted = (i: number) => [...mustDeleted].filter(d => d < i).length;

	// Length computation
	const mustDeletedU1 = [...mustDeleted].filter(d => d <= sourceUpper).length;
	const mayDeletedL1 = [...mayDeleted].filter(d => d <= sourceLower).length;
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

	// Summary: s₁ for infinite, ⊥ for finite (Paper §4.7, L607-639 vs L641-646)
	const resultSummary = isInfinite ? value.summary : value.summary.bottom();

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

	if(selectorLen === 0) {
		vectorLogger.trace('Subcase: selectLogical - empty selector');
		return value;
	}

	if(sourceLen === +Infinity || selectorLen === +Infinity) {
		vectorLogger.trace('Subcase: selectLogical - infinite source or selector');
		const result = value.create({
			length:     value.length.create([0, +Infinity]),
			known:      value.known.top(),
			summary:    squash(value),
			attributes: value.attributes,
			type:       value.type
		});
		return result;
	}

	vectorLogger.trace('Subcase: selectLogical - finite source and selector with recycling');
	const maxLen = Math.max(sourceLen, selectorLen);
	const resultKnownPositions: NAAwareDomain<Domain>[] = [];

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
	for(let i = 0; i < selector.known.value.length; i++) {
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
