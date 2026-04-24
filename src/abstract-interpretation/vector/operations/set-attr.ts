import type { AnyAbstractDomain } from '../../domains/abstract-domain';
import type { ArithmeticDomain } from '../../domains/arithmetic-domain';
import type { VectorDomain } from '../vector-domain';
import type { VectorAttrDomain } from '../../domains/vector-attr-domain';
import { vectorLogger } from '../logger';

/**
 * Applies the setAttr operation to set vector attributes.
 * Preserves vector values and updates the attributes field.
 * @param value - The current VectorDomain value
 * @param attrs - The vector attribute domain to set
 * @returns The resulting VectorDomain with updated attributes
 */
export function applySetAttr<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	value: VectorDomain<Domain>,
	attrs: VectorAttrDomain
): VectorDomain<Domain> {
	vectorLogger.debug('Operation: setAttr');
	// Preserve vector values and update attributes
	// This deviates from the paper spec which returns top for non-empty attrs,
	// but is needed for practical attribute tracking
	const result = value.create({
		length:     value.length,
		known:      value.known,
		summary:    value.summary,
		attributes: attrs,
		type:       value.type
	});
	return result;
}
