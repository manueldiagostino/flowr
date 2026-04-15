import { describe, test, assert } from 'vitest';
import './log-config';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Top, Bottom, NA } from '../../../../src/abstract-interpretation/domains/lattice';
import { intervalFactory, createNAAwareInterval, wrapIntervalWithNA } from '../_helper/na-aware-helpers';

describe('NAAwareDomain', () => {
	describe('Basic Lattice Elements', () => {
		test('top() creates top element', () => {
			const top = NAAwareDomain.top(intervalFactory);
			assert.strictEqual(top.isTop(), true);
			assert.strictEqual(top.isBottom(), false);
			assert.strictEqual(top.isNA(), false);
			assert.strictEqual(top.containsNA(), true);
		});

		test('bottom() creates bottom element', () => {
			const bottom = NAAwareDomain.bottom(intervalFactory);
			assert.strictEqual(bottom.isTop(), false);
			assert.strictEqual(bottom.isBottom(), true);
			assert.strictEqual(bottom.isNA(), false);
			assert.strictEqual(bottom.containsNA(), false);
		});

		test('na() creates pure NA element', () => {
			const na = NAAwareDomain.na(intervalFactory);
			assert.strictEqual(na.isTop(), false);
			assert.strictEqual(na.isBottom(), false);
			assert.strictEqual(na.isNA(), true);
			assert.strictEqual(na.containsNA(), true);
		});
	});

	describe('NA Detection', () => {
		test('isNA() returns true only for pure NA', () => {
			const na = NAAwareDomain.na(intervalFactory);
			const top = NAAwareDomain.top(intervalFactory);
			const bottom = NAAwareDomain.bottom(intervalFactory);
			const pureValue = createNAAwareInterval([1, 10], false);
			const valueWithNA = createNAAwareInterval([1, 10], true);

			assert.strictEqual(na.isNA(), true);
			assert.strictEqual(top.isNA(), false);
			assert.strictEqual(bottom.isNA(), false);
			assert.strictEqual(pureValue.isNA(), false);
			assert.strictEqual(valueWithNA.isNA(), false);
		});

		test('containsNA() returns true for NA and values with NA flag', () => {
			const na = NAAwareDomain.na(intervalFactory);
			const top = NAAwareDomain.top(intervalFactory);
			const bottom = NAAwareDomain.bottom(intervalFactory);
			const pureValue = createNAAwareInterval([1, 10], false);
			const valueWithNA = createNAAwareInterval([1, 10], true);

			assert.strictEqual(na.containsNA(), true);
			assert.strictEqual(top.containsNA(), true);
			assert.strictEqual(bottom.containsNA(), false);
			assert.strictEqual(pureValue.containsNA(), false);
			assert.strictEqual(valueWithNA.containsNA(), true);
		});
	});

	describe('Join with NA', () => {
		test('pureValue.join(pureNA) results in value with hasNA=true', () => {
			const pureValue = createNAAwareInterval([1, 10], false);
			const pureNA = NAAwareDomain.na(intervalFactory);

			const joined = pureValue.join(pureNA);

			assert.strictEqual(joined.isNA(), false);
			assert.strictEqual(joined.containsNA(), true);
			assert.strictEqual(joined.isTop(), false);
		});

		test('valueWithNA.join(pureNA) remains value with NA', () => {
			const valueWithNA = createNAAwareInterval([1, 10], true);
			const pureNA = NAAwareDomain.na(intervalFactory);

			const joined = valueWithNA.join(pureNA);

			assert.strictEqual(joined.isNA(), false);
			assert.strictEqual(joined.containsNA(), true);
		});

		test('pureNA.join(pureNA) results in pureNA', () => {
			const pureNA1 = NAAwareDomain.na(intervalFactory);
			const pureNA2 = NAAwareDomain.na(intervalFactory);

			const joined = pureNA1.join(pureNA2);

			assert.strictEqual(joined.isNA(), true);
			assert.strictEqual(joined.containsNA(), true);
		});

		test('topWithoutNA.join(pureNA) results in NAAwareDomain.Top', () => {
			const topItv = createNAAwareInterval(IntervalDomain.top().value as [number, number], false);
			const pureNA = NAAwareDomain.na(intervalFactory);

			const joined = topItv.join(pureNA);

			assert.strictEqual(joined.isTop(), true);
			assert.strictEqual(joined.containsNA(), true);
		});


		test('join preserves inner domain values', () => {
			const pureValue = createNAAwareInterval([5, 15], false);
			const pureNA = NAAwareDomain.na(intervalFactory);

			const joined = pureValue.join(pureNA);
			const inner = joined.inner;

			assert.notStrictEqual(inner, undefined);
			assert.strictEqual(inner?.isValue(), true);
		});
	});

	describe('Meet with NA', () => {
		test('pureValue.meet(pureNA) results in Bottom (no common values)', () => {
			const pureValue = createNAAwareInterval([1, 10], false);
			const pureNA = NAAwareDomain.na(intervalFactory);

			const met = pureValue.meet(pureNA);

			// Meet of concrete values with pure NA (no concrete values) = Bottom
			// The inner domain should be Bottom and hasNA should be false (false && true = false)
			assert.strictEqual(met.isBottom(), true, `Expected Bottom but got: ${met.toString()}`);
			assert.strictEqual(met.containsNA(), false);
		});

		test('meet of values both containing NA keeps NA flag', () => {
			const value1 = createNAAwareInterval([1, 10], true);
			const value2 = createNAAwareInterval([5, 15], true);

			const met = value1.meet(value2);

			assert.strictEqual(met.containsNA(), true);
		});

		test('meet of value with NA and value without NA loses NA flag', () => {
			const withNA = createNAAwareInterval([1, 10], true);
			const withoutNA = createNAAwareInterval([5, 15], false);

			const met = withNA.meet(withoutNA);

			assert.strictEqual(met.containsNA(), false);
		});
	});

	describe('Concretize', () => {
		test('concretize of pure NA returns Set([NA])', () => {
			const pureNA = NAAwareDomain.na(intervalFactory);
			const concretized = pureNA.concretize(10);

			assert.notStrictEqual(concretized, Top);
			assert.ok(concretized instanceof Set);
			assert.strictEqual((concretized as Set<unknown>).has(NA), true);
			assert.strictEqual((concretized as Set<unknown>).size, 1);
		});

		test('concretize of value with NA returns inner values + NA', () => {
			const valueWithNA = createNAAwareInterval([1, 5], true);
			const concretized = valueWithNA.concretize(10);

			assert.notStrictEqual(concretized, Top);
			assert.ok(concretized instanceof Set);
			assert.strictEqual((concretized as Set<unknown>).has(NA), true);
		});

		test('concretize of value without NA returns only inner values', () => {
			const interval = IntervalDomain.abstract(new Set<number>([1, 2, 3]));
			const pureValue = wrapIntervalWithNA(interval, false);
			const concretized = pureValue.concretize(10);

			assert.notStrictEqual(concretized, Top);
			assert.ok(concretized instanceof Set);
			assert.strictEqual((concretized as Set<unknown>).has(NA), false);
		});

		test('concretize of Top returns Top', () => {
			const top = NAAwareDomain.top(intervalFactory);
			const concretized = top.concretize(10);

			assert.strictEqual(concretized, Top);
		});

		test('concretize of Bottom returns empty set', () => {
			const bottom = NAAwareDomain.bottom(intervalFactory);
			const concretized = bottom.concretize(10);

			assert.notStrictEqual(concretized, Top);
			assert.ok(concretized instanceof Set);
			assert.strictEqual((concretized as Set<unknown>).size, 0);
		});
	});

	describe('Abstract', () => {
		test('abstract of Set([NA]) creates value with hasNA=true', () => {
			const domain = NAAwareDomain.top(intervalFactory);
			const result = domain.abstract(new Set([NA]));

			assert.strictEqual(result.containsNA(), true);
		});

		test('abstract of Set([1, 2, NA]) creates value with values and hasNA=true', () => {
			const domain = NAAwareDomain.top(intervalFactory);
			const result = domain.abstract(new Set([1, 2, NA] as (number | typeof NA)[]));

			assert.strictEqual(result.containsNA(), true);
			assert.strictEqual(result.isNA(), false);
		});

		test('abstract of Set([1, 2]) creates value with hasNA=false', () => {
			const domain = NAAwareDomain.top(intervalFactory);
			const result = domain.abstract(new Set([1, 2]));

			assert.strictEqual(result.containsNA(), false);
		});

		test('abstract of Top returns Top', () => {
			const domain = NAAwareDomain.top(intervalFactory);
			const result = domain.abstract(Top);

			assert.strictEqual(result.isTop(), true);
		});
	});

	describe('Equality and Ordering', () => {
		test('equals returns true for identical values', () => {
			const value1 = createNAAwareInterval([1, 10], true);
			const value2 = createNAAwareInterval([1, 10], true);

			assert.strictEqual(value1.equals(value2), true);
		});

		test('equals returns false for different hasNA flags', () => {
			const value1 = createNAAwareInterval([1, 10], true);
			const value2 = createNAAwareInterval([1, 10], false);

			assert.strictEqual(value1.equals(value2), false);
		});

		test('leq respects NA ordering', () => {
			const pureValue = createNAAwareInterval([1, 10], false);
			const withNA = createNAAwareInterval([1, 10], true);

			assert.strictEqual(pureValue.leq(withNA), true);
			assert.strictEqual(withNA.leq(pureValue), false);
		});
	});

	describe('toString', () => {
		test('pure NA returns "NA"', () => {
			const na = NAAwareDomain.na(intervalFactory);
			assert.strictEqual(na.toString(), 'NA');
		});

		test('value with NA returns inner + "+NA"', () => {
			const value = createNAAwareInterval([1, 10], true);
			assert.ok(value.toString().includes('+NA'));
		});

		test('value without NA returns just inner', () => {
			const value = createNAAwareInterval([1, 10], false);
			const str = value.toString();
			assert.ok(!str.includes('+NA'));
		});
	});

	describe('createSmartFactory', () => {
		const smartFactory = NAAwareDomain.createSmartFactory(intervalFactory);

		test('creates value with hasNA: false when no NA in set', () => {
			const result = smartFactory(new Set([1, 2, 3]));
			assert.strictEqual(result.containsNA(), false);
			assert.strictEqual(result.isNA(), false);
			assert.strictEqual(result.inner.toString(), '[1, 3]');
		});

		test('creates value with hasNA: true when NA in set', () => {
			const result = smartFactory(new Set([1, NA, 3]));
			assert.strictEqual(result.containsNA(), true);
			assert.strictEqual(result.isNA(), false);
			assert.strictEqual(result.inner.toString(), '[1, 3]');
		});

		test('creates pure NA when concrete is NA', () => {
			const result = smartFactory(NA);
			assert.strictEqual(result.isNA(), true);
			assert.strictEqual(result.containsNA(), true);
		});

		test('creates pure NA when concrete is undefined', () => {
			const result = smartFactory(undefined);
			assert.strictEqual(result.isNA(), true);
			assert.strictEqual(result.containsNA(), true);
		});

		test('creates bottom when empty set', () => {
			const result = smartFactory(new Set());
			assert.strictEqual(result.isBottom(), true);
			assert.strictEqual(result.containsNA(), false);
		});

		test('creates top when concrete is Top', () => {
			const result = smartFactory(Top);
			assert.strictEqual(result.isTop(), true);
			assert.strictEqual(result.containsNA(), true);
		});

		test('creates bottom when concrete is Bottom', () => {
			const result = smartFactory(Bottom);
			assert.strictEqual(result.isBottom(), true);
			assert.strictEqual(result.containsNA(), false);
		});

		test('factory produces consistent results with manual construction', () => {
			const smartResult = smartFactory(new Set([5, 10]));
			const manualResult = new NAAwareDomain(
				{ inner: new IntervalDomain([5, 10]), hasNA: false },
				intervalFactory
			);

			assert.strictEqual(smartResult.containsNA(), manualResult.containsNA());
			assert.strictEqual(smartResult.inner.toString(), manualResult.inner.toString());
		});
	});
});
