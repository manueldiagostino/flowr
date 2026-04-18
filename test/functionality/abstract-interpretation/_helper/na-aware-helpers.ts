/* eslint-disable tsdoc/syntax */
import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { NAAwareDomain, type NAAwareInnerValue } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { IntervalDomain, type IntervalLift } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain, type DomainFactory } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { RVectorTypeDomain } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import { Top, NA } from '../../../../src/abstract-interpretation/domains/lattice';

/**
 * Type alias for NAAwareDomain wrapping IntervalDomain.
 * Using NAAwareInnerValue ensures proper type inference across operations.
 */
export type NAAwareInterval = NAAwareDomain<IntervalDomain<IntervalLift>, NAAwareInnerValue<IntervalDomain<IntervalLift>>>;

/**
 * Factory function to create a properly-typed NAAwareDomain wrapping an IntervalDomain.
 * This avoids TypeScript's overly-specific type inference when using 'new' directly.
 * @param range - The interval range [min, max]
 * @param hasNA - Whether this abstract value contains NA
 * @returns A properly-typed NAAwareInterval instance
 */
export function createNAAwareInterval(
	range: [number, number],
	hasNA: boolean
): NAAwareInterval {
	return new NAAwareDomain(
		{ inner: new IntervalDomain(range), hasNA },
		intervalFactory
	) as NAAwareInterval;
}

/**
 * Factory function to create a properly-typed NAAwareDomain from an existing IntervalDomain.
 * Use this when you have an IntervalDomain created via IntervalDomain.abstract() or other means.
 * @param inner - The already-created IntervalDomain
 * @param hasNA - Whether this abstract value contains NA
 * @returns A properly-typed NAAwareInterval instance
 */
export function wrapIntervalWithNA(
	inner: IntervalDomain<IntervalLift>,
	hasNA: boolean
): NAAwareInterval {
	return new NAAwareDomain({ inner, hasNA }, intervalFactory) as NAAwareInterval;
}

/**
 * Interval factory for NAAwareDomain tests.
 * Handles Top, NA/undefined/Bottom → Bottom, and concrete Sets.
 */
export const intervalFactory: DomainFactory<IntervalDomain> = (concrete) => {
	if(concrete === Top) {
		return IntervalDomain.top();
	}
	if(concrete === NA || !(concrete instanceof Set)) {
		return IntervalDomain.bottom();
	}
	return IntervalDomain.abstract(concrete);
};

/**
 * Factory for NAAwareDomain<IntervalDomain> that handles NA values.
 */
export const naAwareIntervalFactory: DomainFactory<NAAwareDomain<IntervalDomain>> =
	NAAwareDomain.createSmartFactory(intervalFactory);

/**
 * Helper to create a VectorDomain with NAAwareDomain values.
 * With the new architecture, VectorDomain<IntervalDomain> automatically has
 * NAAwareDomain<IntervalDomain> in its values field.
 */
export function createNAAwareVector(
	length: [number, number],
	values: Array<{ range: [number, number]; hasNA: boolean }>,
	summary?: { range: [number, number]; hasNA: boolean }
): VectorDomain<IntervalDomain> {
	const len = new PosIntervalDomain(length);
	// Values are automatically wrapped in NAAwareDomain by the VectorDomain type
	const vals = new KnownInitialPositionsDomain(
		values.map(v => new NAAwareDomain(
			{ inner: new IntervalDomain(v.range), hasNA: v.hasNA },
			intervalFactory
		)),
		naAwareIntervalFactory
	);

	// Summary is NAAwareDomain<IntervalDomain>
	const sumInner = summary === undefined
		? IntervalDomain.bottom()
		: new IntervalDomain(summary.range);
	const sum = new NAAwareDomain({ inner: sumInner, hasNA: summary?.hasNA ?? false }, intervalFactory);

	return new VectorDomain({
		length:     len,
		known:      vals,
		summary:    sum,
		attributes: VectorAttrDomain.top(),
		type:       RVectorTypeDomain.top()
	}, intervalFactory);
}

/**
 * Create a pure NA vector (all positions are NA).
 */
export function createPureNAVector(length: [number, number]): VectorDomain<IntervalDomain> {
	return createNAAwareVector(
		length,
		[{ range: [0, 0], hasNA: true }],
		{ range: [0, 0], hasNA: true }
	);
}

/**
 * Assertion helper to check if a vector contains NA values.
 * Supports both VectorDomain<IntervalDomain> (where values are NAAwareDomain wrapped internally)
 * and VectorDomain<NAAwareDomain<IntervalDomain>> (explicit NA-aware domain).
 */
export function assertContainsNA(
	vector: VectorDomain<IntervalDomain> | VectorDomain<NAAwareDomain<IntervalDomain>> | undefined,
	expected: boolean,
	message?: string
): void {
	if(vector === undefined) {
		throw new Error('Expected a VectorDomain result but got undefined');
	}

	let containsNA = false;
	if(vector.known.isValue()) {
		const values = vector.known.value;
		for(const val of values) {
			const naVal = val as NAAwareDomain<IntervalDomain>;
			if(naVal.containsNA()) {
				containsNA = true;
				break;
			}
		}
	}

	if(!containsNA && !vector.summary.isBottom()) {
		const summary = vector.summary as NAAwareDomain<IntervalDomain>;
		containsNA = summary.containsNA();
	}

	if(containsNA !== expected) {
		throw new Error(message ?? `Expected vector to ${expected ? '' : 'not '}contain NA`);
	}
}
