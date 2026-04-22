import type { AnyAbstractDomain } from '../../domains/abstract-domain';
import type { VectorDomain } from '../vector-domain';
import type { NAAwareDomain } from '../na-aware-domain';
import { vectorLogger } from '../logger';
import { squash, rhoF } from '../vector-semantics';

/**
 * Applies the recycle operation to align two vectors to the same length for binary operations.
 * Combines length intervals and value domains of both operands.
 * @param value - The first VectorDomain operand
 * @param other - The second VectorDomain operand to recycle against
 * @returns The resulting VectorDomain after recycling
 */
export function applyRecycle<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>,
	other: VectorDomain<Domain>
): VectorDomain<Domain> {
	vectorLogger.debug('Operation: recycle');
	const len1 = value.length;
	const len2 = other.length;
	vectorLogger.debug(`Operation: recycle lengths [len1=${len1.toString()}, len2=${len2.toString()}]`);

	if(len1.isBottom() || len2.isBottom()) {
		vectorLogger.debug('Operation: recycle returning bottom');
		return value.bottom();
	}
	const combinedSummary = value.summary.join(other.summary);
	if(len1.isTop() || len2.isTop()) {
		vectorLogger.debug('Operation: recycle returning top (length is top)');
		const result = value.create({
			length:     len1.top(),
			known:      value.known.top(),
			summary:    combinedSummary,
			attributes: value.attributes.join(other.attributes),
			type:       value.type
		});
		return result;
	}
	if(!len1.isValue() || !len2.isValue()) {
		vectorLogger.debug('Operation: recycle returning top (not value)');
		const result = value.create({
			length:     len1.top(),
			known:      value.known.top(),
			summary:    combinedSummary,
			attributes: value.attributes.join(other.attributes),
			type:       value.type
		});
		return result;
	}
	const [l1, u1] = len1.value;
	const [l2, u2] = len2.value;
	const newUpper = Math.max(u1, u2);
	const newLower = Math.max(l1, l2);
	const incompatible = u1 !== +Infinity && u2 !== +Infinity && (u1 % u2 !== 0) && (u2 % u1 !== 0);
	vectorLogger.debug(`Operation: recycle computed [l1=${l1}, u1=${u1}, l2=${l2}, u2=${u2}, newLower=${newLower}, newUpper=${newUpper}, incompatible=${incompatible}]`);

	if(incompatible) {
		vectorLogger.debug('Operation: recycle incompatible lengths, returning top');
		const result = value.create({
			length:     len1.top(),
			known:      value.known.top(),
			summary:    combinedSummary,
			attributes: value.attributes.join(other.attributes),
			type:       value.type
		});
		return result;
	}
	const recycledLength = len1.create([newLower, newUpper]);
	const combinedValues = value.known.join(other.known);
	const result = value.create({
		length:     recycledLength,
		known:      combinedValues,
		summary:    combinedSummary,
		attributes: value.attributes.join(other.attributes),
		type:       value.type
	});
	vectorLogger.debug(`Operation: recycle result [length=${result.length.toString()}, values=${result.known.toString()}]`);
	return result;
}

/**
 * Recycles a pair of vectors to the same length for binary operations.
 * Per paper Section 4.5: aligns two vectors by extending shorter one cyclically.
 * @param v1 - The first vector
 * @param v2 - The second vector
 * @returns A tuple [v1_recycled, v2_recycled] with aligned lengths
 */
export function recyclePair<Domain extends AnyAbstractDomain>(
	v1: VectorDomain<Domain>,
	v2: VectorDomain<Domain>
): [VectorDomain<Domain>, VectorDomain<Domain>] {
	vectorLogger.debug('Operation: recyclePair');

	// Handle bottom cases
	if(v1.isBottom() || v2.isBottom()) {
		vectorLogger.debug('Operation: recyclePair - one operand is bottom');
		return [v1.bottom(), v2.bottom()];
	}

	// Get length bounds
	const len1 = v1.length;
	const len2 = v2.length;
	const known1 = v1.known;
	const known2 = v2.known;

	if(!len1.isValue() || !len2.isValue() || !known1.length || !known2.length) {
		vectorLogger.debug('Operation: recyclePair - lengths not values, returning top');
		return [v1.top(), v2.top()];
	}

	const [l1, u1] = len1.value;
	const [l2, u2] = len2.value;
	const uPrime = Math.max(u1, u2);
	const lPrime = Math.max(l1, l2);
	const knownMaxLength = Math.max(known1.length, known2.length);

	vectorLogger.debug(`Operation: recyclePair computed [l1=${l1}, u1=${u1}, l2=${l2}, u2=${u2}, lPrime=${lPrime}, uPrime=${uPrime}]`);


	// Check incompatibility (same as applyRecycle)
	const incompatible = u1 !== +Infinity && u2 !== +Infinity && (u1 % u2 !== 0) && (u2 % u1 !== 0);
	if(incompatible) {
		vectorLogger.warn('Operation: recyclePair - incompatible lengths');
		// return [v1.top(), v2.top()];
	}

	// Recycle v1
	let v1Recycled = v1;

	let rhoFResult = rhoF(v1.known, l1, lPrime, v1.naAwareFactory);
	for(let d = l1; d < knownMaxLength; d++) {
		rhoFResult = rhoFResult.join(rhoF(v1.known, l1, d, v1.naAwareFactory));
	}
	let cycledKnown = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];
	let newSummary = v1.summary;

	vectorLogger.debug(`Operation: recyclePair - recycling v1 from ${u1} to ${uPrime}`);
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

	rhoFResult = rhoF(v2.known, l1, lPrime, v2.naAwareFactory);
	for(let d = l1; d < knownMaxLength; d++) {
		rhoFResult = rhoFResult.join(rhoF(v2.known, l1, d, v2.naAwareFactory));
	}
	cycledKnown = rhoFResult.isValue() ? (rhoFResult.value as NAAwareDomain<Domain>[]) : [];
	newSummary = v2.summary;

	vectorLogger.debug(`Operation: recyclePair - recycling v2 from ${u1} to ${uPrime}`);
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


	vectorLogger.debug(`Operation: recyclePair result [v1=${v1Recycled.length.toString()}, v2=${v2Recycled.length.toString()}]`);
	return [v1Recycled, v2Recycled];
}

/**
 * Applies a binary operation to two vectors with proper recycling and type coercion.
 * @param v1 - The first vector operand
 * @param v2 - The second vector operand
 * @param operator - The operator string (e.g., '+', '-', '*', '/')
 * @returns The resulting VectorDomain after the binary operation
 */
export function applyBinaryOp<Domain extends AnyAbstractDomain>(
	v1: VectorDomain<Domain>,
	v2: VectorDomain<Domain> | undefined,
	operator: string
): VectorDomain<Domain> {
	vectorLogger.debug(`Operation: binaryOp [operator=${operator}]`);

	if(v2 === undefined) {
		vectorLogger.debug('Operation: binaryOp - no second operand, returning v1');
		return v1;
	}

	// Recycle the pair to aligned lengths
	const [v1Recycled, v2Recycled] = recyclePair(v1, v2);

	// Perform element-wise join on prefixes and summaries
	const resultKnown = v1Recycled.known.join(v2Recycled.known);
	const resultSummary = v1Recycled.summary.join(v2Recycled.summary);

	// Perform type coercion: result type is the join of both types
	const resultType = v1Recycled.type.join(v2Recycled.type);

	const result = v1Recycled.create({
		length:     v1Recycled.length,
		known:      resultKnown,
		summary:    resultSummary,
		attributes: v1Recycled.attributes.join(v2Recycled.attributes),
		type:       resultType
	});

	vectorLogger.debug(`Operation: binaryOp result [length=${result.length.toString()}, type=${result.type.toString()}]`);
	return result;
}

/**
 * Applies the negate operation to a vector.
 * Negates each known position and the summary, preserving length/attributes/type.
 * @param value - The VectorDomain to negate
 * @returns The resulting VectorDomain after negation
 */
export function applyNegate<Domain extends AnyAbstractDomain>(
	value: VectorDomain<Domain>
): VectorDomain<Domain> {
	vectorLogger.debug('Operation: negate');

	if(value.isBottom()) {
		vectorLogger.debug('Operation: negate returning bottom');
		return value.bottom();
	}
	if(value.isTop()) {
		vectorLogger.debug('Operation: negate returning top');
		return value.top();
	}

	// Negate known positions
	let negatedKnown: typeof value.known;
	if(value.known.isBottom()) {
		negatedKnown = value.known.bottom();
	} else if(value.known.isTop()) {
		negatedKnown = value.known.top();
	} else if(value.known.isValue()) {
		const values = value.known.value as readonly NAAwareDomain<Domain>[];
		const negatedValues = values.map(v => v.negate());
		negatedKnown = value.known.create(negatedValues);
	} else {
		negatedKnown = value.known.top();
	}

	// Negate summary
	let negatedSummary: typeof value.summary;
	if(value.summary.isBottom()) {
		negatedSummary = value.summary.bottom();
	} else if(value.summary.isTop()) {
		negatedSummary = value.summary.top();
	} else {
		negatedSummary = value.summary.negate();
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
