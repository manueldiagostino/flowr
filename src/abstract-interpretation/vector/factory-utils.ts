/**
 * Factory utilities for creating NAAwareDomain instances with standardized factory functions.
 * @module abstract-interpretation/vector/factory-utils
 */
import type {
	AnyAbstractDomain,
	ConcreteDomain,
} from '../domains/abstract-domain';
import type { Top, NA } from '../domains/lattice';
import { IntervalDomain } from '../domains/interval-domain';
import { NAAwareDomain } from './na-aware-domain';
import type { DomainFactory } from './known-initial-positions-domain';

export type NAAwareDomainFactory<InnerDomain extends AnyAbstractDomain> = (
	concrete: ReadonlySet<ConcreteDomain<InnerDomain>> | typeof Top | typeof NA,
) => NAAwareDomain<InnerDomain>;

/**
 * Creates a factory for producing NAAwareDomain instances wrapping IntervalDomain.
 * Uses the smart factory method to properly handle NA values, undefined, and sets.
 */
export function createIntervalNAAwareFactory(): NAAwareDomainFactory<IntervalDomain> {
	return NAAwareDomain.createSmartFactory(IntervalDomain.abstract);
}

/**
 *
 */
export function wrapInNAAware<Inner extends AnyAbstractDomain>(
	inner: Inner,
	hasNA: boolean,
	_factory: NAAwareDomainFactory<Inner>,
): NAAwareDomain<Inner> {
	return new NAAwareDomain<Inner>(
		{ inner, hasNA },
		_factory as unknown as DomainFactory<Inner>,
	);
}
