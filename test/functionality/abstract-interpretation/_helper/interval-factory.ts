import type { AnyAbstractDomain } from '../../../../src/abstract-interpretation/domains/abstract-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Bottom, NA, Top } from '../../../../src/abstract-interpretation/domains/lattice';
import type { DomainFactory } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';

/**
 * Unified interval factory for tests.
 */
export const intervalFactory: DomainFactory<IntervalDomain> = domainFactory(IntervalDomain.top());

/**
 * Factory generator for NA-aware domains, based on a given domain factory.
 */
export function naAwareFactory<Domain extends AnyAbstractDomain>(factory: DomainFactory<Domain>): DomainFactory<NAAwareDomain<Domain>> {
	return domainFactory(NAAwareDomain.top(factory));
}

/**
 * Factory generator for any abstract domain.
 * @param domain - The abstract domain to create the factory for.
 * @returns A factory function that maps concrete values and lattice elements to abstract values in the given domain.
 */
export function domainFactory<Domain extends AnyAbstractDomain>(domain: Domain): DomainFactory<Domain> {
	return concrete => {
		if(concrete === Top) {
			return domain.top();
		} else if(concrete === Bottom || concrete === NA || concrete === undefined) {
			return domain.bottom();
		}
		return domain.abstract(concrete);
	};
}
