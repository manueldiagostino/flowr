import type { AnyAbstractDomain } from '../domains/abstract-domain';
import type { ArithmeticDomain } from '../domains/arithmetic-domain';
import type { NAAwareDomain } from './na-aware-domain';

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

	let resultInner = a.inner.add(b.inner);
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

	let resultInner = a.inner.subtract(b.inner);
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

	let resultInner = a.inner.multiply(b.inner);
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

	let resultInner = a.inner.divide(b.inner);
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
