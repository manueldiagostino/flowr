import { assert, describe, test } from 'vitest';
import { propagate } from '../../../../src/abstract-interpretation/vector/vector-semantics';
import { IntervalDomain, IntervalTop } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Bottom } from '../../../../src/abstract-interpretation/domains/lattice';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { intervalFactory } from '../_helper/interval-factory';
import { asNaAware, asNaAwares, NaInterval, asNaAwareWithNA, asNaAwareWithNAs, type AbstractNaValue } from '../_helper/vector-evaluation-helpers';
import './log-config';

/** Converts an AbstractNaValue<IntervalDomain> to a real NAAwareDomain<IntervalDomain>. */
function toNAAware({ inner, hasNA }: AbstractNaValue<IntervalDomain>): NAAwareDomain<IntervalDomain> {
	let domainValue: IntervalDomain;
	if(inner === IntervalTop) {
		domainValue = IntervalDomain.top();
	} else if(inner === Bottom) {
		domainValue = IntervalDomain.bottom();
	} else {
		domainValue = new IntervalDomain(inner);
	}
	return new NAAwareDomain({ inner: domainValue, hasNA }, intervalFactory);
}

/** Converts a list of AbstractNaValue<IntervalDomain> to real NAAwareDomain<IntervalDomain> instances. */
function toNAAwares(values: readonly AbstractNaValue<IntervalDomain>[]): NAAwareDomain<IntervalDomain>[] {
	return values.map(toNAAware);
}

/** Asserts that a NAAwareDomain<IntervalDomain> equals the expected AbstractNaValue<IntervalDomain>. */
function assertNAAwareEquals(
	actual: NAAwareDomain<IntervalDomain>,
	expected: AbstractNaValue<IntervalDomain>,
	message?: string
): void {
	const expectedDomain = toNAAware(expected);
	assert.ok(actual.equals(expectedDomain), message ?? `Expected ${expectedDomain.toString()} but got ${actual.toString()}`);
}

describe('propagate', () => {
	test('propagate with empty positions returns summary', () => {
		const summary = toNAAware(asNaAware([10, 10]));
		const result = propagate([], summary, 0);
		assertNAAwareEquals(result, asNaAware([10, 10]));
	});

	test('propagate with definite zero increments counter and skips', () => {
		const positions = toNAAwares(asNaAwares([0, 0], [5, 5]));
		const summary = toNAAware(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		// First is zero (skipped), k becomes 1
		// propagate([5,5], summary, 1): first [5,5] non-zero, k=1 ≤ 1 → return [5,5]
		// Result: [5,5]
		assertNAAwareEquals(result, asNaAware([5, 5]));
	});

	test('propagate with possible zero joins first with propagated rest', () => {
		const positions = toNAAwares(asNaAwares([-1, 1], [5, 5]));
		const summary = toNAAware(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		// [-1,1] contains 0 but not exactly {0}
		// Result: [-1,1] ⊔ propagate([5,5], [10,10], 0)
		// propagate([5,5], [10,10], 0): k=0, first [5,5] non-zero → returns [5,5]
		// Result: [-1,1] ⊔ [5,5] = [-1, 5]
		assertNAAwareEquals(result, asNaAware([-1, 5]));
	});

	test('propagate with possible zero joins first with propagated rest (NA version)', () => {
		const positions = toNAAwares([...asNaAwares([-1, 1]), asNaAwareWithNA([5, 5])]);
		const summary = toNAAware(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		// [-1,1] contains 0 but not exactly {0}
		// Result: [-1,1] ⊔ propagate([5,5], [10,10], 0)
		// propagate([5,5], [10,10], 0): k=0, first [5,5] non-zero → returns [5,5]
		// Result: [-1,1] ⊔ [5,5] = [-1, 5]
		assertNAAwareEquals(result, asNaAwareWithNA([-1, 5]));
	});

	test('pure NA considered as non-zero value', () => {
		const positions = toNAAwares(asNaAwares(NaInterval, [5, 7]));
		const summary = toNAAware(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		// [-1,1] contains 0 but not exactly {0}
		// Result: [-1,1] ⊔ propagate([5,5], [10,10], 0)
		// propagate([5,5], [10,10], 0): k=0, first [5,5] non-zero → returns [5,5]
		// Result: [-1,1] ⊔ [5,5] = [-1, 5]
		assertNAAwareEquals(result, NaInterval);
	});

	test('propagate non-zero with k>1 joins first with propagated rest (paper L411)', () => {
		const positions = toNAAwares(asNaAwares([3, 3], [5, 5]));
		const summary = toNAAware(asNaAware([10, 10]));
		// k=2: first [3,3] non-zero, k=2>1 → [3,3] ⊔ propagate([5,5], summary, 1)
		// propagate([5,5], summary, 1): first [5,5] non-zero, k=1 ≤ 1 → return [5,5]
		// Result: [3,3] ⊔ [5,5] = [3, 5]
		const result = propagate(positions, summary, 2);
		assertNAAwareEquals(result, asNaAware([3, 5]));
	});

	test('propagate non-zero with k=0 returns first value unchanged (paper L414)', () => {
		const positions = toNAAwares(asNaAwares([3, 3], [5, 5]));
		const summary = toNAAware(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		assertNAAwareEquals(result, asNaAware([3, 3]));
	});

	test('propagate possible zero with k>0 joins first with propagated rest', () => {
		const positions = toNAAwares(asNaAwares([0, 2], [5, 5]));
		const summary = toNAAware(asNaAware([10, 10]));
		const result = propagate(positions, summary, 1);
		// [0,2] may contain zero, so: [0,2] ⊔ propagate([5,5], [10,10], 1)
		// propagate([5,5], [10,10], 1): [5,5] non-zero, k=1 ≤ 1 → return [5,5]
		// Final: [0,2] ⊔ [5,5] = [0, 5]
		assertNAAwareEquals(result, asNaAware([0, 5]));
	});

	test('propagate with bottom position returns bottom', () => {
		const positions = [toNAAware(NaInterval)];
		const summary = toNAAware(asNaAware([10, 10]));
		const result = propagate(positions, summary, 0);
		assertNAAwareEquals(result, NaInterval);
	});
});
