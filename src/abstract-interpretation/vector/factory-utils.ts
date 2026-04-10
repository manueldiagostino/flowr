/**
 * Factory utilities for creating NAAwareDomain instances with standardized factory functions.
 * @module abstract-interpretation/vector/factory-utils
 */
import type {
	AnyAbstractDomain,
	ConcreteDomain,
} from '../domains/abstract-domain';
import { Top, NA } from '../domains/lattice';
import { IntervalDomain } from '../domains/interval-domain';
import { NAAwareDomain } from './na-aware-domain';
import type { DomainFactory } from './known-initial-positions-domain';

export type NAAwareDomainFactory<InnerDomain extends AnyAbstractDomain> = (
	concrete: ReadonlySet<ConcreteDomain<InnerDomain>> | typeof Top | typeof NA,
) => NAAwareDomain<InnerDomain>;

export function createIntervalNAAwareFactory(): NAAwareDomainFactory<IntervalDomain> {
	const innerFactory = (
		concrete: ReadonlySet<number> | typeof Top,
	): IntervalDomain => {
		return IntervalDomain.abstract(concrete);
	};

	const factory: NAAwareDomainFactory<IntervalDomain> = (
		concrete: ReadonlySet<number> | typeof Top | typeof NA,
	): NAAwareDomain<IntervalDomain> => {
		if(concrete === NA) {
			return NAAwareDomain.na<IntervalDomain>(innerFactory as DomainFactory<IntervalDomain>);
		}

		if(concrete === Top) {
			return new NAAwareDomain<IntervalDomain>(
				{ inner: IntervalDomain.top(), hasNA: true },
				innerFactory as DomainFactory<IntervalDomain>,
			);
		}

		if(concrete.size === 0) {
			return new NAAwareDomain<IntervalDomain>(
				{ inner: IntervalDomain.bottom(), hasNA: false },
				innerFactory as DomainFactory<IntervalDomain>,
			);
		}

		const numbers = Array.from(concrete);
		const min = Math.min(...numbers);
		const max = Math.max(...numbers);
		return new NAAwareDomain<IntervalDomain>(
			{ inner: new IntervalDomain([min, max]), hasNA: false },
			innerFactory as DomainFactory<IntervalDomain>,
		);
	};

	return factory;
}

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
