import type { AnyAbstractDomain } from '../../domains/abstract-domain';
import type { ArithmeticDomain } from '../../domains/arithmetic-domain';
import type { VectorDomain } from '../vector-domain';
import type { VectorAttrDomain } from '../../domains/vector-attr-domain';
import { vectorLogger } from '../logger';

/**
 * Applies the setAttr operation to set vector attributes.
 * Returns top if attributes are non-empty (unsupported for analysis).
 * @param value - The current VectorDomain value
 * @param attrs - The vector attribute domain to set
 * @returns The resulting VectorDomain with updated attributes
 */
export function applySetAttr<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	attrs: VectorAttrDomain
): VectorDomain<Domain> {
	vectorLogger.debug('Operation: setAttr');
	if(!attrs.isEmpty()) {
		return value.top();
	}
	const result = value.create({
		length:     value.length,
		known:      value.known,
		summary:    value.summary,
		attributes: attrs,
		type:       value.type
	});
	return result;
}
