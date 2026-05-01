import type { AnyAbstractDomain } from '../../domains/abstract-domain';
import type { ArithmeticDomain } from '../../domains/arithmetic-domain';
import type { VectorDomain } from '../vector-domain';
import type { NAAwareDomain } from '../na-aware-domain';
import { vectorLogger } from '../logger';
import { squash, squashedExcept } from '../vector-semantics';

/**
 * Applies the abstract concatenation operator ⊕♯ (paper Section 4, Expressions).
 *
 * Combines two abstract vectors with two cases depending on whether the first
 * vector's upper length bound is finite or infinite.
 *
 * **Case 1: u₁ ≠ +∞ (finite first argument)**
 * - Length:  [l₁ + l₂, u₁ + u₂]
 * - Known:   known₁ ⊕ known₂, then backward propagation over window d = u₁ - l₁ + 1
 * - Summary: s₂
 *
 * **Case 2: u₁ = +∞ (infinite first argument)**
 * - Length:  [l₁ + l₂, +∞]
 * - Known:   truncate known₁ to first l₁ elements
 * - Summary: s₁ ⊔ SquashExcept(ν₁, [1,l₁]) ⊔ Squash(ν₂)
 *
 * Both cases: attributes = a₁ ⊔ a₂, type = t₁ ⊔ t₂
 * @param value - The first VectorDomain operand (ν₁)
 * @param other - The second VectorDomain operand (ν₂), undefined for single-element concatenations
 * @returns The resulting VectorDomain after abstract concatenation
 */
export function applyConcatenate<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	other: VectorDomain<Domain> | undefined
): VectorDomain<Domain> {
	vectorLogger.debug(`Operation: concatenate [hasOther=${other !== undefined}]`);
	if(other === undefined) {
		vectorLogger.debug(`Operation: concatenate no other operand, returning value [length=${value.length.toString()}]`);
		return value;
	}

	const len1 = value.length;
	const len2 = other.length;
	vectorLogger.debug(`Operation: concatenate lengths [len1=${len1.toString()}, len2=${len2.toString()}]`);

	if(len1.isBottom() || len2.isBottom()) {
		vectorLogger.debug('Operation: concatenate returning bottom');
		return value.bottom();
	}
	if(len1.isTop() || len2.isTop()) {
		vectorLogger.debug('Operation: concatenate returning top');
		return value.top();
	}
	if(!len1.isValue() || !len2.isValue()) {
		vectorLogger.debug('Operation: concatenate returning top (not value)');
		return value.top();
	}
	const [l1, u1] = len1.value;
	const [l2, u2] = len2.value;
	const newLower = l1 + l2;

	vectorLogger.debug(`Operation: concatenate [l1=${l1}, u1=${u1}, l2=${l2}, u2=${u2}, newLower=${newLower}]`);

	// ── Case 2: u₁ = +∞ (infinite first argument) ──
	if(u1 === +Infinity) {
		vectorLogger.debug('Operation: concatenate case 2 (infinite u1)');

		const concatenatedLength = len1.create([newLower, +Infinity]);

		// Known: truncate known₁ to first l₁ elements
		let concatenatedKnown: typeof value.known;
		if(value.known.isValue()) {
			const values1 = value.known.value as readonly NAAwareDomain<Domain>[];
			const truncated = values1.slice(0, l1);
			concatenatedKnown = value.known.create(truncated);
			vectorLogger.debug(`Operation: concatenate case 2 truncating known1 from ${values1.length} to ${truncated.length}`);
		} else if(value.known.isBottom()) {
			concatenatedKnown = value.known.bottom();
		} else {
			concatenatedKnown = value.known.top();
		}

		// Summary: s₁ ⊔ SquashExcept(ν₁, [1, l₁]) ⊔ Squash(ν₂)
		const exceptSet = new Set<number>();
		for(let i = 1; i <= l1; i++) {
			exceptSet.add(i);
		}
		const squashedExcept1 = squashedExcept(value, exceptSet);
		const squashed2 = squash(other);
		const concatenatedSummary = value.summary
			.join(squashedExcept1)
			.join(squashed2);
		vectorLogger.debug(`Operation: concatenate case 2 summary [s1=${value.summary.toString()}, squashedExcept=${squashedExcept1.toString()}, squash2=${squashed2.toString()}, result=${concatenatedSummary.toString()}]`);

		const result = value.create({
			length:     concatenatedLength,
			known:      concatenatedKnown,
			summary:    concatenatedSummary,
			attributes: value.attributes.join(other.attributes),
			type:       value.type.join(other.type)
		});
		vectorLogger.debug(`Operation: concatenate case 2 result [length=${result.length.toString()}, known=${result.known.toString()}]`);
		return result;
	}

	// ── Case 1: u₁ ≠ +∞ (finite first argument) ──
	vectorLogger.debug('Operation: concatenate case 1 (finite u1)');

	const newUpper = u1 + u2;
	const concatenatedLength = len1.create([newLower, newUpper]);

	let concatenatedKnown: typeof value.known;

	// Empty first vector: result is just ν₂
	if(l1 === 0 && u1 === 0) {
		concatenatedKnown = other.known;
		vectorLogger.debug('Operation: concatenate using other.known (len1 is empty)');
	} else if(l2 === 0 && u2 === 0) {
		// Empty second vector: result is just ν₁ (with joined attributes/type)
		concatenatedKnown = value.known;
		vectorLogger.debug('Operation: concatenate using value.known (len2 is empty)');
	} else if(value.known.isBottom() || other.known.isBottom()) {
		// Bottom/top known: propagate
		concatenatedKnown = value.known.bottom();
		vectorLogger.debug('Operation: concatenate known values bottom');
	} else if(value.known.isTop() || other.known.isTop()) {
		concatenatedKnown = value.known.top();
		vectorLogger.debug('Operation: concatenate known values top');
	} else if(value.known.isValue() && other.known.isValue()) {
		// Both known values: pure concatenation + backward propagation
		const values1 = value.known.value as readonly NAAwareDomain<Domain>[];
		const values2 = other.known.value as readonly NAAwareDomain<Domain>[];
		const certain1 = l1 === u1;
		const certain2 = l2 === u2;
		vectorLogger.debug(`Operation: concatenate values [values1.length=${values1.length}, values2.length=${values2.length}, certain1=${certain1}, certain2=${certain2}]`);

		// Pure concatenation of known sequences
		const result: NAAwareDomain<Domain>[] = [...values1, ...values2];

		// Backward propagation: for each known₂ position i, join with preceding d positions
		// Paper: ∀i ∈ [u₁+1, u₁+k₂], ∀j ∈ [1, d]: p'_{i-j} ← p'_{i-j} ⊔ p'_i
		// where d = u₁ - l₁ + 1 and k₂ = |known₂|
		const d = u1 - l1 + 1;
		const k2 = values2.length;

		if(d > 0 && k2 > 0 && !(certain1 && certain2)) {
			const known2Start = values1.length; // 0-indexed start of known₂ in result

			for(let k2Idx = 0; k2Idx < k2; k2Idx++) {
				const i0 = known2Start + k2Idx; // 0-indexed position of known₂ element

				for(let j = 1; j <= d; j++) {
					const target = i0 - j;
					if(target >= 0 && target < result.length) {
						vectorLogger.trace(`Operation: concatenate back-prop: result[${target}] ⊔ result[${i0}]`);
						result[target] = result[target].join(result[i0]);
					}
				}
			}
			vectorLogger.debug(`Operation: concatenate backward propagation [d=${d}, k2=${k2}, known2Start=${known2Start}]`);
		} else if(certain1 && certain2) {
			vectorLogger.debug('Operation: concatenate both certain, skipping backward propagation');
		}

		concatenatedKnown = value.known.create(result);
	} else {
		concatenatedKnown = value.known.top();
		vectorLogger.debug('Operation: concatenate known values top (fallback)');
	}

	// Summary: s₂ (per paper, the summary of the second vector)
	const concatenatedSummary = other.summary;

	const result = value.create({
		length:     concatenatedLength,
		known:      concatenatedKnown,
		summary:    concatenatedSummary,
		attributes: value.attributes.join(other.attributes),
		type:       value.type.join(other.type)
	});
	vectorLogger.debug(`Operation: concatenate case 1 result [length=${result.length.toString()}, known=${result.known.toString()}, summary=${concatenatedSummary.toString()}]`);
	return result;
}
