import type { AnyAbstractDomain } from '../../domains/abstract-domain';
import type { ArithmeticDomain } from '../../domains/arithmetic-domain';
import { VectorDomain, type DomainFactory } from '../vector-domain';
import { NAAwareDomain } from '../na-aware-domain';
import { IntervalDomain } from '../../domains/interval-domain';
import { PosIntervalDomain } from '../../domains/positive-interval-domain';
import { KnownInitialPositionsDomain } from '../known-initial-positions-domain';
import { Bottom, Top } from '../../domains/lattice';
import { vectorLogger } from '../logger';
import { expensiveTrace } from '../../../util/log';
import { guard } from '../../../util/assert';
import {
	card,
	squash,
	isEnumerable,
	adjustForZeros,
	initKnownPositions,
	updateKnownPositions,
	rhoF
} from '../vector-semantics';
import {
	buildPosIntervalSelector,
	buildIntervalSelector
} from '../helpers/selector-builders';

/**
 * Applies the update operation to modify elements in a vector based on a selector.
 * Uses abstract filtering (paper Section 4.8) for numeric selectors and AST-based
 * detection for logical selectors.
 *
 * For numeric selectors, applies `abstractFilter` to classify positions into
 * positive (≥ 0 or NA) and negative (≤ 0), then computes:
 * `update(ν₁, ν₂, ν₃) = update_pos(ν₁, ν₂⁺, ν₃) ⊔ update_neg(ν₁, ν₂⁻, ν₃)`
 *
 * Paper Section 4.8: Vector Update
 * @param value - The target VectorDomain to update
 * @param selector - The selector for positions to update
 * @param values - The values to assign to selected positions
 * @param naValue - The NA value for out-of-bounds positions
 * @returns The resulting VectorDomain after update
 */
export function applyUpdate<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	selector: VectorDomain<IntervalDomain>,
	values: VectorDomain<Domain>,
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	// Derive selector kind from the selector's type (logical vs numeric)
	const selectorKind = selector.type.getType() === 'logical' ? 'logical' : 'numeric';
	vectorLogger.debug(`Operation: update [selectorKind=${selectorKind}]`);
	vectorLogger.debug(`Operation: update input [value.length=${value.length.toString()}, selector.length=${selector.length.toString()}, values.length=${values.length.toString()}]`);

	if(value.isBottom() || selector.isBottom() || values.isBottom()) {
		vectorLogger.debug('Operation: update returning bottom (input is bottom)');
		return value.bottom();
	}

	// Paper Section 4.8 (L757-769): Empty selector update
	// rUpdateSharp(ν1, genvecalpha(rEmpty), ν3) = rUpdateSharp_pos(ν1, ν2', ν3)
	// where ν2' = rvec[[l1,u1], ⟨[1,1][2,2]...[u1,u1]⟩, s1, a1]
	const isEmptySelector = selector.length.isValue() &&
		selector.length.value[0] === 0 &&
		selector.length.value[1] === 0;
	if(isEmptySelector) {
		vectorLogger.debug('Operation: update with empty selector - building matching selector');
		// Construct selector matching source vector length: [1,1], [2,2], ..., [u1,u1]
		const constructedSelector = buildSelectorMatchingSourceLength(value);
		const result = applyUpdatePositive(value, constructedSelector, values, naValue);
		vectorLogger.debug(`Operation: update empty selector result [length=${result.length.toString()}]`);
		return result;
	}

	// Logical selector: use logical update
	if(selectorKind === 'logical') {
		const result = applyUpdateLogical(value, selector, values, naValue);
		vectorLogger.debug(`Operation: update logical result [length=${result.length.toString()}]`);
		return result;
	}

	const numericSelector = selector;

	// Check for Bottom: selector known positions are impossible
	if(numericSelector.known.isBottom()) {
		vectorLogger.debug('Operation: update returning bottom (selector known is bottom)');
		return value.bottom();
	}

	// Check for Top: selector known positions are unknown, apply conservative fallback
	if(numericSelector.known.isTop()) {
		vectorLogger.debug('Operation: update cannot enumerate selector values (known is top), applying conservative fallback');
		// Conservative fallback: result summary = squash(value) join squash(values)
		// known positions empty, length = [l1, +Infinity] if value.length is a value else top length
		// preserve attributes and type
		const resultSummary = squash(value).join(squash(values));
		const resultLength = value.length.isValue()
			? value.length.create([value.length.value[0], +Infinity])
			: value.length.top();
		const result = value.create({
			length:     resultLength,
			known:      value.known.create([]),
			summary:    resultSummary,
			attributes: value.attributes,
			type:       value.type
		});
		vectorLogger.debug(`Operation: update conservative fallback result [length=${result.length.toString()}]`);
		return result;
	}

	// At this point, known must be a value (non-empty array)
	if(!Array.isArray(numericSelector.known.value)) {
		// This should not happen if isValue() and !isTop() and !isBottom() are all true
		vectorLogger.debug('Operation: update returning bottom (selector known value is not an array)');
		return value.bottom();
	}

	// Check if selector is all zeros (will become empty after adjustForZeros)
	// In this case, return value unchanged (update does nothing; zeros ignored)
	const selectorValues = numericSelector.known.value as readonly NAAwareDomain<IntervalDomain>[];
	const allZeros = selectorValues.every(pos => {
		if(!pos.isValue() || !pos.inner.isValue()) {
			return false;
		}
		const [l, u] = pos.inner.value;
		return l === 0 && u === 0;
	});
	if(allZeros) {
		vectorLogger.debug('Operation: update with all-zero selector, returning value unchanged');
		return value;
	}

	// Paper Section 4.8: abstract filter classifies selector positions
	const selectorPositions = numericSelector.known.value;
	const filterResult = VectorDomain.abstractFilter(selectorPositions, numericSelector.plainFactory);
	vectorLogger.debug(`Operation: update filter [positive=${filterResult.positive.length}, negative=${filterResult.negative.length}]`);

	// Handle bottom propagation: if both groups have bottom elements, result is bottom
	if(filterResult.positiveHasBottom && filterResult.negativeHasBottom) {
		vectorLogger.debug('Operation: update returning bottom (both groups have bottom)');
		return value.bottom();
	}

	let result = value.bottom();

	// Build positive selector and apply update_pos (paper Section 4.8)
	if(filterResult.positive.length > 0 && !filterResult.positiveHasBottom) {
		const positiveSelector = buildPosIntervalSelector(numericSelector, filterResult.positive);
		const resultPos = applyUpdatePositive(value, positiveSelector, values, naValue);
		vectorLogger.debug(`Operation: update positive result [length=${resultPos.length.toString()}]`);
		result = result.join(resultPos);
	}

	// Build negative selector and apply update_neg (paper Section 4.8)
	// IMPORTANT: Use buildIntervalSelector to preserve negative IntervalDomain values
	// (not buildPosIntervalSelector which negates them)
	if(filterResult.negative.length > 0 && !filterResult.negativeHasBottom) {
		const negativeSelector = buildIntervalSelector(numericSelector, filterResult.negative);
		const resultNeg = applyUpdateNegative(value, negativeSelector, values, naValue);
		vectorLogger.debug(`Operation: update negative result [length=${resultNeg.length.toString()}]`);
		result = result.join(resultNeg);
	}

	vectorLogger.debug(`Operation: update final result [length=${result.length.toString()}, values=${result.known.toString()}]`);
	return result;
}

/**
 * Builds a selector that matches the source vector's abstract length.
 * Paper Section 4.8 (L757-769): For empty selector update:
 * ν2' = rvec[[l1,u1], ⟨[1,1][2,2]...[u1,u1]⟩, s1, a1]
 * @param value - The source vector to match
 * @returns A selector with positions 1..u1
 */
export function buildSelectorMatchingSourceLength<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>
): VectorDomain<PosIntervalDomain> {
	const posIntervalFactory: DomainFactory<PosIntervalDomain> = (c: unknown) => {
		if(c === undefined || c === Bottom) {
			return PosIntervalDomain.bottom();
		}
		if(c === Top) {
			return PosIntervalDomain.top();
		}
		const values = [...(c as Set<number>)];
		return new PosIntervalDomain([Math.min(...values), Math.max(...values)]);
	};

	// Get source length bounds
	let upper = 0;
	if(value.length.isValue()) {
		upper = value.length.value[1];
	} else {
		// If length is not a value, return bottom (cannot construct selector)
		return VectorDomain.bottom(posIntervalFactory);
	}

	// Handle infinite length
	if(upper === +Infinity) {
		// For infinite vectors, construct infinite selector
		const infiniteSelector = VectorDomain.create(
			posIntervalFactory,
			new PosIntervalDomain([0, +Infinity]),
			KnownInitialPositionsDomain.top(
				NAAwareDomain.createSmartFactory(posIntervalFactory)
			),
			new NAAwareDomain({ inner: new PosIntervalDomain([1, +Infinity]), hasNA: false }, posIntervalFactory),
			value.attributes,
			value.type
		);
		return infiniteSelector;
	}

	// Build positions [1,1], [2,2], ..., [u1,u1]
	const naFactory = NAAwareDomain.createSmartFactory(posIntervalFactory);
	const positions: NAAwareDomain<PosIntervalDomain>[] = [];
	for(let i = 1; i <= upper; i++) {
		const posInterval = new PosIntervalDomain([i, i]);
		positions.push(new NAAwareDomain({ inner: posInterval, hasNA: false }, posIntervalFactory));
	}

	const knownPositions = new KnownInitialPositionsDomain(positions, naFactory);
	const summary = new NAAwareDomain({ inner: PosIntervalDomain.bottom(), hasNA: false }, posIntervalFactory);

	return new VectorDomain({
		length:     new PosIntervalDomain([0, upper]),
		known:      knownPositions,
		summary:    summary,
		attributes: value.attributes,
		type:       value.type
	}, posIntervalFactory);
}

/**
 * Applies positive indexing update: `x[c] \<- v` where c \>= 0.
 * Handles both finite and infinite selectors using cyclic value recycling.
 * Paper Section 4.8.1 (lines 916-932).
 *
 * **Preconditions (expected by dispatcher):**
 * - `value`, `selector`, `values` are not Bottom (dispatcher ensures this)
 * - `selector` contains only non-negative positions (≥ 0) or NA
 * - `selector` has been classified as positive by abstractFilter
 *
 * **Structural Invariants:**
 * - After adjustForZeros, selector length may be [0,0] (empty), Top, or Bottom
 * - adjustForZeros can return Bottom/Top depending on selector content
 * - Enumerable positions: card(interval) ≤ θ (threshold for enumeration)
 * - Non-enumerable positions: use squash operation (join all values)
 *
 * **Postconditions:**
 * - Result length: [sourceLower, max(sourceUpper, selectorUpper)] for finite selectors
 * - Result length: [sourceLower, +∞] for infinite selectors
 * - Result summary: ⊥ for finite selectors, squash(values) for infinite
 * - Known positions: updated via cyclic recycling of values
 * @param value - The target VectorDomain to update
 * @param selector - The positive selector VectorDomain (contains only c ≥ 0)
 * @param values - The values to assign (cyclically recycled)
 * @param naValue - The NA value for out-of-bounds positions
 * @returns The resulting VectorDomain after positive update
 */
export function applyUpdatePositive<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	selector: VectorDomain<IntervalDomain>,
	values: VectorDomain<Domain>,
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	vectorLogger.debug('Operation: updatePositive');
	const adjustedSelector = adjustForZeros(selector);
	if(adjustedSelector.isBottom() || adjustedSelector.length.isBottom()) {
		expensiveTrace(vectorLogger, () => 'adjustedSelector is Bottom, returning Bottom');
		return value.bottom();
	}

	guard(adjustedSelector.length.isValue(), 'adjustedSelector length is not a Value');
	const [_adjustedL, adjustedU] = adjustedSelector.length.value;
	if(adjustedU === 0) {
		vectorLogger.debug('Operation: updatePositive - all-zero selector, returning value unchanged');
		return value;
	}

	const hasNonEnumerable = adjustedSelector.known.isValue() && (adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[]).some(idx => !isEnumerable(idx.inner));
	if(hasNonEnumerable) {
		vectorLogger.trace('Subcase: updatePositive - non-enumerable selector, using squash');
		const vAll = squash(value).join(squash(values));
		const result = value.create({
			length:     value.length.create([value.length.isValue() ? value.length.value[0] : 0, +Infinity]),
			known:      value.known.create([]),
			summary:    vAll,
			attributes: value.attributes,
			type:       value.type
		});
		return result;
	}
	let sourceLower = 0, sourceUpper = 0;
	if(value.length.isValue()) {
		sourceLower = value.length.value[0];
		sourceUpper = value.length.value[1];
	}
	let selectorUpper = 0;
	if(adjustedSelector.length.isValue()) {
		selectorUpper = adjustedSelector.length.value[1];
	}
	const isInfinite = selectorUpper === +Infinity;
	if(isInfinite) {
		vectorLogger.trace('Subcase: updatePositive - infinite selector');
		const summaryInner = adjustedSelector.summary.inner;
		const selectorSummaryEnumerable = summaryInner !== undefined ? isEnumerable(summaryInner) : false;
		const summaryLower = summaryInner !== undefined && summaryInner.isValue() ? summaryInner.value[0] : 0;
		const uR = Math.max(selectorUpper === +Infinity ? 0 : selectorUpper, summaryLower);
		const selectorKnownPositions = adjustedSelector.known.isValue() ? (adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[]) : [];
		const baseKnownPositions = initKnownPositions(selectorKnownPositions as unknown as NAAwareDomain<Domain>[], sourceLower, sourceUpper, uR, naValue);
		let valuesUpper = 0;
		if(values.length.isValue()) {
			valuesUpper = values.length.value[1];
		}
		const vLower = values.length.isValue() ? values.length.value[0] : 1;
		const rhoFResult = rhoF(values.known, vLower, valuesUpper, values.factory);
		const cyclicValues = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];
		const resultKnownPositions = updateKnownPositions(baseKnownPositions, selectorKnownPositions, cyclicValues);
		if(!selectorSummaryEnumerable && summaryInner != undefined && summaryInner.isValue()) {
			const squashValues = squash(values);
			const squashValuesInner = squashValues.inner;
			const lS2 = summaryInner.value[0];
			for(let i = Math.max(0, lS2 - 1); i < resultKnownPositions.length; i++) {
				resultKnownPositions[i] = resultKnownPositions[i].join(squashValuesInner !== undefined ? squashValues : naValue.top());
			}
		}
		const resultSummary = value.summary.join(squash(values));
		const result = value.create({
			length:     value.length.create([sourceLower, +Infinity]),
			known:      value.known.create(resultKnownPositions),
			summary:    resultSummary,
			attributes: value.attributes,
			type:       value.type
		});
		return result;
	} else {
		vectorLogger.trace('Subcase: updatePositive - finite selector');
		let uR = 0;
		if(adjustedSelector.known.isValue()) {
			const selectorKnownPositions = adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[];
			for(const idx of selectorKnownPositions) {
				if(idx.inner.isValue()) {
					uR = Math.max(uR, idx.inner.value[1]);
				}
			}
		}
		uR = Math.max(uR, sourceUpper);
		const selectorKnownPositions = adjustedSelector.known.isValue() ? (adjustedSelector.known.value as readonly NAAwareDomain<PosIntervalDomain>[]) : [];
		// Use the source vector's known positions as the base, not the selector positions
		const sourceKnownPositions = value.known.isValue() ? (value.known.value as readonly NAAwareDomain<Domain>[]) : [];
		const baseKnownPositions = initKnownPositions(sourceKnownPositions, sourceLower, sourceUpper, uR, naValue);
		let valuesUpper = 0;
		if(values.length.isValue()) {
			valuesUpper = values.length.value[1];
		}
		const vLower = values.length.isValue() ? values.length.value[0] : 1;
		const rhoFResult = rhoF(values.known, vLower, Math.max(selectorUpper, valuesUpper), values.factory);
		const cyclicValues = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];
		const resultKnownPositions = updateKnownPositions(baseKnownPositions, selectorKnownPositions, cyclicValues);
		const result = value.create({
			length:     value.length.create([sourceLower, uR]),
			known:      value.known.create(resultKnownPositions),
			summary:    value.summary.bottom(),
			attributes: value.attributes,
			type:       value.type
		});
		return result;
	}
}

/**
 * Applies negative indexing update: `x[c] \<- v` where c \< 0.
 * Negative indices specify positions to update by their absolute values.
 * Paper Section 4.8.2 (lines 934-1026).
 *
 * **Preconditions (expected by dispatcher):**
 * - `value`, `selector`, `values` are not Bottom (dispatcher ensures this)
 * - `selector` contains only non-positive positions (≤ 0), no NA
 * - `selector` has been classified as negative by abstractFilter
 * - `value.length` must be a Value (not Top/Bottom) - defensive check inside
 *
 * **Structural Invariants:**
 * - Negative indices in range [-u₁, -1] map to positions [1, u₁]
 * - MustNotUpdated: positions definitely NOT updated (singleton negative indices)
 * - MayNotUpdated: positions possibly NOT updated (non-singleton intervals or summary)
 * - MustUpdated: positions definitely updated (in prefix, not in MustNotUpdated ∪ MayNotUpdated)
 * - Infinite source (u₁ = +∞) returns Top (cannot determine all positions)
 *
 * **Postconditions:**
 * - Paragraph 1 (non-enumerable): weak update with squash(values), summary updated if infinite
 * - Paragraph 2 (infinite selector): converts to positive selector, delegates to applyUpdatePositive
 * - Paragraph 3 (finite selector): strong update with cyclic recycling, summary = ⊥
 * - Result length: [sourceLower, max(sourceUpper, selectorUpper)] for finite selectors
 * @param value - The target VectorDomain to update
 * @param selector - The negative selector VectorDomain (contains only c ≤ 0)
 * @param values - The values to assign (cyclically recycled)
 * @param naValue - The NA value for out-of-bounds positions
 * @returns The resulting VectorDomain after negative update
 */
export function applyUpdateNegative<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	selector: VectorDomain<IntervalDomain>,
	values: VectorDomain<Domain>,
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	// 1. Entry logging
	vectorLogger.trace(`applyUpdateNegative [source length=${value.length.toString()}, selector length=${selector.length.toString()}]`);

	// 2. Guard: extract source length bounds (dispatcher already checked value/selector/values not Bottom)
	let sourceLower = 0;
	let sourceUpper = 0;
	if(value.length.isValue()) {
		sourceLower = value.length.value[0];
		sourceUpper = value.length.value[1];
		// 3. Guard: infinite source
		if(sourceUpper === +Infinity) {
			vectorLogger.trace('Subcase: updateNegative - infinite source, returning top');
			return value.top();
		}
	} else {
		vectorLogger.trace('Subcase: updateNegative - non-value source length, returning bottom');
		return value.bottom();
	}

	// 5. Compute adjusted selector
	const adjustedSelector = adjustForZeros(selector);
	vectorLogger.trace(`Adjusted selector [length=${adjustedSelector.length.toString()}]`);

	// 6. Compute MustNotUpdated set (Paper §4.8.2, lines 934-936)
	// Positions definitely NOT updated: card(p) = 1 and valid positive index in [1, u₁]
	const mustNotUpdated = new Set<number>();
	// 7. Compute MayNotUpdated set (Paper §4.8.2, lines 938-944)
	// Positions possibly NOT updated (non-singleton intervals or from summary)
	const mayNotUpdated = new Set<number>();

	if(adjustedSelector.known.isValue()) {
		const selectorKnownPositions = adjustedSelector.known.value;
		for(const idx of selectorKnownPositions) {
			if(idx.isBottom() || idx.isNA()) {
				continue;
			}

			const innerInterval = idx.inner;
			if(innerInterval.isValue()) {
				const [l, u] = innerInterval.value;
				// Negative indices: must be in range [-u₁, -1] to be valid
				if(l <= 0 && u <= 0) {
					const posLower = Math.abs(u); // |u| is smaller absolute value
					const posUpper = Math.abs(l); // |l| is larger absolute value
					if(card(innerInterval) === 1) {
						// Singleton: definitely this position
						const pos = posLower;
						if(pos >= 1 && pos <= sourceUpper) {
							mustNotUpdated.add(pos);
							mayNotUpdated.add(pos);
						}
					} else {
						// Non-singleton interval: range of possible positions
						for(let pos = posLower; pos <= posUpper && pos <= sourceUpper; pos++) {
							mayNotUpdated.add(pos);
						}
					}
				}
			} else {
				// Top interval: all positions may be not updated
				for(let pos = 1; pos <= sourceUpper; pos++) {
					mayNotUpdated.add(pos);
				}
			}
		}
	} else {
		// adjustedSelector.known is Bot: all positions may be not updated
		for(let pos = 1; pos <= sourceUpper; pos++) {
			mayNotUpdated.add(pos);
			mustNotUpdated.add(pos);
		}
	}

	// 8. Compute MustUpdated set (Paper §4.8.2, lines 946-948)
	// Positions definitely updated: [1, |prefix₁|] \ (MustNotUpdated ∪ MayNotUpdated)
	const mustUpdated = new Set<number>();
	const prefixLength = value.known.isValue() ? value.known.value.length : 0;
	for(let i = 1; i <= Math.min(prefixLength, sourceUpper); i++) {
		if(!mustNotUpdated.has(i) && !mayNotUpdated.has(i)) {
			mustUpdated.add(i);
		}
	}

	vectorLogger.trace(`Sets computed [mustNotUpdated=${mustNotUpdated.size}, mayNotUpdated=${mayNotUpdated.size}, mustUpdated=${mustUpdated.size}]`);

	// 9. Check for non-enumerable positions in adjusted selector
	const hasNonEnumerable = adjustedSelector.known.isValue()
		&& (adjustedSelector.known.value).some(idx => !idx.isNA() && !idx.isBottom() && !isEnumerable(idx.inner));

	// 10. Paragraph 1: At least one non-enumerable position (Paper §4.8.2, lines 953-975)
	if(hasNonEnumerable) {
		vectorLogger.debug('Paragraph 1: Non-enumerable position in selector, using weak update');
		const v = squash(values);
		const sourceKnownPositions = value.known.isValue()
			? (value.known.value as readonly NAAwareDomain<Domain>[])
			: [];
		const resultKnownPositions: NAAwareDomain<Domain>[] = [];

		// Initialize to prefix₁, then weakly update positions not in MustNotUpdated
		for(let i = 1; i <= sourceUpper; i++) {
			const idx = i - 1;
			let val: NAAwareDomain<Domain>;
			if(idx < sourceKnownPositions.length) {
				val = sourceKnownPositions[idx];
			} else {
				val = value.summary;
			}
			// Weakly update: join with v if not definitely not updated
			if(!mustNotUpdated.has(i)) {
				val = val.join(v);
			}
			resultKnownPositions.push(val);
		}

		// Summary: if u₁ = +∞, update as s_r = s₁ ⊔ v
		const resultSummary = sourceUpper === +Infinity ? value.summary.join(v) : value.summary;

		const result = value.create({
			length:     value.length,
			known:      value.known.create(resultKnownPositions),
			summary:    resultSummary,
			attributes: value.attributes,
			type:       value.type
		});
		vectorLogger.trace(`Result [length=${result.length.toString()}]`);
		return result;
	}

	// 11. Paragraphs 2 & 3: All enumerable positions
	// Determine if selector is finite or infinite
	const selectorUpper = adjustedSelector.length.isValue() ? adjustedSelector.length.value[1] : +Infinity;
	const isInfinite = selectorUpper === +Infinity;

	if(isInfinite) {
		// 12. Paragraph 2: Infinite selector, all enumerable (Paper §4.8.2, lines 977-1015)
		vectorLogger.debug('Paragraph 2: Infinite selector, all enumerable, building positive selector');

		// Factory for creating PosIntervalDomain values
		const posIntervalFactory: DomainFactory<PosIntervalDomain> = (c: unknown) => {
			if(c === undefined) {
				return PosIntervalDomain.bottom();
			}
			if(c === Bottom) {
				return PosIntervalDomain.bottom();
			}
			if(c === Top) {
				return PosIntervalDomain.top();
			}
			const values = [...(c as Set<number>)];
			return new PosIntervalDomain([Math.min(...values), Math.max(...values)]);
		};

		// Build positive selector from MustUpdated and MayNotUpdated
		// Length: [lᵣ, uᵣ] = [|MustUpdated_{l₁}|, u₁ - |MustNotUpdated_{u₁}|]
		const mustUpdatedCount = [...mustUpdated].filter(i => i >= sourceLower).length;
		const mustNotUpdatedCount = [...mustNotUpdated].filter(i => i <= sourceUpper).length;
		const resultLengthLower = mustUpdatedCount;
		const resultLengthUpper = sourceUpper - mustNotUpdatedCount;

		// Build selector prefix
		const selectorPrefixPositions: NAAwareDomain<IntervalDomain>[] = [];

		// CountMustNotUpdated helper: count positions < i
		const countMustNotUpdated = (i: number) => [...mustNotUpdated].filter(p => p < i).length;

		// For each position in MustUpdated (ascending)
		for(const i of [...mustUpdated].sort((a, b) => a - b)) {
			const targetIdx = i - countMustNotUpdated(i);
			// Ensure selectorPrefixPositions has enough room
			while(selectorPrefixPositions.length < targetIdx) {
				selectorPrefixPositions.push(new NAAwareDomain({
					inner: IntervalDomain.bottom(),
					hasNA: false
				}, posIntervalFactory));
			}
			if(targetIdx >= 1) {
				selectorPrefixPositions[targetIdx - 1] = new NAAwareDomain<IntervalDomain>({
					inner: new IntervalDomain([i, i]),
					hasNA: false
				}, posIntervalFactory);
			}
		}

		// For each position in MayNotUpdated (ascending, excluding MustNotUpdated)
		for(const i of [...mayNotUpdated].filter(i => !mustNotUpdated.has(i)).sort((a, b) => a - b)) {
			if(i > sourceUpper) {
				continue;
			}
			const targetIdx = i - countMustNotUpdated(i);
			while(selectorPrefixPositions.length < targetIdx) {
				selectorPrefixPositions.push(new NAAwareDomain<IntervalDomain>({
					inner: IntervalDomain.bottom(),
					hasNA: false
				}, posIntervalFactory));
			}
			if(targetIdx >= 1) {
				const existing = selectorPrefixPositions[targetIdx - 1];
				selectorPrefixPositions[targetIdx - 1] = existing.join(new NAAwareDomain<IntervalDomain>({
					inner: new IntervalDomain([i, i]),
					hasNA: false
				}, posIntervalFactory));
			}
		}

		// Build selector vector
		const positiveSelector = selector.create({
			length:     new PosIntervalDomain([resultLengthLower, resultLengthUpper]),
			known:      adjustedSelector.known.create(selectorPrefixPositions),
			summary:    adjustedSelector.summary,
			attributes: adjustedSelector.attributes,
			type:       adjustedSelector.type
		});

		// Call applyUpdatePositive
		const result = applyUpdatePositive(value, positiveSelector, values, naValue);
		vectorLogger.trace(`Result [length=${result.length.toString()}]`);
		return result;
	} else {
		// 13. Paragraph 3: Finite selector, all enumerable (Paper §4.8.2, lines 1017-1026)
		vectorLogger.debug('Paragraph 3: Finite selector, all enumerable');

		// uᵣ = max(u₁, u₂')
		const uR = Math.max(sourceUpper, selectorUpper);

		// Generate cyclic values: prefix₃' = ρ_f^♯(ν₃, l₃, uᵣ)
		let valuesUpper = 0;
		if(values.length.isValue()) {
			valuesUpper = values.length.value[1];
		}
		const vLower = values.length.isValue() ? values.length.value[0] : 1;
		const rhoFResult = rhoF(values.known, vLower, Math.max(selectorUpper, valuesUpper), values.factory);
		const cyclicValues = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];

		// Build base positions from source
		const sourceKnownPositions = value.known.isValue()
			? (value.known.value as readonly NAAwareDomain<Domain>[])
			: [];
		const resultKnownPositions: NAAwareDomain<Domain>[] = [];

		for(let i = 0; i < uR; i++) {
			if(i < sourceKnownPositions.length) {
				resultKnownPositions.push(sourceKnownPositions[i]);
			} else if(i < sourceUpper) {
				resultKnownPositions.push(value.summary);
			} else {
				resultKnownPositions.push(naValue);
			}
		}

		// Update positions that are not in MustNotUpdated or MayNotUpdated
		// (i.e., positions that are definitely being updated)
		const notUpdatedPositions = new Set([...mustNotUpdated, ...mayNotUpdated]);
		for(let i = 1; i <= uR; i++) {
			if(!notUpdatedPositions.has(i)) {
				const idx = i - 1;
				const valueIdx = (i - 1) % cyclicValues.length;
				resultKnownPositions[idx] = cyclicValues[valueIdx];
			}
		}

		// Result length: [l₁, uᵣ], summary: ⊥
		const result = value.create({
			length:     value.length.create([sourceLower, uR]),
			known:      value.known.create(resultKnownPositions),
			summary:    value.summary.bottom(),
			attributes: value.attributes,
			type:       value.type
		});
		vectorLogger.trace(`Result [length=${result.length.toString()}]`);
		return result;
	}
}

/**
 * Applies logical indexing update: `x[c] \<- v` where c is a logical vector.
 * Values are assigned to positions where the selector is TRUE.
 * Uses cyclic recycling when selector is shorter than the source.
 * Paper Section 4.8.3 (logical update semantics).
 *
 * **Preconditions (expected by dispatcher):**
 * - `value`, `selector`, `values` are not Bottom (dispatcher ensures this)
 * - `selector` type is logical (contains TRUE/FALSE/NA values)
 * - `value.known` is not Bottom - defensive check inside
 *
 * **Structural Invariants:**
 * - Selector length `\> 1` cannot contain NA (sanity check: filter to first element if violated)
 * - After adjustForZeros, logical selector has zeros removed
 * - Cyclic recycling: values are repeated cyclically to match selector length
 * - Positions with TRUE selector: updated with cyclic values
 * - Positions with FALSE/NA selector: weakly updated (joined with cyclic values)
 *
 * **Postconditions:**
 * - Result length: [sourceLower, max(sourceUpper, selectorUpper)] for finite selectors
 * - Result length: [sourceLower, +∞] for infinite selectors
 * - Result summary: ⊥ for finite selectors, squash(values) for infinite
 * - Known positions: updated via cyclic recycling, with weak update for non-TRUE positions
 * @param value - The target VectorDomain to update
 * @param selector - The logical selector VectorDomain (contains TRUE/FALSE/NA)
 * @param values - The values to assign (cyclically recycled)
 * @param naValue - The NA value for out-of-bounds positions
 * @returns The resulting VectorDomain after logical update
 */
export function applyUpdateLogical<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	selector: VectorDomain<IntervalDomain>,
	values: VectorDomain<Domain>,
	naValue: NAAwareDomain<Domain>
): VectorDomain<Domain> {
	vectorLogger.debug('Operation: updateLogical');
	// Dispatcher already checked value/selector/values not Bottom
	// Keep defensive check for value.known.isBottom() as it's not covered by dispatcher
	if(value.known.isBottom()) {
		vectorLogger.trace('Subcase: updateLogical - value.known is bottom');
		return value.bottom();
	}

	let sourceLower = 0, sourceUpper = 0;
	if(value.length.isValue()) {
		sourceLower = value.length.value[0];
		sourceUpper = value.length.value[1];
	}
	let selectorUpper = 0;
	if(selector.length.isValue()) {
		selectorUpper = selector.length.value[1];
	}

	// Sanity check: selector length > 1 <-> no NA
	if(squash(selector).containsNA() && selectorUpper > 1) {
		vectorLogger.debug('Selectors longer than 1 cannot contain NA');
		// Filter selector: keep only the first element, set length to [1, 1]
		const rawSelectorKnownPositions = selector.known.isValue() ? selector.known.value : [];
		const filteredSelectorKnownPositions = rawSelectorKnownPositions.length > 0 ? [rawSelectorKnownPositions[0]] : [];
		selector = selector.create({
			length:     selector.length.create([1, 1]),
			known:      selector.known.create(filteredSelectorKnownPositions),
			summary:    selector.summary,
			attributes: selector.attributes,
			type:       selector.type
		});

		selectorUpper = 1;
	}

	selector = adjustForZeros(selector);

	const isInfinite = selectorUpper === +Infinity;
	if(isInfinite) {
		vectorLogger.trace('Subcase: updateLogical - infinite selector');
	} else {
		vectorLogger.trace('Subcase: updateLogical - finite selector');
	}

	const sourceKnownPositions = value.known.toArray();
	const selectorKnownPositions = selector.known.toArray();
	const maxLen = Math.max(sourceKnownPositions.length, selectorKnownPositions.length);
	const resultKnownPositions: NAAwareDomain<Domain>[] = [];
	for(let i = 0; i < maxLen; i++) {
		if(i < sourceKnownPositions.length) {
			resultKnownPositions.push(sourceKnownPositions[i]);
		} else if(i < sourceUpper) {
			resultKnownPositions.push(value.summary);
		} else {
			resultKnownPositions.push(naValue);
		}
	}
	const vLower = values.length.isValue() ? values.length.value[0] : 1;
	const rhoFResult = rhoF(values.known, vLower, selectorUpper, values.factory);
	const cyclicValues = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];
	for(let i = 0; i < maxLen && i < cyclicValues.length; i++) {
		let selectorVal: NAAwareDomain<IntervalDomain>;
		if(i < selectorKnownPositions.length) {
			selectorVal = selectorKnownPositions[i];
		} else if(i < selectorKnownPositions.length + (selector.summary.isValue() ? 1 : 0)) {
			selectorVal = selector.summary;
		} else {
			selectorVal = selector.summary.top();
		}
		if(selectorVal.isValue()) {
			resultKnownPositions[i] = cyclicValues[i % cyclicValues.length];
		} else {
			resultKnownPositions[i] = resultKnownPositions[i].join(cyclicValues[i % cyclicValues.length]);
		}
	}
	const resultUpper = isInfinite ? +Infinity : Math.max(sourceUpper, selectorUpper);
	const resultSummary = isInfinite ? squash(values) : value.summary.bottom();
	const result = value.create({
		length:     value.length.create([sourceLower, resultUpper]),
		known:      value.known.create(resultKnownPositions),
		summary:    resultSummary,
		attributes: value.attributes,
		type:       value.type
	});
	return result;
}
