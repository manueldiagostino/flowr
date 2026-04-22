import type { AnyAbstractDomain } from '../../domains/abstract-domain';
import type { VectorDomain } from '../vector-domain';
import type { NAAwareDomain } from '../na-aware-domain';
import { vectorLogger } from '../logger';

/**
 * Applies the concatenate operation to join two vectors.
 * Computes new length interval as sum of both lengths and combines value domains.
 * @param value - The first VectorDomain operand
 * @param other - The second VectorDomain operand (undefined for single-element concatenations)
 * @returns The resulting VectorDomain after concatenation
 */
export function applyConcatenate<Domain extends AnyAbstractDomain>(
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
	const newUpper = u1 + u2;
	vectorLogger.debug(`Operation: concatenate computed [l1=${l1}, u1=${u1}, l2=${l2}, u2=${u2}, newLower=${newLower}, newUpper=${newUpper}]`);

	const concatenatedLength = len1.create([newLower, newUpper]);
	let concatenatedValues: typeof value.known;
	if(l1 === 0 && u1 === 0) {
		concatenatedValues = other.known;
		vectorLogger.debug('Operation: concatenate using other.known (len1 is 0)');
	} else if(l2 === 0 && u2 === 0) {
		concatenatedValues = value.known;
		vectorLogger.debug('Operation: concatenate using value.known (len2 is 0)');
	} else if(value.known.isBottom() || other.known.isBottom()) {
		concatenatedValues = value.known.bottom();
		vectorLogger.debug('Operation: concatenate values bottom');
	} else if(value.known.isTop() || other.known.isTop()) {
		concatenatedValues = value.known.top();
		vectorLogger.debug('Operation: concatenate values top');
	} else if(value.known.isValue() && other.known.isValue()) {
		const values1 = value.known.value as readonly NAAwareDomain<Domain>[];
		const values2 = other.known.value as readonly NAAwareDomain<Domain>[];
		const certain1 = l1 === u1;
		const certain2 = l2 === u2;
		vectorLogger.debug(`Operation: concatenate values [values1.length=${values1.length}, values2.length=${values2.length}, certain1=${certain1}, certain2=${certain2}]`);
		if(certain1 && certain2) {
			const concatenated = [...values1, ...values2];
			concatenatedValues = value.known.create(concatenated);
		} else {
			const result: NAAwareDomain<Domain>[] = [...values1, ...values2];
			for(let len_a = u1 - 1; len_a >= l1; len_a--) {
				const v2Start = len_a;
				for(let i = 0; i < values2.length; i++) {
					const pos = v2Start + i;
					if(pos < result.length) {
						result[pos] = result[pos].join(values2[i]);
					}
				}
			}
			concatenatedValues = value.known.create(result);
		}
	} else {
		concatenatedValues = value.known.top();
		vectorLogger.debug('Operation: concatenate values top (fallback)');
	}
	const combinedSummary = value.summary.join(other.summary);
	const result = value.create({
		length:     concatenatedLength,
		known:      concatenatedValues,
		summary:    combinedSummary,
		attributes: value.attributes.join(other.attributes),
		type:       value.type.join(other.type)
	});
	vectorLogger.debug(`Operation: concatenate result [length=${result.length.toString()}, values=${result.known.toString()}]`);
	return result;
}
