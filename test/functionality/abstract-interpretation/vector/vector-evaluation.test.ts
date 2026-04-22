import { assert, describe, test } from 'vitest';
import type { AbstractValue, AnyAbstractDomain } from '../../../../src/abstract-interpretation/domains/abstract-domain';
import { BoundedSetDomain } from '../../../../src/abstract-interpretation/domains/bounded-set-domain';
import { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Bottom } from '../../../../src/abstract-interpretation/domains/lattice';
import { SingletonDomain } from '../../../../src/abstract-interpretation/domains/singleton-domain';
import type { VectorAttr } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { VectorAttrDomain, VectorAttrEmpty } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import type { RVectorType } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import { RVectorTypeDomain, RVectorTypeTop } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import { KnownInitialPositionsDomain } from '../../../../src/abstract-interpretation/vector/known-initial-positions-domain';
import { NAAwareDomain } from '../../../../src/abstract-interpretation/vector/na-aware-domain';
import type { ValueToDomainConverter } from '../../../../src/abstract-interpretation/vector/resolve-vector-args';
import type { VectorDomain, VectorProduct } from '../../../../src/abstract-interpretation/vector/vector-domain';
import { Identifier } from '../../../../src/dataflow/environments/identifier';
import type { RSymbol } from '../../../../src/r-bridge/lang-4.x/ast/model/nodes/r-symbol';
import type { ParentInformation } from '../../../../src/r-bridge/lang-4.x/ast/model/processing/decorate';
import { RType } from '../../../../src/r-bridge/lang-4.x/ast/model/type';
import { RNa } from '../../../../src/r-bridge/lang-4.x/convert-values';
import type { RShell } from '../../../../src/r-bridge/shell';
import { SlicingCriterion } from '../../../../src/slicing/criterion/parse';
import { SourceRange } from '../../../../src/util/range';
import { Record } from '../../../../src/util/record';
import { withShell } from '../../_helper/shell';
import { domainFactory, naAwareFactory } from '../_helper/interval-factory';
import { getVectorForCriterion, runVectorInference } from '../_helper/vector-inference-helpers';

/** The abstract value in an NA-aware domain for a given domain. */
type AbstractNaValue<Domain extends AnyAbstractDomain> = { inner: AbstractValue<Domain>, hasNA: boolean };

/**
 * The expected abstract value of a vector, used in tests.
 * Each property corresponds to a component of the vector abstract domain, such as `length`, `values`, `summary`, `attributes`, and `type`.
 * The values are represented as abstract values in the respective domains.
 */
interface ExpectedVector<Domain extends AnyAbstractDomain> extends Record<keyof VectorProduct<Domain>, unknown> {
	length:     AbstractValue<IntervalDomain>;
	known:      readonly AbstractNaValue<Domain>[];
	summary:    AbstractNaValue<Domain>;
	attributes: AbstractValue<VectorAttrDomain>;
	type:       AbstractValue<RVectorTypeDomain>;
};

/** A test case for vector evaluation, mapping identifiers as slicing criteria to their expected abstract vector values. */
type TestCase<Domain extends AnyAbstractDomain> = Record<`${number}@${string}`, ExpectedVector<Domain> | undefined>;

/** Converts an abstract value to an NA-aware abstract value. */
function asNaAware<Domain extends AnyAbstractDomain>(value: AbstractValue<Domain>): AbstractNaValue<Domain> {
	return { inner: value, hasNA: false };
}

/** Converts a list of abstract values to a list of NA-aware abstract values. */
function asNaAwares<Domain extends AnyAbstractDomain>(...values: readonly (AbstractValue<Domain> | AbstractNaValue<Domain>)[]): readonly AbstractNaValue<Domain>[] {
	return values.map((value): AbstractNaValue<Domain> => {
		if(typeof value == 'object' && value !== null && 'inner' in value && 'hasNA' in value) {
			return value;
		}
		return asNaAware(value);
	});
}

const NaInterval = { inner: Bottom, hasNA: true } satisfies AbstractNaValue<IntervalDomain>;
const NaBoolean = { inner: Bottom, hasNA: true } satisfies AbstractNaValue<SingletonDomain<boolean>>;

describe.sequential('Vector Inference Evaluation', withShell(shell => {
	test('Scalar number value', async() => {
		const code = 'x <- 42';
		const expected = {
			'1@x': {
				length:     [1, 1],
				known:      asNaAwares([42, 42]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Scalar integer value', async() => {
		const code = 'x <- 42L';
		const expected = {
			'1@x': {
				length:     [1, 1],
				known:      asNaAwares([42, 42]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'integer'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Scalar string value', async() => {
		const code = 'x <- "Hello World!"';
		const expected = {
			'1@x': {
				length:     [1, 1],
				known:      asNaAwares(new Set(['Hello World!'])),
				summary:    asNaAware(new Set()),
				attributes: VectorAttrEmpty,
				type:       'character'
			},
		} satisfies TestCase<BoundedSetDomain<string>>;
		await assertVectorDomainStrings(shell, code, expected);
		await validateVectorDomainStrings(shell, code, Record.keys(expected));
	});
	test('NULL value', async() => {
		const code = 'x <- NULL';
		const expected = {
			'1@x': undefined,
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector construction', async() => {
		const code = 'v <- c(1, 2, 3)';
		const expected = {
			'1@v': {
				length:     [3, 3],
				known:      asNaAwares([1, 1], [2, 2], [3, 3]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector construction with NA', async() => {
		const code = 'v <- c(1, 2, NA, 4)';
		const expected = {
			'1@v': {
				length:     [4, 4],
				known:      asNaAwares([1, 1], [2, 2], NaInterval, [4, 4]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector construction with booleans', async() => {
		const code = 'v <- c(TRUE, FALSE, TRUE)';
		const expected = {
			'1@v': {
				length:     [3, 3],
				known:      asNaAwares(true, false, true),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'logical'
			},
		} satisfies TestCase<SingletonDomain<boolean>>;
		await assertVectorDomainBooleans(shell, code, expected);
		await validateVectorDomainBooleans(shell, code, Record.keys(expected));
	});
	test('Vector construction with variables', async() => {
		const code = `
			a <- 42
			b <- 2
			v <- c(1, b, a)
		`.trim();
		const expected = {
			'3@v': {
				length:     [3, 3],
				known:      asNaAwares([1, 1], [2, 2], [42, 42]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Unknown vector construction', async() => {
		const code = 'v <- c(runif(runif(1, 0, 10)))';
		const expected = {
			'1@v': {
				length:     [0, Infinity],
				known:      asNaAwares(),
				summary:    asNaAware([0, Infinity]),
				attributes: VectorAttrEmpty,
				type:       RVectorTypeTop
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Named vector construction', async() => {
		const code = 'v <- c(a = 1, b = 2, c = 3)';
		const expected = {
			'1@v': {
				length:     [3, 3],
				known:      asNaAwares([1, 1], [2, 2], [3, 3]),
				summary:    asNaAware(Bottom),
				attributes: { must: new Set(['names']), may: new Set(['names']) },
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector constuction with concatenation', async() => {
		const code = 'v <- c(1, c(2, 3), c(4, c(5, 6)))';
		const expected = {
			'1@v': {
				length:     [6, 6],
				known:      asNaAwares([1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector constuction with combination', async() => {
		const code = `
			v1 <- c(1, 2)
			v2 <- c(3, 4, 5, 6)
			v <- c(v1, v2)
		`.trim();
		const expected = {
			'3@v': {
				length:     [6, 6],
				known:      asNaAwares([1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Conditional vector construction', async() => {
		const code = 'v <- if (runif(1) > 0.5) c(1, 2) else c(3, 4, 5, 6)';
		const expected = {
			'1@v': {
				length:     [2, 4],
				known:      asNaAwares([1, 3], [2, 4], [5, 5], [6, 6]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Conditional vector construction with scalar', async() => {
		const code = `
			if (runif(1) > 0.5) {
				v <- c(1, 2, 3)
			} else {
				v <- 42
			}
			print(v)
		`.trim();
		const expected = {
			'6@v': {
				length:     [1, 3],
				known:      asNaAwares([1, 42], [2, 2], [3, 3]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Conditional vector construction with ifelse', async() => {
		const code = 'v <- ifelse(runif(1, 12, 24) > 18, "adult", "minor")';
		const expected = {
			'1@v': {
				length:     [1, 1],
				known:      asNaAwares(new Set(['adult', 'minor'])),
				summary:    asNaAware(new Set()),
				attributes: VectorAttrEmpty,
				type:       'character'
			},
		} satisfies TestCase<BoundedSetDomain<string>>;
		await assertVectorDomainStrings(shell, code, expected);
		await validateVectorDomainStrings(shell, code, Record.keys(expected));
	});
	test('Vector sequence construction', async() => {
		const code = 'v <- 1:3';
		const expected = {
			'1@v': {
				length:     [3, 3],
				known:      asNaAwares([1, 1], [2, 2], [3, 3]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('NULL construction', async() => {
		const code = 'v <- c()';
		const expected = {
			'1@v': undefined, // NULL is not a vector, so we expect no inferred vector value
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Empty vector construction', async() => {
		const code = 'v <- numeric()';
		const expected = {
			'1@v': {
				length:     [0, 0],
				known:      asNaAwares(),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector addition', async() => {
		const code = 'v <- c(1, 2) + c(3, 4)';
		const expected = {
			'1@v': {
				length:     [2, 2],
				known:      asNaAwares([4, 4], [6, 6]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector addition with recycling', async() => {
		const code = 'v <- c(1, 2) + 42';
		const expected = {
			'1@v': {
				length:     [2, 2],
				known:      asNaAwares([43, 43], [44, 44]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector addition with advanced recycling', async() => {
		const code = 'v <- c(1, 2) + c(1, 2, 3, 4, 5)';
		const expected = {
			'1@v': {
				length:     [5, 5],
				known:      asNaAwares([2, 2], [4, 4], [4, 4], [6, 6], [6, 6]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector addition with recycling and NA', async() => {
		const code = 'v <- c(1, 2) + c(1, NA, 3, 4, NA)';
		const expected = {
			'1@v': {
				length:     [5, 5],
				known:      asNaAwares([2, 2], NaInterval, [4, 4], [6, 6], NaInterval),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector negation', async() => {
		const code = 'v <- !c(TRUE, FALSE, TRUE)';
		const expected = {
			'1@v': {
				length:     [3, 3],
				known:      asNaAwares(false, true, false),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'logical'
			},
		} satisfies TestCase<SingletonDomain<boolean>>;
		await assertVectorDomainBooleans(shell, code, expected);
		await validateVectorDomainBooleans(shell, code, Record.keys(expected));
	});
	test('Vector disjunction with recycling', async() => {
		const code = 'v <- c(TRUE, FALSE) | c(FALSE, FALSE, TRUE)';
		const expected = {
			'1@v': {
				length:     [3, 3],
				known:      asNaAwares(true, false, true),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'logical'
			},
		} satisfies TestCase<SingletonDomain<boolean>>;
		await assertVectorDomainBooleans(shell, code, expected);
		await validateVectorDomainBooleans(shell, code, Record.keys(expected));
	});
	test('Vector conjunction with recycling and NA', async() => {
		const code = 'v <- c(TRUE, FALSE) & c(FALSE, NA, TRUE, FALSE, NA)';
		const expected = {
			'1@v': {
				length:     [5, 5],
				known:      asNaAwares(false, NaBoolean, true, false, NaBoolean),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'logical'
			},
		} satisfies TestCase<SingletonDomain<boolean>>;
		await assertVectorDomainBooleans(shell, code, expected);
		await validateVectorDomainBooleans(shell, code, Record.keys(expected));
	});
	test('Vector multiplication', async() => {
		const code = 'v <- c(1, 2) * c(3, 4)';
		const expected = {
			'1@v': {
				length:     [2, 2],
				known:      asNaAwares([3, 3], [8, 8]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector division', async() => {
		const code = 'v <- c(4, 6) / c(2, 3)';
		const expected = {
			'1@v': {
				length:     [2, 2],
				known:      asNaAwares([2, 2], [2, 2]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector comparison', async() => {
		const code = 'v <- c(1, 2, 3) > 2';
		const expected = {
			'1@v': {
				length:     [3, 3],
				known:      asNaAwares(false, false, true),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'logical'
			},
		} satisfies TestCase<SingletonDomain<boolean>>;
		await assertVectorDomainBooleans(shell, code, expected);
		await validateVectorDomainBooleans(shell, code, Record.keys(expected));
	});
	test('Vector subset with single index', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[1]
		`.trim();
		const expected = {
			'2@v': {
				length:     [1, 1],
				known:      asNaAwares([1, 1]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with multiple indices', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[c(1, 3)]
		`.trim();
		const expected = {
			'2@v': {
				length:     [2, 2],
				known:      asNaAwares([1, 1], [3, 3]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with multiple indices sequence', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[1:3]
		`.trim();
		const expected = {
			'2@v': {
				length:     [3, 3],
				known:      asNaAwares([1, 1], [2, 2], [3, 3]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with condition', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[v > 2]
		`.trim();
		const expected = {
			'2@v': {
				length:     [3, 3],
				known:      asNaAwares([3, 3], [4, 4], [5, 5]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with NA condition', async() => {
		const code = `
			v <- c(1, NA, 3, 4, NA)
			v <- v[!is.na(v)]
		`.trim();
		const expected = {
			'2@v': {
				length:     [3, 3],
				known:      asNaAwares([1, 1], [3, 3], [4, 4]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with negative index', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[-1]
		`.trim();
		const expected = {
			'2@v': {
				length:     [4, 4],
				known:      asNaAwares([2, 2], [3, 3], [4, 4], [5, 5]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with negative indices', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[-c(1, 3)]
		`.trim();
		const expected = {
			'2@v': {
				length:     [3, 3],
				known:      asNaAwares([2, 2], [4, 4], [5, 5]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with double brackets', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[[5]]
		`.trim();
		const expected = {
			'2@v': {
				length:     [1, 1],
				known:      asNaAwares([5, 5]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with recycling', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[c(1, 4, 1)]
		`.trim();
		const expected = {
			'2@v': {
				length:     [3, 3],
				known:      asNaAwares([1, 1], [4, 4], [1, 1]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with unknown recycling', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[rep(1, 10)]
		`.trim();
		const expected = {
			'2@v': {
				length:     [0, Infinity],
				known:      asNaAwares(),
				summary:    asNaAware([0, Infinity]),
				attributes: VectorAttrEmpty,
				type:       RVectorTypeTop
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with boolean recycling', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[c(TRUE, FALSE)]
		`.trim();
		const expected = {
			'2@v': {
				length:     [0, 5],
				known:      asNaAwares([1, 1], [3, 3], [5, 5]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset out of bounds', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[10]
		`.trim();
		const expected = {
			'2@v': {
				length:     [1, 1],
				known:      asNaAwares(NaInterval),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset by name', async() => {
		const code = `
			v <- c(a = 1, b = 2, c = 3)
			v <- v["a"]
		`.trim();
		const expected = {
			'2@v': {
				length:     [1, 1],
				known:      asNaAwares([1, 1]),
				summary:    asNaAware(Bottom),
				attributes: { must: new Set(['names']), may: new Set(['names']) },
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset by name with double brackets', async() => {
		const code = `
			v <- c(a = 1, b = 2, c = 3)
			v <- v[["a"]]
		`.trim();
		const expected = {
			'2@v': {
				length:     [1, 1],
				known:      asNaAwares([1, 1]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment with single index', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v[1] <- 42
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([42, 42], [2, 2], [3, 3], [4, 4], [5, 5]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment with single NA', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v[1] <- NA
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares(NaInterval, [2, 2], [3, 3], [4, 4], [5, 5]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment with multiple indices', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v[c(1, 3)] <- 42
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([42, 42], [2, 2], [42, 42], [4, 4], [5, 5]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment with multiple indices sequence', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v[1:3] <- c(42, 43, 44)
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([42, 42], [43, 43], [44, 44], [4, 4], [5, 5]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment with condition', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v[v > 2] <- 42
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([1, 1], [2, 2], [42, 42], [42, 42], [42, 42]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment with NA condition', async() => {
		const code = `
			v <- c(1, NA, 3, 4, NA)
			v[is.na(v)] <- 42
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([1, 1], [42, 42], [3, 3], [4, 4], [42, 42]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment with negative index', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v[-1] <- 42
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([1, 1], [42, 42], [42, 42], [42, 42], [42, 42]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment with negative indices', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v[-c(1, 3)] <- 42
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([1, 1], [42, 42], [3, 3], [42, 42], [42, 42]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment with double brackets', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v[[5]] <- 42
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([1, 1], [2, 2], [3, 3], [4, 4], [42, 42]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment by name', async() => {
		const code = `
			v <- c(a = 1, b = 2, c = 3)
			v[["a"]] <- 42
		`.trim();
		const expected = {
			'2@v': {
				length:     [3, 3],
				known:      asNaAwares([42, 42], [2, 2], [3, 3]),
				summary:    asNaAware(Bottom),
				attributes: { must: new Set(['names']), may: new Set(['names']) },
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment out of bounds', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v[10] <- 42
		`.trim();
		const expected = {
			'2@v': {
				length:     [10, 10],
				known:      asNaAwares([1, 1], [2, 2], [3, 3], [4, 4], [5, 5], NaInterval, NaInterval, NaInterval, NaInterval, [42, 42]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector assignment with boolean recycling', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v[c(TRUE, FALSE)] <- 42
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([42, 42], [2, 2], [42, 42], [4, 4], [42, 42]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector with custom attribute', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			attr(v, "description") <- "This is a named numeric vector"
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([1, 1], [2, 2], [3, 3], [4, 4], [5, 5]),
				summary:    asNaAware(Bottom),
				attributes: { must: new Set(['other']), may: new Set(['other']) },
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector with names attribute', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			names(v) <- c("first", "second", "third", "fourth", "fifth")
		`.trim();
		const expected = {
			'2@v': {
				length:     [5, 5],
				known:      asNaAwares([1, 1], [2, 2], [3, 3], [4, 4], [5, 5]),
				summary:    asNaAware(Bottom),
				attributes: { must: new Set(['names']), may: new Set(['names']) },
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with 0 index', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[0]
		`.trim();
		const expected = {
			'2@v': {
				length:     [0, 0],
				known:      asNaAwares(),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector subset with 0 index to NA', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v <- v[0][1]
		`.trim();
		const expected = {
			'2@v': {
				length:     [1, 1],
				known:      asNaAwares(NaInterval),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
	test('Vector coercion to list', async() => {
		const code = `
			v <- c(1, 2, 3, 4, 5)
			v$first <- 42
		`.trim();
		const expected = {
			'2@v': undefined, // After coercion to list, we no longer expect a vector value
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainIntervals(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});
}));

/**
 * Asserts that the inferred interval vectors for a given criterion in the code match the expected vector.
 */
async function assertVectorDomainIntervals(shell: RShell, code: string, expected: TestCase<IntervalDomain>) {
	for(const [criterion, expectedVector] of Record.entries(expected)) {
		const inferred = await getVectorForCriterion(shell, code, criterion, domainFactory(IntervalDomain.top()), value => typeof value === 'number' ? new Set([value]) : undefined);
		assertVectorValue(criterion, inferred, expectedVector, IntervalDomain.top());
	}
}

/**
 * Asserts that the inferred string set vectors for a given criterion in the code match the expected vector.
 */
async function assertVectorDomainStrings(shell: RShell, code: string, expected: TestCase<BoundedSetDomain<string>>) {
	for(const [criterion, expectedVector] of Record.entries(expected)) {
		const inferred = await getVectorForCriterion(shell, code, criterion, domainFactory(BoundedSetDomain.top<string>()), value => typeof value === 'string' ? new Set([value]) : undefined);
		assertVectorValue(criterion, inferred, expectedVector, BoundedSetDomain.top());
	}
}

/**
 * Asserts that the inferred boolean vectors for a given criterion in the code match the expected vector.
 */
async function assertVectorDomainBooleans(shell: RShell, code: string, expected: TestCase<SingletonDomain<boolean>>) {
	for(const [criterion, expectedVector] of Record.entries(expected)) {
		const inferred = await getVectorForCriterion(shell, code, criterion, domainFactory(SingletonDomain.top<boolean>()), value => typeof value === 'boolean' ? new Set([value]) : undefined);
		assertVectorValue(criterion, inferred, expectedVector, SingletonDomain.top());
	}
}

/**
 * Type of an entry for a validation test case, containing the slicing criterion, the inferred vector domain for this criterion,
 * the R symbol node corresponding to this criterion, and the line of code where this criterion is located.
 */
interface TestEntry<Domain extends AnyAbstractDomain> {
	criterion: `${number}@${string}`,
	inferred:  Domain | undefined,
	node:      RSymbol<ParentInformation>,
	line:      number
}

/**
 * Validates that the inferred interval vector domain for the given criteria in the code matches the expected interval vector domain when running the code,
 * by instrumenting the code to output the actual properties of the vector at these criteria and comparing them to the inferred properties.
 */
async function validateVectorDomainIntervals(shell: RShell, code: string, criteria: readonly `${number}@${string}`[]) {
	return validateVectorDomain(shell, code, criteria, IntervalDomain.top(), value => typeof value === 'number' ? new Set([value]) : undefined, str => {
		const value = Number.parseFloat(str);
		return [value, value] as const;
	});
}

/**
 * Validates that the inferred string set vector domain for the given criteria in the code matches the expected string set vector domain when running the code,
 * by instrumenting the code to output the actual properties of the vector at these criteria and comparing them to the inferred properties.
 */
async function validateVectorDomainStrings(shell: RShell, code: string, criteria: readonly `${number}@${string}`[]) {
	return validateVectorDomain(shell, code, criteria, BoundedSetDomain.top<string>(), value => typeof value === 'string' ? new Set([value]) : undefined, str => new Set([str]));
}

/**
 * Validates that the inferred boolean vector domain for the given criteria in the code matches the expected boolean vector domain when running the code,
 * by instrumenting the code to output the actual properties of the vector at these criteria and comparing them to the inferred properties.
 */
async function validateVectorDomainBooleans(shell: RShell, code: string, criteria: readonly `${number}@${string}`[]) {
	return validateVectorDomain(shell, code, criteria, SingletonDomain.top<boolean>(), value => typeof value === 'boolean' ? new Set([value]) : undefined, str => str === 'TRUE');
}

/**
 * Validates that the inferred vector domain for the given criteria in the code matches the expected vector domain when running the code,
 * by instrumenting the code to output the actual properties of the vector at these criteria and comparing them to the inferred properties.
 */
async function validateVectorDomain<Domain extends AnyAbstractDomain>(shell: RShell, code: string, criteria: readonly `${number}@${string}`[], domain: Domain, valueToDomain: ValueToDomainConverter<Domain>, valueDeserializer: (value: string) => AbstractValue<Domain>) {
	const testEntries: TestEntry<VectorDomain<Domain>>[] = [];

	for(const criterion of criteria) {
		const result = await runVectorInference(shell, code, domainFactory(domain), valueToDomain);
		const inferred = result.getForCriterion(criterion);
		const nodeId = SlicingCriterion.parse(criterion, result.pipelineResult.normalize.idMap);
		const node = result.pipelineResult.normalize.idMap.get(nodeId);

		if(node?.type !== RType.Symbol) {
			throw new Error(`slicing criterion ${criterion} does not refer to an R symbol`);
		}
		const range = SourceRange.fromNode(node);
		const line = range ? SourceRange.getEndLine(range) : undefined;

		if(line === undefined) {
			throw new Error(`cannot resolve line of criterion ${criterion}`);
		}
		testEntries.push({ criterion, inferred, node, line });
	}
	testEntries.sort((a, b) => b.line - a.line);
	const lines = code.split('\n');

	for(const { criterion, node, line } of testEntries) {
		const outputCode = createCodeForOutput(criterion, Identifier.toString(node.content));
		lines.splice(line, 0, outputCode);
	}
	shell.clearEnvironment();
	const instrumentedCode = lines.join('\n');
	const output = await shell.sendCommandWithOutput(instrumentedCode);

	for(const { criterion, inferred } of testEntries) {
		const expected = getRealDomainFromOutput(criterion, output, domain, valueDeserializer);
		assertVectorValue(criterion, inferred, expected, domain, true);
	}
}

/**
 * Creates R code to output the properties of the vector at the given slicing criterion.
 */
function createCodeForOutput(
	criterion: SlicingCriterion,
	symbol: string
): string {
	const marker = getOutputMarker(criterion);
	return `cat(sprintf("${marker} %s,%s,%s,%s,%s,%s\\n", is.vector(${symbol}), is.atomic(${symbol}), paste(length(${symbol})), paste(${symbol}, collapse = ";"), paste(names(attributes(${symbol})), collapse = ";"), typeof(${symbol})))`;
}

/**
 * Parses the output of the instrumented code to extract the actual properties of the vector at the given slicing criterion, and constructs an expected vector from these properties.
 */
function getRealDomainFromOutput<Domain extends AnyAbstractDomain>(
	criterion: SlicingCriterion,
	output: string[],
	domain: Domain,
	valueDeserializer: (value: string) => AbstractValue<Domain>
): ExpectedVector<Domain> | undefined {
	const marker = getOutputMarker(criterion);
	const line = output.find(line => line.startsWith(marker))?.replace(marker, '').trim();

	if(line === undefined) {
		throw new Error(`cannot parse output of instrumented code for ${criterion}`);
	}
	const OutputRegex = /^(TRUE|FALSE),(TRUE|FALSE),(\w*),(.*),(.*),(.*)$/;
	const result = line.match(OutputRegex);

	if(result?.length === 7) {
		const domainBottom = domain.bottom().value as AbstractValue<Domain>;
		const isVector = result[1] === 'TRUE';
		const isAtomic = result[2] === 'TRUE';
		const length = Number.parseInt(result[3]);
		const values = result[4].length > 0 ? result[4].split(';') : [];
		const attributes = result[5].length > 0 ? result[5].split(';') : [];
		const type = result[6];

		if(isVector && isAtomic) {
			return {
				length:     [length, length],
				known:      values.map(value => value === RNa ? { inner: domainBottom, hasNA: true } : asNaAware(valueDeserializer(value))),
				summary:    asNaAware(domainBottom),
				attributes: { may: new Set(attributes as VectorAttr[]), must: new Set(attributes as VectorAttr[]) },
				type:       type as RVectorType
			};
		}
	}
}

/**
 * Generates a marker for a slicing criterion to identify the corresponding line in the output of the instrumented code.
 */
function getOutputMarker(criterion: SlicingCriterion): string {
	return `VECTOR INFERENCE ${criterion}:`;
}

/**
 * Asserts that the inferred vector for a given criterion matches the expected vector.
 */
function assertVectorValue<Domain extends AnyAbstractDomain>(criterion: string, inferred: VectorDomain<Domain> | undefined, expected: ExpectedVector<Domain> | undefined, domain: Domain, overapproximation?: boolean) {
	if(inferred === undefined || expected === undefined) {
		if(overapproximation) {
			assert.ok(inferred === undefined, `Expected vector for criterion "${criterion}" to be undefined, but got ${inferred?.toString()}`);
		} else {
			assert.ok(inferred === undefined && expected === undefined, `Expected vector for criterion "${criterion}" to be ${expected === undefined ? 'undefined' : 'defined'}, but got ${inferred?.toString()}`);
		}
		return;
	}
	const factory = domainFactory(domain);
	const length = new IntervalDomain(expected.length);
	const known = new KnownInitialPositionsDomain(expected.known.map(({ inner, hasNA }) => new NAAwareDomain({ inner: domain.create(inner), hasNA }, factory)), naAwareFactory(factory));
	const summary = new NAAwareDomain({ inner: domain.create(expected.summary.inner), hasNA: expected.summary.hasNA }, factory);
	const attributes = new VectorAttrDomain(expected.attributes);
	const type = new RVectorTypeDomain(expected.type);

	if(overapproximation) {
		assert.ok(length.leq(inferred.length), `Expected vector for criterion "${criterion}" to have an over-approximation of length ${length.toString()}, but got ${inferred.length.toString()}`);
		assert.ok(known.leq(inferred.known), `Expected vector for criterion "${criterion}" to have an over-approximation of known values ${known.toString()}, but got ${inferred.known.toString()}`);
		assert.ok(summary.leq(inferred.summary), `Expected vector for criterion "${criterion}" to have an over-approximation of summary ${summary.toString()}, but got ${inferred.summary.toString()}`);
		assert.ok(attributes.leq(inferred.attributes), `Expected vector for criterion "${criterion}" to have an over-approximation of attributes ${attributes.toString()}, but got ${inferred.attributes.toString()}`);
		assert.ok(type.leq(inferred.type), `Expected vector for criterion "${criterion}" to have an over-approximation of type ${type.toString()}, but got ${inferred.type.toString()}`);
	} else {
		assert.ok(inferred.length.equals(length), `Expected vector for criterion "${criterion}" to have length ${length.toString()}, but got ${inferred.length.toString()}`);
		assert.ok(inferred.known.equals(known), `Expected vector for criterion "${criterion}" to have known values ${known.toString()}, but got ${inferred.known.toString()}`);
		assert.ok(inferred.summary.equals(summary), `Expected vector for criterion "${criterion}" to have summary ${summary.toString()}, but got ${inferred.summary.toString()}`);
		assert.ok(inferred.attributes.equals(attributes), `Expected vector for criterion "${criterion}" to have attributes ${attributes.toString()}, but got ${inferred.attributes.toString()}`);
		assert.ok(inferred.type.equals(type), `Expected vector for criterion "${criterion}" to have type ${type.toString()}, but got ${inferred.type.toString()}`);
	}
}
