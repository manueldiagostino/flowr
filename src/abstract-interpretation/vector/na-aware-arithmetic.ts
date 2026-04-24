import type { AnyAbstractDomain } from '../domains/abstract-domain';
import type { ArithmeticDomain } from '../domains/arithmetic-domain';
import { NAAwareDomain } from './na-aware-domain';

/**
 * NA-aware addition: delegates to inner.add(), propagates NA flags.
 * When one operand contains NA, joins the arithmetic result with the other
 * operand's inner value to preserve concrete possibilities.
 */
export function naAwareAdd<D extends AnyAbstractDomain & ArithmeticDomain<D>>(
	a: NAAwareDomain<D>,
	b: NAAwareDomain<D>
): NAAwareDomain<D> {
	if(a.isBottom() || b.isBottom()) {
		return a.bottom();
	}
	if(a.isTop() || b.isTop()) {
		return a.top();
	}
	// If either operand is pure NA, the result is NA
	if(a.isNA()) {
		return NAAwareDomain.na(a.factory);
	}
	if(b.isNA()) {
		return NAAwareDomain.na(b.factory);
	}

	let resultInner = a.inner.add(b.inner);
	// Only join other operand's inner value if it contains NA (but is not pure NA)
	if(a.containsNA() && !b.inner.isBottom()) {
		resultInner = resultInner.join(b.inner);
	}
	if(b.containsNA() && !a.inner.isBottom()) {
		resultInner = resultInner.join(a.inner);
	}
	const resultHasNA = a.containsNA() || b.containsNA();

	return a.create({ inner: resultInner, hasNA: resultHasNA });
}

/**
 * NA-aware subtraction: delegates to inner.subtract(), propagates NA flags.
 * When one operand contains NA, joins the arithmetic result with the other
 * operand's inner value to preserve concrete possibilities.
 */
export function naAwareSubtract<D extends AnyAbstractDomain & ArithmeticDomain<D>>(
	a: NAAwareDomain<D>,
	b: NAAwareDomain<D>
): NAAwareDomain<D> {
	if(a.isBottom() || b.isBottom()) {
		return a.bottom();
	}
	if(a.isTop() || b.isTop()) {
		return a.top();
	}
	// If either operand is pure NA, the result is NA
	if(a.isNA()) {
		return NAAwareDomain.na(a.factory);
	}
	if(b.isNA()) {
		return NAAwareDomain.na(b.factory);
	}

	let resultInner = a.inner.subtract(b.inner);
	// Only join other operand's inner value if it contains NA (but is not pure NA)
	if(a.containsNA()) {
		resultInner = resultInner.join(b.inner);
	}
	if(b.containsNA()) {
		resultInner = resultInner.join(a.inner);
	}
	const resultHasNA = a.containsNA() || b.containsNA();

	return a.create({ inner: resultInner, hasNA: resultHasNA });
}

/**
 * NA-aware multiplication: delegates to inner.multiply(), propagates NA flags.
 * When one operand contains NA, joins the arithmetic result with the other
 * operand's inner value to preserve concrete possibilities.
 */
export function naAwareMultiply<D extends AnyAbstractDomain & ArithmeticDomain<D>>(
	a: NAAwareDomain<D>,
	b: NAAwareDomain<D>
): NAAwareDomain<D> {
	if(a.isBottom() || b.isBottom()) {
		return a.bottom();
	}
	if(a.isTop() || b.isTop()) {
		return a.top();
	}
	// If either operand is pure NA, the result is NA
	if(a.isNA()) {
		return NAAwareDomain.na(a.factory);
	}
	if(b.isNA()) {
		return NAAwareDomain.na(b.factory);
	}

	let resultInner = a.inner.multiply(b.inner);
	// Only join other operand's inner value if it contains NA (but is not pure NA)
	if(a.containsNA()) {
		resultInner = resultInner.join(b.inner);
	}
	if(b.containsNA()) {
		resultInner = resultInner.join(a.inner);
	}
	const resultHasNA = a.containsNA() || b.containsNA();

	return a.create({ inner: resultInner, hasNA: resultHasNA });
}

/**
 * NA-aware division: delegates to inner.divide(), propagates NA flags.
 * When one operand contains NA, joins the arithmetic result with the other
 * operand's inner value to preserve concrete possibilities.
 */
export function naAwareDivide<D extends AnyAbstractDomain & ArithmeticDomain<D>>(
	a: NAAwareDomain<D>,
	b: NAAwareDomain<D>
): NAAwareDomain<D> {
	if(a.isBottom() || b.isBottom()) {
		return a.bottom();
	}
	if(a.isTop() || b.isTop()) {
		return a.top();
	}
	// If either operand is pure NA, the result is NA
	if(a.isNA()) {
		return NAAwareDomain.na(a.factory);
	}
	if(b.isNA()) {
		return NAAwareDomain.na(b.factory);
	}

	let resultInner = a.inner.divide(b.inner);
	// Only join other operand's inner value if it contains NA (but is not pure NA)
	if(a.containsNA()) {
		resultInner = resultInner.join(b.inner);
	}
	if(b.containsNA()) {
		resultInner = resultInner.join(a.inner);
	}
	const resultHasNA = a.containsNA() || b.containsNA();

	return a.create({ inner: resultInner, hasNA: resultHasNA });
}

/**
 * NA-aware negation: delegates to inner.negate(), preserves NA flag.
 */
export function naAwareNegate<D extends AnyAbstractDomain & ArithmeticDomain<D>>(
	value: NAAwareDomain<D>
): NAAwareDomain<D> {
	if(value.isBottom()) {
		return value.bottom();
	}
	if(value.isTop()) {
		return value.top();
	}

	const resultInner = value.inner.negate();
	const resultHasNA = value.containsNA();

	return value.create({ inner: resultInner, hasNA: resultHasNA });
}
