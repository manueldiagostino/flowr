import type { AnyAbstractDomain } from '../../domains/abstract-domain';
import type { ArithmeticDomain } from '../../domains/arithmetic-domain';
import type { VectorDomain } from '../vector-domain';
import type { NAAwareDomain } from '../na-aware-domain';
import { vectorLogger } from '../logger';
import { squash, rhoF } from '../vector-semantics';
import {
	naAwareAdd,
	naAwareSubtract,
	naAwareMultiply,
	naAwareDivide,
	naAwareNegate
} from '../na-aware-arithmetic';

/**
 * Recycles a pair of vectors to the same length for binary operations.
 * Per paper Section 4.5: aligns two vectors by extending shorter one cyclically.
 * @param v1 - The first vector
 * @param v2 - The second vector
 * @returns A tuple [v1_recycled, v2_recycled] with aligned lengths
 */
export function applyRecycle<Domain extends AnyAbstractDomain & ArithmeticDomain<Domain>>(
	v1: VectorDomain<Domain>,
	v2: VectorDomain<Domain>
): [VectorDomain<Domain>, VectorDomain<Domain>] {
	vectorLogger.debug('Operation: applyRecycle');

	// Handle bottom cases
	if(v1.isBottom() || v2.isBottom()) {
		vectorLogger.debug('Operation: applyRecycle - one operand is bottom');
		return [v1.bottom(), v2.bottom()];
	}

	// Get length bounds
	const len1 = v1.length;
	const len2 = v2.length;
	const known1 = v1.known;
	const known2 = v2.known;

	if(!len1.isValue() || !len2.isValue() || !known1.length || !known2.length) {
		vectorLogger.debug('Operation: applyRecycle - lengths not values, returning top');
		return [v1.top(), v2.top()];
	}

	const [l1, u1] = len1.value;
	const [l2, u2] = len2.value;
	const uPrime = Math.max(u1, u2);
	const lPrime = Math.max(l1, l2);
	const knownMaxLength = Math.max(known1.length, known2.length);

	vectorLogger.debug(`Operation: applyRecycle computed [l1=${l1}, u1=${u1}, l2=${l2}, u2=${u2}, lPrime=${lPrime}, uPrime=${uPrime}]`);


	// Check incompatibility
	const incompatible = u1 !== +Infinity && u2 !== +Infinity && (u1 % u2 !== 0) && (u2 % u1 !== 0);
	if(incompatible) {
		vectorLogger.warn('Operation: applyRecycle - incompatible lengths');
		// return [v1.top(), v2.top()];
	}

	// Recycle v1
	let v1Recycled = v1;

	let rhoFResult = rhoF(v1.known, l1, lPrime, v1.naAwareFactory);
	for(let d = lPrime; d < knownMaxLength; d++) {
		rhoFResult = rhoFResult.join(rhoF(v1.known, l1, d, v1.naAwareFactory));
	}
	let cycledKnown = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];
	let newSummary = v1.summary;

	vectorLogger.debug(`Operation: applyRecycle - recycling v1 from ${u1} to ${uPrime}`);
	if(uPrime === +Infinity) {
		// Infinite target: fold known into summary
		const squashedKnown = squash(v1);
		newSummary = v1.summary.join(squashedKnown);
	}

	v1Recycled = v1.create({
		length:     v1.length.create([lPrime, uPrime]),
		known:      v1.known.create(cycledKnown),
		summary:    newSummary,
		attributes: v1.attributes,
		type:       v1.type
	});


	// Recycle v2
	let v2Recycled = v2;

	rhoFResult = rhoF(v2.known, l2, lPrime, v2.naAwareFactory);
	for(let d = lPrime; d < knownMaxLength; d++) {
		rhoFResult = rhoFResult.join(rhoF(v2.known, l2, d, v2.naAwareFactory));
	}
	cycledKnown = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];
	newSummary = v2.summary;

	vectorLogger.debug(`Operation: applyRecycle - recycling v2 from ${u1} to ${uPrime}`);
	if(uPrime === +Infinity) {
		// Infinite target: fold known into summary
		const squashedKnown = squash(v2);
		newSummary = v2.summary.join(squashedKnown);
	}

	v2Recycled = v2.create({
		length:     v2.length.create([lPrime, uPrime]),
		known:      v2.known.create(cycledKnown),
		summary:    newSummary,
		attributes: v2.attributes,
		type:       v2.type
	});


	vectorLogger.debug(`Operation: applyRecycle result [v1=${v1Recycled.length.toString()}, v2=${v2Recycled.length.toString()}]`);
	return [v1Recycled, v2Recycled];
}

/**
 * Applies a binary operation to two vectors with proper recycling and type coercion.
 * Uses actual interval arithmetic instead of join-based over-approximation.
 * @param v1 - The first vector operand
 * @param v2 - The second vector operand (undefined for unary operations)
 * @param operator - The operator string: '+', '-', '*', '/'
 * @returns The resulting VectorDomain after the binary operation
 */
export function applyBinaryOp<D extends AnyAbstractDomain & ArithmeticDomain<D>>(
	v1: VectorDomain<D>,
	v2: VectorDomain<D> | undefined,
	operator: string
): VectorDomain<D> {
	vectorLogger.debug(`Operation: binaryOp [operator=${operator}]`);

	if(v2 === undefined) {
		vectorLogger.debug('Operation: binaryOp - no second operand, returning v1');
		return v1;
	}

	// Recycle the pair to aligned lengths
	const [v1Recycled, v2Recycled] = applyRecycle(v1, v2);

	// Select the appropriate NA-aware arithmetic function
	const arithmeticFn = selectArithmeticFn<D>(operator);

	// Apply element-wise arithmetic on known positions
	const resultKnown = applyElementWiseArithmetic(
		v1Recycled, v2Recycled, arithmeticFn
	);

	// Apply the same operation to summaries
	const resultSummary = arithmeticFn(v1Recycled.summary, v2Recycled.summary);

	// Result type is the join of both types
	const resultType = v1Recycled.type.join(v2Recycled.type);

	const result = v1Recycled.create({
		length:     v1Recycled.length,
		known:      resultKnown,
		summary:    resultSummary,
		attributes: v1Recycled.attributes.join(v2Recycled.attributes),
		type:       resultType
	});

	vectorLogger.debug(`Operation: binaryOp result [length=${result.length.toString()}, known=${result.known.toString()}, type=${result.type.toString()}]`);
	return result;
}

/**
 * Selects the appropriate NA-aware arithmetic function based on the operator string.
 */
function selectArithmeticFn<D extends AnyAbstractDomain & ArithmeticDomain<D>>(
	operator: string
): (a: NAAwareDomain<D>, b: NAAwareDomain<D>) => NAAwareDomain<D> {
	switch(operator) {
		case '+': return naAwareAdd;
		case '-': return naAwareSubtract;
		case '*': return naAwareMultiply;
		case '/': return naAwareDivide;
		default:
			vectorLogger.warn(`Unknown binary operator '${operator}', falling back to join`);
			// Fallback: use join-based approach (preserves old behavior for unknown operators)
			return (a, b) => a.join(b);
	}
}

/**
 * Applies element-wise arithmetic to the known positions of two recycled vectors.
 */
function applyElementWiseArithmetic<D extends AnyAbstractDomain & ArithmeticDomain<D>>(
	v1: VectorDomain<D>,
	v2: VectorDomain<D>,
	arithmeticFn: (a: NAAwareDomain<D>, b: NAAwareDomain<D>) => NAAwareDomain<D>
): typeof v1.known {
	if(v1.known.isBottom() || v2.known.isBottom()) {
		return v1.known.bottom();
	}
	if(v1.known.isTop() || v2.known.isTop()) {
		return v1.known.top();
	}
	if(!v1.known.isValue() || !v2.known.isValue()) {
		return v1.known.top();
	}

	const values1 = v1.known.value as readonly NAAwareDomain<D>[];
	const values2 = v2.known.value as readonly NAAwareDomain<D>[];

	// After recycling, both vectors should have the same number of known positions
	const resultValues: NAAwareDomain<D>[] = [];
	const len = Math.min(values1.length, values2.length);
	for(let i = 0; i < len; i++) {
		resultValues.push(arithmeticFn(values1[i], values2[i]));
	}

	return v1.known.create(resultValues);
}

/**
 * Applies the negate operation to a vector.
 * Negates each known position and the summary, preserving length/attributes/type.
 * @param value - The VectorDomain to negate
 * @returns The resulting VectorDomain after negation
 */
export function applyNegate<D extends AnyAbstractDomain & ArithmeticDomain<D>>(
	value: VectorDomain<D>
): VectorDomain<D> {
	vectorLogger.debug('Operation: negate');

	if(value.isBottom()) {
		vectorLogger.debug('Operation: negate returning bottom');
		return value.bottom();
	}
	if(value.isTop()) {
		vectorLogger.debug('Operation: negate returning top');
		return value.top();
	}

	// Negate known positions using naAwareNegate
	let negatedKnown: typeof value.known;
	if(value.known.isBottom()) {
		negatedKnown = value.known.bottom();
	} else if(value.known.isTop()) {
		negatedKnown = value.known.top();
	} else if(value.known.isValue()) {
		const values = value.known.value as readonly NAAwareDomain<D>[];
		const negatedValues = values.map(v => naAwareNegate(v));
		negatedKnown = value.known.create(negatedValues);
	} else {
		negatedKnown = value.known.top();
	}

	// Negate summary using naAwareNegate
	let negatedSummary: typeof value.summary;
	if(value.summary.isBottom()) {
		negatedSummary = value.summary.bottom();
	} else if(value.summary.isTop()) {
		negatedSummary = value.summary.top();
	} else {
		negatedSummary = naAwareNegate(value.summary);
	}

	const result = value.create({
		length:     value.length,
		known:      negatedKnown,
		summary:    negatedSummary,
		attributes: value.attributes,
		type:       value.type
	});

	vectorLogger.debug(`Operation: negate result [length=${result.length.toString()}, values=${result.known.toString()}]`);
	return result;
}
