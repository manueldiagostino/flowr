import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain, type VectorAttr } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { intervalFactory } from './interval-factory';
import { naAwareIntervalFactory } from './na-aware-helpers';

export type { VectorAttr };

/**
 * Factory for creating VectorDomain with NAAwareDomain<IntervalDomain> values.
 */
export const mkVectorFactory: import('../../../../src/abstract-interpretation/vector/known-initial-positions-domain').DomainFactory<NAAwareDomain<IntervalDomain>> = (concrete) => {
	const { Top, NA, Bottom } = require('../../../../src/abstract-interpretation/domains/lattice');
	const { intervalFactory } = require('./interval-factory');
	const { NAAwareDomain } = require('../../../../src/abstract-interpretation/vector/na-aware-domain');

	if(concrete === Top) {
		return NAAwareDomain.top(intervalFactory);
	}
	if(concrete === Bottom) {
		return NAAwareDomain.bottom(intervalFactory);
	}
	if(concrete === undefined) {
		return new NAAwareDomain({ inner: intervalFactory(Top), hasNA: true }, intervalFactory);
	}
	if(!(concrete instanceof Set)) {
		return NAAwareDomain.bottom(intervalFactory);
	}

	let hasNA = false;
	const concreteValues = new Set<number>();

	for(const v of concrete) {
		if(v === NA) {
			hasNA = true;
		} else {
			concreteValues.add(v as number);
		}
	}

	const inner = intervalFactory(concreteValues.size > 0 ? concreteValues : Top);
	return new NAAwareDomain({ inner, hasNA }, intervalFactory);
};

/**
 * Helper to create a VectorDomain for testing with NAAwareDomain<IntervalDomain> values.
 *
 * @param length - Tuple of [min, max] for vector length
 * @param values - Array of [min, max] intervals for known initial positions
 * @param summary - Optional [min, max] interval for summary (defaults to Bottom)
 * @param attributes - Optional must/may attribute sets (defaults to Top)
 * @returns A VectorDomain instance with NAAwareDomain values
 */
export const mkVector = (
	length: [number, number],
	values: [number, number][],
	summary?: [number, number],
	attributes?: { must: VectorAttr[]; may: VectorAttr[] }
): VectorDomain<NAAwareDomain<IntervalDomain>> => {
	const len = new PosIntervalDomain(length);
	const vals = new KnownInitialPositionsDomain(
		values.map(([l, u]) => new NAAwareDomain({ inner: new IntervalDomain([l, u]), hasNA: false }, intervalFactory)),
		mkVectorFactory
	);
	const sumDomain = summary === undefined ? IntervalDomain.bottom() : new IntervalDomain(summary);
	const sum = new NAAwareDomain({ inner: sumDomain, hasNA: false }, intervalFactory);
	const attrs = attributes
		? VectorAttrDomain.from(attributes.must, attributes.may)
		: VectorAttrDomain.top();
	return new VectorDomain({ length: len, values: vals, summary: sum, attributes: attrs }, mkVectorFactory);
};

/**
 * Helper to create a VectorDomain for testing with NAAwareDomain<IntervalDomain> values.
 *
 * @param length - Tuple of [min, max] for vector length
 * @param values - Array of [min, max] intervals for known initial positions
 * @param summary - Optional [min, max] interval for summary (defaults to Bottom)
 * @param attributes - Optional must/may attribute sets (defaults to Top)
 * @returns A VectorDomain instance with NAAwareDomain values
 */
export const mkNAAwareVector = (
	length: [number, number],
	values: [number, number][],
	summary?: [number, number],
	attributes?: { must: VectorAttr[]; may: VectorAttr[] }
): VectorDomain<NAAwareDomain<IntervalDomain>> => {
	const len = new PosIntervalDomain(length);
	const vals = new KnownInitialPositionsDomain(
		values.map(([l, u]) => new NAAwareDomain({ inner: new IntervalDomain([l, u]), hasNA: false }, intervalFactory)),
		naAwareIntervalFactory
	);
	// Summary must be NAAwareDomain<Domain> where Domain = NAAwareDomain<IntervalDomain>
	// So we need double-wrapped: NAAwareDomain<NAAwareDomain<IntervalDomain>>
	const innerSumDomain = summary === undefined ? IntervalDomain.bottom() : new IntervalDomain(summary);
	const innerNAAware = new NAAwareDomain({ inner: innerSumDomain, hasNA: false }, intervalFactory);
	const sum = new NAAwareDomain({ inner: innerNAAware, hasNA: false }, naAwareIntervalFactory);
	const attrs = attributes
		? VectorAttrDomain.from(attributes.must, attributes.may)
		: VectorAttrDomain.top();
	return new VectorDomain({ length: len, values: vals, summary: sum, attributes: attrs }, naAwareIntervalFactory);
};

/**
 * Re-export intervalFactory for convenience
 */
export { intervalFactory };
