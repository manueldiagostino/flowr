import { describe, test } from 'vitest';
import type { IntervalDomain } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { IntervalTop } from '../../../../src/abstract-interpretation/domains/interval-domain';
import { Bottom } from '../../../../src/abstract-interpretation/domains/lattice';
import { VectorAttrEmpty } from '../../../../src/abstract-interpretation/domains/vector-attr-domain';
import { withShell } from '../../_helper/shell';
import { Record } from '../../../../src/util/record';
import {
	asNaAware,
	asNaAwares,
	NaInterval,
	assertVectorDomainSound,
	validateVectorDomainIntervals,
	type TestCase,
	asNaAwareWithNA
} from '../_helper/vector-assertion-helpers';
import './log-config';

describe.sequential('Vector Widening', withShell(shell => {
	test('while loop with growing vector triggers widening', async() => {
		const code = `
			x <- c(1, 2, 3)
			i <- 1
			while(i <= 5) {
				x <- c(x, i)
				i <- i + 1
			}
			print(x)
		`;
		const expected = {
			'8@x': {
				length:     [3, +Infinity],
				known:      asNaAwares([1, 1], [2, 2], [3, 3]),
				summary:    asNaAware([1, 5]),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
		// await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});

	test('while loop with selection and concatenation', async() => {
		const code = `
			x <- c(1, 2, 3)
			y <- 0
			i <- 1
			while(i <= 5) {
				s <- x[c(1,2,3)]
				y <- c(y, s)
				i <- i + 1
			}
			print(y)
		`;
		const expected = {
			'10@y': {
				length:     [3, +Infinity],
				known:      asNaAwares([0, 0], [1, 1], [2, 2], [3, 3]),
				summary:    asNaAware([1, 3]),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
		// await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});


	test('while loop with vector element modification triggers widening', async() => {
		const code = `
			x <- c(1, 2, 3)
			i <- 1
			while(i <= 3) {
				x[i] <- x[i] + 1
				i <- i + 1
			}
			print(x)
		`;
		const expected = {
			'8@x': {
				length:     [3, 3],
				known:      asNaAwares(IntervalTop, IntervalTop, IntervalTop),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});

	test('nested while loop with vector concatenation triggers widening', async() => {
		const code = `
			result <- c()
			j <- 1
			while(j <= 3) {
				x <- c(1, 2)
				i <- 1
				while(i <= j) {
					x <- c(x, i)
					i <- i + 1
				}
				print(x)
				result <- c(result, x)
				j <- j + 1
			}
			print(result)
		`;
		const expected = {
			'15@result': {
				length:     [0, +Infinity],
				known:      asNaAwares(),
				summary:    asNaAware([1, 3]),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);

		const expected2 = {
			'11@x': {
				length:     [2, +Infinity],
				known:      asNaAwares([1, 1], [2, 2]),
				summary:    asNaAwareWithNA([1, +Infinity]),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected2);
	});

	test('while loop with NA propagation and widening', async() => {
		const code = `
			x <- c(1, NA, 3)
			i <- 10
			while(i <= 5) {
				x <- c(x, i, NA)
				i <- i + 1
			}
			print(x)
		`;
		const expected = {
			'8@x': {
				length:     [3, +Infinity],
				known:      asNaAwares([1, 1], NaInterval, [3, 3]),
				summary:    asNaAwareWithNA([10, +Infinity]),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
	});

	test.skip('while loop with uncertain condition triggers widening', async() => {
		const code = `
			x <- c(1, 2, 3, 4, 5, 6, 7, 8)
			i <- 100
			while(runif(1)) {
				if(runif(1)) {
					x <- c(x, i)
				} else {
					x <- x[c(TRUE, FALSE)]
				}
				i <- i + 1
			}
			print(x)
		`;
		const expected = {
			'12@x': {
				length:     [2, +Infinity],
				known:      asNaAwares([1, 1], [2, 2]),
				summary:    asNaAware([1, 20]),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
	});

	test('widening produces sound over-approximation for vector arithmetic in loop', async() => {
		// This test verifies that widening produces a sound result when
		// vector arithmetic is performed inside a loop.
		const code = `
			x <- c(1, 2, 3)
			i <- 1
			while(i <= 5) {
				x <- x + i
				i <- i + 1
			}
		`;
		// The vector length stays constant at 3, but values grow each iteration.
		// After widening, values should be over-approximated to unbounded intervals.
		const expected = {
			'5@x': {
				length:     [3, 3],
				known:      asNaAwares([2, +Infinity], [3, +Infinity], [4, +Infinity]),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
		// await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});

	test('widening with vector type uncertainty in loop', async() => {
		const code = `
			x <- c(1, 2, 3)
			i <- 1
			while(i <= 5) {
				if(runif(1) > 0.5) {
					x <- c(x, i)
				}
				i <- i + 1
			}
		`;
		// After widening, length is unbounded, type remains double.
		const expected = {
			'6@x': {
				length:     [3, +Infinity],
				known:      asNaAwares([1, 1], [2, 2], [3, 3]),
				summary:    asNaAware([1, 5]),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
	});
}));
