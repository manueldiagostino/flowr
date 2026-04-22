import { VectorDomain, type DomainFactory } from '../vector-domain';
import { NAAwareDomain } from '../na-aware-domain';
import { PosIntervalDomain } from '../../domains/positive-interval-domain';
import type { IntervalDomain } from '../../domains/interval-domain';
import { Bottom, Top } from '../../domains/lattice';

/**
 * Builds a PosIntervalDomain-typed selector vector from filtered positions.
 * Converts NAAwareDomain<IntervalDomain> positions (guaranteed to be in Z≥0 ∪ {NA}
 * for positive, or Z≤0 for negative) into NAAwareDomain<PosIntervalDomain>
 * by wrapping each inner IntervalDomain as a PosIntervalDomain.
 */
export function buildPosIntervalSelector(
	source: VectorDomain<IntervalDomain>,
	positions: readonly NAAwareDomain<IntervalDomain>[]
): VectorDomain<PosIntervalDomain> {
	if(positions.length === 0) {
		return source.bottom();
	}
	const posIntervalFactory: DomainFactory<PosIntervalDomain> = (c: unknown) => {
		if(c === undefined) {
			return PosIntervalDomain.bottom();
		}
		if(c === Bottom) {
			return PosIntervalDomain.bottom();
		}
		if(c === Top) {
			return PosIntervalDomain.top();
		}
		const values = [...(c as Set<number>)];
		return new PosIntervalDomain([Math.min(...values), Math.max(...values)]);
	};
	const naAwarePositions = positions.map(pos => {
		if(pos.isBottom()) {
			return NAAwareDomain.bottom(posIntervalFactory);
		}
		if(pos.isTop()) {
			return NAAwareDomain.top(posIntervalFactory);
		}
		if(pos.isNA()) {
			// Pure NA position - preserve as NA
			return NAAwareDomain.na(posIntervalFactory);
		}
		// Convert inner IntervalDomain to PosIntervalDomain
		// abstractFilter guarantees: lower ≥ 0 for positive, upper ≤ 0 for negative
		const innerInterval = pos.inner;
		if(!innerInterval.isValue()) {
			return NAAwareDomain.bottom(posIntervalFactory);
		}
		const [l, u] = innerInterval.value;
		// For positive intervals [l, u] where l ≥ 0: keep as is
		// For non-positive intervals [l, u] where u ≤ 0: negate to get positions to delete
		// In R, x[-2] means delete position 2, so [-2, -1] becomes [1, 2]
		// In R, x[-2:0] means delete positions 1 and 2, so [-2, 0] becomes [1, 2] (excluding 0)
		const [posL, posU] = u <= 0 && l < 0
			? [Math.max(1, Math.abs(u)), Math.abs(l)]  // Negate and exclude 0
			: [l, u];
		const posInner = new PosIntervalDomain([posL, posU]);
		return new NAAwareDomain({ inner: posInner, hasNA: pos.containsNA() }, posIntervalFactory);
	});
	const naAwareSummary = source.summary.isBottom()
		? NAAwareDomain.bottom(posIntervalFactory)
		: source.summary.isTop()
			? NAAwareDomain.top(posIntervalFactory)
			: source.summary.inner.isValue()
				? new NAAwareDomain(
					{ inner: new PosIntervalDomain(source.summary.inner.value), hasNA: source.summary.containsNA() },
					posIntervalFactory
				)
				: NAAwareDomain.bottom(posIntervalFactory);
	return VectorDomain.fromValues(
		posIntervalFactory,
		source.length,
		naAwarePositions,
		naAwareSummary,
		source.attributes,
		source.type
	);
}

/**
 * Builds an IntervalDomain-typed selector vector from filtered positions, preserving original values.
 * Unlike buildPosIntervalSelector, this does NOT negate negative intervals.
 * Used for update_neg where applyUpdateNegative expects negative IntervalDomain values
 * and performs its own negation to compute positions to delete.
 * @param source - The source selector VectorDomain<IntervalDomain>
 * @param positions - Filtered positions (guaranteed to be negative or zero by abstractFilter)
 * @returns A selector with preserved IntervalDomain values (not negated)
 */
export function buildIntervalSelector(
	source: VectorDomain<IntervalDomain>,
	positions: readonly NAAwareDomain<IntervalDomain>[]
): VectorDomain<IntervalDomain> {
	if(positions.length === 0) {
		return source.bottom();
	}
	const intervalFactory: DomainFactory<IntervalDomain> = source.plainFactory;
	const naAwarePositions = positions.map(pos => {
		if(pos.isBottom()) {
			return NAAwareDomain.bottom(intervalFactory);
		}
		if(pos.isTop()) {
			return NAAwareDomain.top(intervalFactory);
		}
		if(pos.isNA()) {
			// Pure NA position - preserve as NA
			return NAAwareDomain.na(intervalFactory);
		}
		// Preserve the original IntervalDomain value without negation
		// abstractFilter guarantees: upper ≤ 0 for negative positions
		const innerInterval = pos.inner;
		if(!innerInterval.isValue()) {
			return NAAwareDomain.bottom(intervalFactory);
		}
		// Keep the interval as-is (negative values)
		return new NAAwareDomain({ inner: innerInterval, hasNA: pos.containsNA() }, intervalFactory);
	});
	const naAwareSummary = source.summary.isBottom()
		? NAAwareDomain.bottom(intervalFactory)
		: source.summary.isTop()
			? NAAwareDomain.top(intervalFactory)
			: source.summary.inner.isValue()
				? new NAAwareDomain(
					{ inner: source.summary.inner, hasNA: source.summary.containsNA() },
					intervalFactory
				)
				: NAAwareDomain.bottom(intervalFactory);
	return VectorDomain.fromValues(
		intervalFactory,
		source.length,
		naAwarePositions,
		naAwareSummary,
		source.attributes,
		source.type
	);
}

/**
 * Converts an entire VectorDomain<IntervalDomain> selector to VectorDomain<PosIntervalDomain>
 * by converting all inner domains. Used as a conservative fallback when selector values
 * cannot be enumerated for abstract filtering.
 */
export function buildPosIntervalSelectorFromSource(
	source: VectorDomain<IntervalDomain>
): VectorDomain<PosIntervalDomain> {
	const posIntervalFactory: DomainFactory<PosIntervalDomain> = (c: unknown) => {
		if(c === undefined) {
			return PosIntervalDomain.bottom();
		}
		if(c === Bottom) {
			return PosIntervalDomain.bottom();
		}
		if(c === Top) {
			return PosIntervalDomain.top();
		}
		const values = [...(c as Set<number>)];
		return new PosIntervalDomain([Math.min(...values), Math.max(...values)]);
	};
	const convertNAAware = (naAware: NAAwareDomain<IntervalDomain>): NAAwareDomain<PosIntervalDomain> => {
		if(naAware.isBottom()) {
			return NAAwareDomain.bottom(posIntervalFactory);
		}
		if(naAware.isTop()) {
			return NAAwareDomain.top(posIntervalFactory);
		}
		const posInner = new PosIntervalDomain(naAware.inner.value);
		return new NAAwareDomain({ inner: posInner, hasNA: naAware.containsNA() }, posIntervalFactory);
	};
	let positions: readonly NAAwareDomain<PosIntervalDomain>[];
	if(source.known.isValue() && Array.isArray(source.known.value)) {
		positions = (source.known.value as readonly NAAwareDomain<IntervalDomain>[]).map(convertNAAware);
	} else {
		positions = [];
	}
	const summary = convertNAAware(source.summary);
	return VectorDomain.fromValues(
		posIntervalFactory,
		source.length,
		positions,
		summary,
		source.attributes,
		source.type
	);
}
