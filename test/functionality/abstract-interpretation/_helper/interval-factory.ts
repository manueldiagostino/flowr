import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Bottom, Top, NA } from '../../../../src/abstract-interpretation/domains/lattice';
import type { DomainFactory } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';

/**
 * Unified interval factory for tests.
 * Handles all lattice elements and concrete values:
 * - Top → IntervalDomain.top()
 * - Bottom → IntervalDomain.bottom()
 * - NA → IntervalDomain.bottom() (NA has no numeric value)
 * - undefined → IntervalDomain.bottom() (treated as missing/NA)
 * - Set<number> → IntervalDomain.abstract(concrete)
 */
export const intervalFactory: DomainFactory<IntervalDomain> = (concrete) => {
	if(concrete === Top) {
		return IntervalDomain.top();
	}
	if(concrete === Bottom) {
		return IntervalDomain.bottom();
	}
	if(concrete === NA || concrete === undefined) {
		return IntervalDomain.bottom();
	}
	return IntervalDomain.abstract(concrete);
};
