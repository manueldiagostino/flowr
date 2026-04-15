import { assert, test, describe } from 'vitest';
import './log-config';
import { VectorAttrDomain, VectorAttrs, type VectorAttr, type VectorAttrSet } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { Bottom, Top } from '../../../../src/abstract-interpretation/domains/lattice';
import { assertAbstractDomain } from '../domains/domain';

describe('Vector Attribute Domain', () => {
	const create = (value: { must: VectorAttr[]; may: VectorAttr[] } | typeof Bottom) => {
		if(value === Bottom) {
			return VectorAttrDomain.bottom();
		}
		return VectorAttrDomain.from(value.must, value.may);
	};

	const AllAttrs = VectorAttrs as unknown as VectorAttr[];

	describe('Basic Lattice Elements', () => {
		assertAbstractDomain(create, Bottom, Bottom, {
			equal: true, leq: true, join: Bottom, meet: Bottom, widen: Bottom, narrow: Bottom, concrete: []
		});

		assertAbstractDomain(create, { must: [] as VectorAttr[], may: [] as VectorAttr[] }, { must: [] as VectorAttr[], may: AllAttrs }, {
			equal:    false, leq:      true, join:     { must: [], may: AllAttrs }, meet:     { must: [], may: [] as VectorAttr[] },
			widen:    { must: [], may: AllAttrs }, narrow:   { must: [], may: [] as VectorAttr[] }, concrete: [new Set()]
		});

		assertAbstractDomain(create, { must: [] as VectorAttr[], may: [] as VectorAttr[] }, { must: [] as VectorAttr[], may: [] as VectorAttr[] }, {
			equal:    true, leq:      true, join:     { must: [] as VectorAttr[], may: [] as VectorAttr[] }, meet:     { must: [] as VectorAttr[], may: [] as VectorAttr[] },
			widen:    { must: [] as VectorAttr[], may: [] as VectorAttr[] }, narrow:   { must: [] as VectorAttr[], may: [] as VectorAttr[] }, concrete: [new Set()]
		});

		assertAbstractDomain(create, { must: AllAttrs, may: AllAttrs }, { must: AllAttrs, may: AllAttrs }, {
			equal:    true, leq:      true, join:     { must: AllAttrs, may: AllAttrs }, meet:     { must: AllAttrs, may: AllAttrs },
			widen:    { must: AllAttrs, may: AllAttrs }, narrow:   { must: AllAttrs, may: AllAttrs },
			concrete: [new Set(VectorAttrs)]
		});
	});

	describe('Bottom Interactions', () => {
		assertAbstractDomain(create, Bottom, { must: [] as VectorAttr[], may: [] as VectorAttr[] }, {
			equal: false, leq: true, join: { must: [] as VectorAttr[], may: [] as VectorAttr[] }, meet: Bottom, widen: { must: [] as VectorAttr[], may: [] as VectorAttr[] }, narrow: Bottom, concrete: []
		});
		assertAbstractDomain(create, { must: [] as VectorAttr[], may: [] as VectorAttr[] }, Bottom, {
			equal:    false, leq:      false, join:     { must: [] as VectorAttr[], may: [] as VectorAttr[] }, meet:     Bottom, widen:    { must: [] as VectorAttr[], may: [] as VectorAttr[] }, narrow:   Bottom,
			concrete: [new Set()]
		});
		assertAbstractDomain(create, Bottom, { must: [] as VectorAttr[], may: AllAttrs }, {
			equal:    false, leq:      true, join:     { must: [] as VectorAttr[], may: AllAttrs }, meet:     Bottom, widen:    { must: [] as VectorAttr[], may: AllAttrs },
			narrow:   Bottom, concrete: []
		});
		assertAbstractDomain(create, { must: [] as VectorAttr[], may: AllAttrs }, Bottom, {
			equal:    false, leq:      false, join:     { must: [] as VectorAttr[], may: AllAttrs }, meet:     Bottom, widen:    { must: [] as VectorAttr[], may: AllAttrs },
			narrow:   Bottom, concrete: undefined
		});
	});

	describe('Top Interactions', () => {
		assertAbstractDomain(create, { must: [] as VectorAttr[], may: AllAttrs }, { must: [] as VectorAttr[], may: [] as VectorAttr[] }, {
			equal:    false, leq:      false, join:     { must: [] as VectorAttr[], may: AllAttrs }, meet:     { must: [] as VectorAttr[], may: [] as VectorAttr[] },
			widen:    { must: [] as VectorAttr[], may: AllAttrs }, narrow:   { must: [] as VectorAttr[], may: [] as VectorAttr[] }, concrete: undefined
		});
		assertAbstractDomain(create, { must: AllAttrs, may: AllAttrs }, { must: [] as VectorAttr[], may: AllAttrs }, {
			equal:    false, leq:      true, join:     { must: [] as VectorAttr[], may: AllAttrs }, meet:     { must: AllAttrs, may: AllAttrs },
			widen:    { must: [] as VectorAttr[], may: AllAttrs }, narrow:   { must: AllAttrs, may: AllAttrs },
			concrete: [new Set(VectorAttrs)]
		});
		assertAbstractDomain(create, { must: [] as VectorAttr[], may: AllAttrs }, { must: AllAttrs, may: AllAttrs }, {
			equal:    false, leq:      false, join:     { must: [] as VectorAttr[], may: AllAttrs }, meet:     { must: AllAttrs, may: AllAttrs },
			widen:    { must: [] as VectorAttr[], may: AllAttrs }, narrow:   { must: AllAttrs, may: AllAttrs }, concrete: undefined
		});
	});

	describe('Partial Order (leq)', () => {
		assertAbstractDomain(create, { must: ['names'], may: ['names'] }, { must: ['names'], may: ['names', 'dim'] }, {
			equal:    false, leq:      true, join:     { must: ['names'], may: ['names', 'dim'] }, meet:     { must: ['names'], may: ['names'] },
			widen:    { must: ['names'], may: ['names', 'dim'] }, narrow:   { must: ['names'], may: ['names'] },
			concrete: [new Set(['names'])], abstract: { must: ['names'], may: ['names'] }
		});
		assertAbstractDomain(create, { must: ['names'], may: ['names', 'dim'] }, { must: ['names'], may: ['names'] }, {
			equal:    false, leq:      false, join:     { must: ['names'], may: ['names', 'dim'] }, meet:     { must: ['names'], may: ['names'] },
			widen:    { must: ['names'], may: ['names', 'dim'] }, narrow:   { must: ['names'], may: ['names'] },
			concrete: [new Set(['names']), new Set(['names', 'dim'])], abstract: { must: ['names'], may: ['names', 'dim'] }
		});

		// ({names,dim}, M) ⊑ ({names}, M) because {names} ⊆ {names,dim} (must₂ ⊆ must₁)
		assertAbstractDomain(create, { must: ['names', 'dim'], may: ['names', 'dim', 'class'] }, { must: ['names'], may: ['names', 'dim', 'class'] }, {
			equal:    false, leq:      true, join:     { must: ['names'], may: ['names', 'dim', 'class'] }, meet:     { must: ['names', 'dim'], may: ['names', 'dim', 'class'] },
			widen:    { must: ['names'], may: ['names', 'dim', 'class'] }, narrow:   { must: ['names', 'dim'], may: ['names', 'dim', 'class'] },
			concrete: [new Set(['names', 'dim']), new Set(['names', 'dim', 'class'])], abstract: { must: ['names', 'dim'], may: ['names', 'dim', 'class'] }
		});
		assertAbstractDomain(create, { must: ['names'], may: ['names', 'dim', 'class'] }, { must: ['names', 'dim'], may: ['names', 'dim', 'class'] }, {
			equal:    false, leq:      false, join:     { must: ['names'], may: ['names', 'dim', 'class'] }, meet:     { must: ['names', 'dim'], may: ['names', 'dim', 'class'] },
			widen:    { must: ['names'], may: ['names', 'dim', 'class'] }, narrow:   { must: ['names', 'dim'], may: ['names', 'dim', 'class'] },
			concrete: [new Set(['names']), new Set(['names', 'dim']), new Set(['names', 'class']), new Set(['names', 'dim', 'class'])], abstract: { must: ['names'], may: ['names', 'dim', 'class'] }
		});
		assertAbstractDomain(create, { must: ['names'], may: ['names', 'dim', 'class'] }, { must: ['names', 'dim'], may: ['names', 'dim', 'class'] }, {
			equal:    false, leq:      false, join:     { must: ['names'], may: ['names', 'dim', 'class'] }, meet:     { must: ['names', 'dim'], may: ['names', 'dim', 'class'] },
			widen:    { must: ['names'], may: ['names', 'dim', 'class'] }, narrow:   { must: ['names', 'dim'], may: ['names', 'dim', 'class'] },
			concrete: [new Set(['names']), new Set(['names', 'dim']), new Set(['names', 'class']), new Set(['names', 'dim', 'class'])], abstract: { must: ['names'], may: ['names', 'dim', 'class'] }
		});
	});

	describe('Join (LUB)', () => {
		assertAbstractDomain(create, { must: ['names', 'dim'], may: ['names', 'dim'] }, { must: ['names', 'class'], may: ['names', 'class'] }, {
			equal:    false, leq:      false, join:     { must: ['names'], may: ['names', 'dim', 'class'] }, meet:     { must: ['names', 'dim', 'class'], may: ['names'] },
			widen:    { must: ['names'], may: ['names', 'dim', 'class'] }, narrow:   { must: ['names', 'dim', 'class'], may: ['names'] },
			concrete: [new Set(['names', 'dim'])], abstract: { must: ['names', 'dim'], may: ['names', 'dim'] }
		});

		assertAbstractDomain(create, { must: ['names'], may: ['names', 'dim'] }, { must: ['names'], may: ['names', 'class'] }, {
			equal:    false, leq:      false, join:     { must: ['names'], may: ['names', 'dim', 'class'] }, meet:     { must: ['names'], may: ['names'] },
			widen:    { must: ['names'], may: ['names', 'dim', 'class'] }, narrow:   { must: ['names'], may: ['names'] },
			concrete: [new Set(['names']), new Set(['names', 'dim'])], abstract: { must: ['names'], may: ['names', 'dim'] }
		});
	});

	describe('Meet (GLB)', () => {
		assertAbstractDomain(create, { must: ['names'], may: ['names', 'dim'] }, { must: ['class'], may: ['class', 'dim'] }, {
			equal:    false, leq:      false, join:     { must: [] as VectorAttr[], may: ['names', 'dim', 'class'] }, meet:     Bottom,
			widen:    { must: [] as VectorAttr[], may: ['names', 'dim', 'class'] }, narrow:   Bottom,
			concrete: [new Set(['names']), new Set(['names', 'dim'])], abstract: { must: ['names'], may: ['names', 'dim'] }
		});

		assertAbstractDomain(create, { must: ['names'], may: ['names', 'dim', 'class'] }, { must: ['dim'], may: ['names', 'dim', 'class'] }, {
			equal:    false, leq:      false, join:     { must: [] as VectorAttr[], may: ['names', 'dim', 'class'] }, meet:     { must: ['names', 'dim'], may: ['names', 'dim', 'class'] },
			widen:    { must: [] as VectorAttr[], may: ['names', 'dim', 'class'] }, narrow:   { must: ['names', 'dim'], may: ['names', 'dim', 'class'] },
			concrete: [new Set(['names']), new Set(['names', 'dim']), new Set(['names', 'class']), new Set(['names', 'dim', 'class'])], abstract: { must: ['names'], may: ['names', 'dim', 'class'] }
		});
	});

	describe('Widening and Narrowing', () => {
		assertAbstractDomain(create, { must: ['names'], may: ['names'] }, { must: ['dim'], may: ['dim'] }, {
			equal:    false, leq:      false, join:     { must: [] as VectorAttr[], may: ['names', 'dim'] }, meet:     Bottom,
			widen:    { must: [] as VectorAttr[], may: ['names', 'dim'] }, narrow:   Bottom,
			concrete: [new Set(['names'])], abstract: { must: ['names'], may: ['names'] }
		});

		assertAbstractDomain(create, { must: [] as VectorAttr[], may: ['names'] }, { must: [] as VectorAttr[], may: ['dim'] }, {
			equal:    false, leq:      false, join:     { must: [] as VectorAttr[], may: ['names', 'dim'] }, meet:     { must: [] as VectorAttr[], may: [] as VectorAttr[] },
			widen:    { must: [] as VectorAttr[], may: ['names', 'dim'] }, narrow:   { must: [] as VectorAttr[], may: [] as VectorAttr[] },
			concrete: [new Set(), new Set(['names'])], abstract: { must: [] as VectorAttr[], may: ['names'] }
		});
	});

	describe('Concretization', () => {
		assertAbstractDomain(create, { must: ['names'], may: ['names'] }, { must: ['names'], may: ['names'] }, {
			equal:    true, leq:      true, join:     { must: ['names'], may: ['names'] }, meet:     { must: ['names'], may: ['names'] },
			widen:    { must: ['names'], may: ['names'] }, narrow:   { must: ['names'], may: ['names'] },
			concrete: [new Set(['names'])], abstract: { must: ['names'], may: ['names'] }
		});

		assertAbstractDomain(create, { must: ['names'], may: ['names', 'dim'] }, { must: ['names'], may: ['names', 'dim'] }, {
			equal:    true, leq:      true, join:     { must: ['names'], may: ['names', 'dim'] }, meet:     { must: ['names'], may: ['names', 'dim'] },
			widen:    { must: ['names'], may: ['names', 'dim'] }, narrow:   { must: ['names'], may: ['names', 'dim'] },
			concrete: [new Set(['names']), new Set(['names', 'dim'])], abstract: { must: ['names'], may: ['names', 'dim'] }
		});

		assertAbstractDomain(create, { must: [] as VectorAttr[], may: ['names', 'dim'] }, { must: [] as VectorAttr[], may: ['names', 'dim'] }, {
			equal:    true, leq:      true, join:     { must: [] as VectorAttr[], may: ['names', 'dim'] }, meet:     { must: [] as VectorAttr[], may: ['names', 'dim'] },
			widen:    { must: [] as VectorAttr[], may: ['names', 'dim'] }, narrow:   { must: [] as VectorAttr[], may: ['names', 'dim'] },
			concrete: [new Set(), new Set(['names']), new Set(['dim']), new Set(['names', 'dim'])], abstract: { must: [] as VectorAttr[], may: ['names', 'dim'] }
		});

		assertAbstractDomain(create, { must: [] as VectorAttr[], may: AllAttrs }, { must: [] as VectorAttr[], may: AllAttrs }, {
			equal:    true, leq:      true, join:     { must: [] as VectorAttr[], may: AllAttrs }, meet:     { must: [] as VectorAttr[], may: AllAttrs },
			widen:    { must: [] as VectorAttr[], may: AllAttrs }, narrow:   { must: [] as VectorAttr[], may: AllAttrs },
			concrete: undefined
		});
	});

	describe('Static Factory Methods', () => {
		test('VectorAttrDomain.empty() creates (∅, ∅)', () => {
			const empty = VectorAttrDomain.empty();
			assert.strictEqual(empty.isEmpty(), true);
			assert.deepStrictEqual([...(empty.must() as Set<VectorAttr>)], []);
			assert.deepStrictEqual([...(empty.may() as Set<VectorAttr>)], []);
		});

		test('VectorAttrDomain.all() creates (Attr, Attr)', () => {
			const all = VectorAttrDomain.all();
			assert.strictEqual(all.isAll(), true);
			assert.deepStrictEqual([...(all.must() as Set<VectorAttr>)].sort(), VectorAttrs.slice().sort());
			assert.deepStrictEqual([...(all.may() as Set<VectorAttr>)].sort(), VectorAttrs.slice().sort());
		});

		test('VectorAttrDomain.top() creates (∅, Attr)', () => {
			const top = VectorAttrDomain.top();
			assert.strictEqual(top.isTop(), true);
			assert.deepStrictEqual([...(top.must() as Set<VectorAttr>)], []);
			assert.deepStrictEqual([...(top.may() as Set<VectorAttr>)].sort(), VectorAttrs.slice().sort());
		});

		test('VectorAttrDomain.bottom() creates ⊥', () => {
			const bottom = VectorAttrDomain.bottom();
			assert.strictEqual(bottom.isBottom(), true);
		});

		test('VectorAttrDomain.from() with arrays', () => {
			const domain = VectorAttrDomain.from(['names', 'dim'], ['names', 'dim', 'class']);
			assert.deepStrictEqual([...(domain.must() as Set<VectorAttr>)].sort(), ['dim', 'names']);
			assert.deepStrictEqual([...(domain.may() as Set<VectorAttr>)].sort(), ['class', 'dim', 'names']);
		});

		test('VectorAttrDomain.from() with sets', () => {
			const domain = VectorAttrDomain.from(new Set(['names']), new Set(['names', 'dim']));
			assert.deepStrictEqual([...(domain.must() as Set<VectorAttr>)], ['names']);
			assert.deepStrictEqual([...(domain.may() as Set<VectorAttr>)].sort(), ['dim', 'names']);
		});
	});

	describe('Invariant Enforcement', () => {
		test('Invalid (must ⊈ may) becomes Bottom', () => {
			const domain = new VectorAttrDomain({ must: new Set(['names', 'other']), may: new Set(['names', 'dim']) });
			assert.strictEqual(domain.isBottom(), true);
		});

		test('Valid (must ⊆ may) is preserved', () => {
			const domain = new VectorAttrDomain({ must: new Set(['names']), may: new Set(['names', 'dim']) });
			assert.strictEqual(domain.isValue(), true);
			assert.strictEqual(domain.isBottom(), false);
		});

		test('Empty must is always valid', () => {
			const domain = new VectorAttrDomain({ must: new Set(), may: new Set(['names']) });
			assert.strictEqual(domain.isValue(), true);
		});

		test('Equal must and may is valid', () => {
			const domain = new VectorAttrDomain({ must: new Set(['names', 'dim']), may: new Set(['names', 'dim']) });
			assert.strictEqual(domain.isValue(), true);
		});
	});

	describe('String and JSON Representation', () => {
		test('toString() formats correctly', () => {
			assert.strictEqual(VectorAttrDomain.bottom().toString(), '⊥');
			assert.strictEqual(VectorAttrDomain.top().toString(), '(∅, Attr)');
			assert.strictEqual(VectorAttrDomain.empty().toString(), '(∅, {})');
			assert.strictEqual(VectorAttrDomain.all().toString(), '({names, dim, class, other}, Attr)');
			assert.strictEqual(VectorAttrDomain.from(['names'], ['names', 'dim']).toString(), '({names}, {names, dim})');
		});

		test('toJson() serializes correctly', () => {
			assert.deepStrictEqual(VectorAttrDomain.bottom().toJson(), 'bottom');
			assert.deepStrictEqual(VectorAttrDomain.empty().toJson(), { must: [], may: [] });
			assert.deepStrictEqual(VectorAttrDomain.from(['names'], ['names', 'dim']).toJson(), { must: ['names'], may: ['names', 'dim'] });
		});
	});

	describe('Abstract Function (α)', () => {
		test('α(empty set) = ⊥', () => {
			const result = VectorAttrDomain.abstract(new Set());
			assert.strictEqual(result.isBottom(), true);
		});

		test('α(Top) = ⊤', () => {
			const result = VectorAttrDomain.abstract(Top);
			assert.strictEqual(result.isTop(), true);
		});

		test('α(single set) = (S, S)', () => {
			const result = VectorAttrDomain.abstract(new Set([new Set(['names', 'dim'])]));
			assert.strictEqual(result.isValue(), true);
			assert.deepStrictEqual([...(result.must() as Set<VectorAttr>)].sort(), ['dim', 'names']);
			assert.deepStrictEqual([...(result.may() as Set<VectorAttr>)].sort(), ['dim', 'names']);
		});

		test('α(multiple sets) computes must=intersection, may=union', () => {
			const concrete = new Set<VectorAttrSet>([
				new Set<VectorAttr>(['names', 'dim']),
				new Set<VectorAttr>(['names', 'class'])
			]);
			const result = VectorAttrDomain.abstract(concrete);
			assert.deepStrictEqual([...(result.must() as Set<VectorAttr>)], ['names']);
			assert.deepStrictEqual([...(result.may() as Set<VectorAttr>)].sort(), ['class', 'dim', 'names']);
		});
	});
});
