import { describe, test } from 'vitest';
import type { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Bottom } from '../../../../src/abstract-interpretation/domains/lattice';
// Disabled: TestCase<Domain> requires Domain to implement ArithmeticDomain, but BoundedSetDomain<string>/SingletonDomain<boolean> don't.
// import type { BoundedSetDomain } from '../../../../src/abstract-interpretation/domains/bounded-set-domain';
// import type { SingletonDomain } from '../../../../src/abstract-interpretation/domains/singleton-domain';
import { VectorAttrEmpty } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { RVectorTypeTop } from '../../../../src/abstract-interpretation/domains/vector-type-domain';
import { withShell } from '../../_helper/shell';
import { Record } from '../../../../src/util/record';
import {
	asNaAware,
	asNaAwares,
	NaInterval,
	assertVectorDomainIntervals,
	validateVectorDomainIntervals,
	// Disabled: TestCase<Domain> requires Domain to implement ArithmeticDomain, but BoundedSetDomain<string>/SingletonDomain<boolean> don't.
	// assertVectorDomainStrings,
	// validateVectorDomainStrings,
	// assertVectorDomainBooleans,
	// validateVectorDomainBooleans,
	type TestCase
} from '../_helper/vector-assertion-helpers';
import './log-config';

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

	// Disabled: TestCase<Domain> requires Domain to implement ArithmeticDomain, but BoundedSetDomain<string>/SingletonDomain<boolean> don't.
	/* test('Scalar string value', async() => {
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
 */
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

	// Disabled: TestCase<Domain> requires Domain to implement ArithmeticDomain, but BoundedSetDomain<string>/SingletonDomain<boolean> don't.
	/* test('Vector construction with booleans', async() => {
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
 */
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

	// Disabled: TestCase<Domain> requires Domain to implement ArithmeticDomain, but BoundedSetDomain<string>/SingletonDomain<boolean> don't.
	/* test('Conditional vector construction with ifelse', async() => {
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
 */
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

	// Disabled: TestCase<Domain> requires Domain to implement ArithmeticDomain, but BoundedSetDomain<string>/SingletonDomain<boolean> don't.
	/* test('Vector negation', async() => {
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
 */
	// Disabled: TestCase<Domain> requires Domain to implement ArithmeticDomain, but BoundedSetDomain<string>/SingletonDomain<boolean> don't.
	/* test('Vector disjunction with recycling', async() => {
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
 */
	// Disabled: TestCase<Domain> requires Domain to implement ArithmeticDomain, but BoundedSetDomain<string>/SingletonDomain<boolean> don't.
	/* test('Vector conjunction with recycling and NA', async() => {
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
 */
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

	// Disabled: TestCase<Domain> requires Domain to implement ArithmeticDomain, but BoundedSetDomain<string>/SingletonDomain<boolean> don't.
	/* test('Vector comparison', async() => {
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
 */
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

	test.skip('Vector assignment with negative index', async() => {
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

	test.skip('Vector assignment with negative indices', async() => {
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

	test.skip('Vector assignment by name', async() => {
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
