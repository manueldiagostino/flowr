import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { VectorAttrDomain, type VectorAttr } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { intervalFactory } from './interval-factory';

export type { VectorAttr };

/**
 * Helper to create a VectorDomain for testing with IntervalDomain values.
 * Uses VectorDomain.fromValues() which accepts raw domain values array.
 * @param length - Tuple of [min, max] for vector length
 * @param values - Array of [min, max] intervals for known initial positions
 * @param summary - Optional [min, max] interval for summary (defaults to Bottom)
 * @param attributes - Optional must/may attribute sets (defaults to Top)
 * @returns A VectorDomain<IntervalDomain> instance
 */
export const mkVector = (
	length: [number, number],
	values: [number, number][],
	summary?: [number, number],
	attributes?: { must: VectorAttr[]; may: VectorAttr[] }
): VectorDomain<IntervalDomain> => {
	const len = new PosIntervalDomain(length);
	const vals = values.map(([l, u]) => new IntervalDomain([l, u]));
	const sum = summary === undefined ? IntervalDomain.bottom() : new IntervalDomain(summary);
	const attrs = attributes
		? VectorAttrDomain.from(attributes.must, attributes.may)
		: VectorAttrDomain.top();

	return VectorDomain.fromValues(intervalFactory, len, vals, sum, attrs);
};
