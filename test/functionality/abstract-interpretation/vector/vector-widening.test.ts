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
	type TestCase
} from '../_helper/vector-assertion-helpers';
import './log-config';

describe.sequential('Vector Widening', withShell(shell => {
	test('while loop with growing vector triggers widening', async() => {
		// This while loop appends to vector x on each iteration.
		// The vector grows: [1,2,3] -> [1,2,3,1] -> [1,2,3,1,2] -> ...
		// After widening (threshold=4 visits), the length becomes unbounded.
		const code = `
			x <- c(1, 2, 3)
			i <- 1
			while(i <= 5) {
				x <- c(x, i)
				i <- i + 1
			}
		`;
		// After widening, the analysis should produce a sound over-approximation:
		// - Length: starts at 3, grows each iteration -> [3, +Infinity]
		// - Known values: initial positions [1,1], [2,2], [3,3] are preserved
		// - Summary: captures values from appended elements -> [1, 5] (i ranges from 1 to 5)
		// - Type: remains 'double'
		const expected = {
			'5@x': {
				length:     [3, +Infinity],
				known:      asNaAwares([1, 1], [2, 2], [3, 3]),
				summary:    asNaAware([1, 5]),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});

	test('while loop with vector element modification triggers widening', async() => {
		// This loop modifies vector elements in place, with values growing each iteration.
		// x[i] <- x[i] + 1 causes values to grow: 1->2->3->..., 2->3->4->..., etc.
		// Widening should produce unbounded intervals for the values.
		const code = `
			x <- c(1, 2, 3)
			i <- 1
			while(i <= 3) {
				x[i] <- x[i] + 1
				i <- i + 1
			}
		`;
		// After widening, values should be over-approximated to unbounded intervals
		// since they grow without bound in the abstract interpretation.
		const expected = {
			'5@x': {
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
		// Nested loops that concatenate vectors should trigger widening in the outer loop.
		// The inner loop creates a growing vector, and the outer loop concatenates results.
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
				result <- c(result, x)
				j <- j + 1
			}
		`;
		// After widening, result vector length should be unbounded
		// and summary should capture the range of values being appended.
		const expected = {
			'10@result': {
				length:     [0, +Infinity],
				known:      asNaAwares(),
				summary:    asNaAware([1, 3]),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
	});

	test('while loop with NA propagation and widening', async() => {
		// This loop introduces NA values and grows the vector.
		// Widening should handle both the growing length and NA propagation.
		const code = `
			x <- c(1, NA, 3)
			i <- 1
			while(i <= 5) {
				x <- c(x, i, NA)
				i <- i + 1
			}
		`;
		// After widening:
		// - Length: starts at 3, grows by 2 each iteration -> [3, +Infinity]
		// - Known: initial positions preserved with NA at position 2
		// - Summary: captures appended values [1,5] with NA flag
		const expected = {
			'5@x': {
				length:     [3, +Infinity],
				known:      asNaAwares([1, 1], NaInterval, [3, 3]),
				summary:    asNaAware([1, 5]),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
	});

	test('while loop with uncertain condition triggers widening', async() => {
		// Using runif() creates an uncertain loop condition, forcing the analysis
		// to consider both branches and apply widening more aggressively.
		const code = `
			x <- c(1, 2)
			i <- 1
			while(runif(1) > 0.1 && i <= 10) {
				if(runif(1) > 0.5) {
					x <- c(x, i)
				} else {
					x <- c(x, i * 2)
				}
				i <- i + 1
			}
		`;
		// With uncertain branching, the analysis must over-approximate:
		// - Length: starts at 2, may or may not grow -> [2, +Infinity]
		// - Known: initial positions preserved
		// - Summary: captures both branches: i ranges [1,10], i*2 ranges [2,20] -> [1, 20]
		const expected = {
			'9@x': {
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
				known:      asNaAwares(IntervalTop, IntervalTop, IntervalTop),
				summary:    asNaAware(Bottom),
				attributes: VectorAttrEmpty,
				type:       'double'
			},
		} satisfies TestCase<IntervalDomain>;
		await assertVectorDomainSound(shell, code, expected);
		await validateVectorDomainIntervals(shell, code, Record.keys(expected));
	});

	test('widening with vector type uncertainty in loop', async() => {
		// Loop that could potentially change vector type through uncertain branching.
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
