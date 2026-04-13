import { VectorDomain } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { NAAwareDomain, type NAAwareInnerValue } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { IntervalDomain, type IntervalLift } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { PosIntervalDomain } from '../../../../src/abstract-interpretation/domains/positive-interval-domain';
import { KnownInitialPositionsDomain, type DomainFactory } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { VectorAttrDomain } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
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
export const naAwareIntervalFactory: DomainFactory<NAAwareDomain<IntervalDomain>> = (concrete) => {
	if(concrete === Top) {
		return NAAwareDomain.top(intervalFactory);
	}

	let hasNA = false;
	const concreteValues = new Set<number>();

	if(concrete === undefined) {
		hasNA = true;
	} else if(concrete instanceof Set) {
		hasNA = concrete.has(NA as unknown as number);
		for(const v of concrete) {
			if(v !== NA) {
				concreteValues.add(v as number);
			}
		}
	}

	const inner = intervalFactory(concreteValues.size > 0 ? concreteValues : Top);
	return new NAAwareDomain({ inner, hasNA }, intervalFactory);
};

/**
 * Helper to create a VectorDomain with NAAwareDomain values.
 */
export function createNAAwareVector(
	length: [number, number],
	values: Array<{ range: [number, number]; hasNA: boolean }>,
	summary?: { range: [number, number]; hasNA: boolean }
): VectorDomain<NAAwareDomain<IntervalDomain>> {
	const len = new PosIntervalDomain(length);
	const vals = new KnownInitialPositionsDomain(
		values.map(v => new NAAwareDomain(
			{ inner: new IntervalDomain(v.range), hasNA: v.hasNA },
			intervalFactory
		)),
		naAwareIntervalFactory
	);

	// The summary field is NAAwareDomain<Domain> where Domain = NAAwareDomain<IntervalDomain>
	// So we need NAAwareDomain<NAAwareDomain<IntervalDomain>>
	const innerSummary = summary === undefined
		? NAAwareDomain.bottom(intervalFactory)
		: new NAAwareDomain(
			{ inner: new IntervalDomain(summary.range), hasNA: summary.hasNA },
			intervalFactory
		);
	// Wrap in outer NAAwareDomain for the summary field
	const sum = new NAAwareDomain({ inner: innerSummary, hasNA: false }, naAwareIntervalFactory);

	return new VectorDomain({
		length:     len,
		values:     vals,
		summary:    sum,
		attributes: VectorAttrDomain.top()
	}, naAwareIntervalFactory);
}

/**
 * Create a pure NA vector (all positions are NA).
 */
export function createPureNAVector(length: [number, number]): VectorDomain<NAAwareDomain<IntervalDomain>> {
	return createNAAwareVector(
		length,
		[{ range: [0, 0], hasNA: true }],
		{ range: [0, 0], hasNA: true }
	);
}

/**
 * Assertion helper to check if a vector contains NA values.
 */
export function assertContainsNA(
	vector: VectorDomain<NAAwareDomain<IntervalDomain>> | undefined,
	expected: boolean,
	message?: string
): void {
	if(vector === undefined) {
		throw new Error('Expected a VectorDomain result but got undefined');
	}

	let containsNA = false;
	if(vector.values.isValue()) {
		const values = vector.values.value as readonly NAAwareDomain<IntervalDomain>[];
		for(const val of values) {
			if(val.containsNA()) {
				containsNA = true;
				break;
			}
		}
	}

	if(!containsNA && !vector.summary.isBottom() && vector.summary.isValue()) {
		// The summary is NAAwareDomain<Domain> where Domain = NAAwareDomain<IntervalDomain>
		// So summary.value is NAAwareDomain<IntervalDomain> which has containsNA()
		const summary = vector.summary.value as unknown as NAAwareDomain<IntervalDomain>;
		if(typeof summary.containsNA === 'function') {
			containsNA = summary.containsNA();
		}
	}

	if(containsNA !== expected) {
		throw new Error(message ?? `Expected vector to ${expected ? '' : 'not '}contain NA`);
	}
}
