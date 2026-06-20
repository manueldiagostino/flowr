/**
 * Factory utilities for creating NAAwareDomain instances with standardized factory functions.
 * @module abstract-interpretation/vector/factory-utils
 */
import type {
	AnyAbstractDomain,
} from '../domains/abstract-domain';
import { NAAwareDomain } from './na-aware-domain';
import type { DomainFactory } from './known-initial-positions-domain';

/**
 *
 */
export function wrapInNAAware<Inner extends AnyAbstractDomain>(
	inner: Inner,
	hasNA: boolean,
	_factory: DomainFactory<Inner>,
): NAAwareDomain<Inner> {
	return new NAAwareDomain<Inner>(
		{ inner, hasNA },
		_factory,
	);
}
