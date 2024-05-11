import { assert } from 'chai'
import { summarizeSlicerStats } from '../../../src/benchmark/summarizer/first-phase/process'
import { BenchmarkSlicer } from '../../../src/benchmark/slicer'
import { stats2string } from '../../../src/benchmark/stats/print'
import { CommonSlicerMeasurements, PerSliceMeasurements } from '../../../src/benchmark/stats/stats'

async function retrieveStatsSafe(slicer: BenchmarkSlicer, request: { request: string; content: string }) {
	const { stats: rawStats } = slicer.finish()
	const stats = await summarizeSlicerStats(rawStats)
	const statInfo = stats2string(stats)

	assert.strictEqual(stats.request, request, statInfo)
	assert.sameMembers([...stats.commonMeasurements.keys()], [...CommonSlicerMeasurements], `Must have all keys in common measurements ${statInfo}`)
	assert.sameMembers([...stats.perSliceMeasurements.measurements.keys()], [...PerSliceMeasurements], `Must have all keys in per-slice measurements ${statInfo}`)
	return { stats, statInfo }
}

describe('Benchmark Slicer', () => {
	describe('Stats by parsing text-based inputs', function() {
		this.timeout('15min')
		it('Simple slice for simple line', async() => {
			const slicer = new BenchmarkSlicer()
			const request = { request: 'text' as const, content: 'a <- b' }
			await slicer.init(request)
			await slicer.slice('1@a')
			const { stats, statInfo } = await retrieveStatsSafe(slicer, request)

			assert.deepStrictEqual(stats.input, {
				numberOfLines:                   1,
				numberOfCharacters:              6,
				numberOfNonWhitespaceCharacters: 4,
				numberOfRTokens:                 6,
				numberOfNormalizedTokens:        4  // root expression list, assignment, lhs, rhs
			}, statInfo)
			assert.deepStrictEqual(stats.dataflow, {
				numberOfNodes:               3,  // the defined variable, the reading ref, and the call
				numberOfEdges:               5,  // the defined-by edge and the arguments
				numberOfCalls:               1,  // `<-`
				numberOfFunctionDefinitions: 0   // no definitions
			}, statInfo)

			assert.strictEqual(stats.perSliceMeasurements.numberOfSlices, 1, `sliced only once ${statInfo}`)

			assert.deepStrictEqual(stats.perSliceMeasurements.sliceSize, {
				// only one entry
				normalizedTokens:        { min: 4, max: 4, median: 4, mean: 4, std: 0, total: 4 },
				characters:              { min: 6, max: 6, median: 6, mean: 6, std: 0, total: 6 },
				nonWhitespaceCharacters: { min: 4, max: 4, median: 4, mean: 4, std: 0, total: 4 },
				dataflowNodes:           { min: 3, max: 3, median: 3, mean: 3, std: 0, total: 3 },
				tokens:                  { min: 6, max: 6, median: 6, mean: 6, std: 0, total: 6 },
				lines:                   { min: 1, max: 1, median: 1, mean: 1, std: 0, total: 1 },
				autoSelected:            { min: 0, max: 0, median: 0, mean: 0, std: 0, total: 0 }
			}, `sliced only once ${statInfo}`)

			assert.deepStrictEqual(stats.perSliceMeasurements.sliceCriteriaSizes, {
				min:    1,
				max:    1,
				median: 1,
				mean:   1,
				std:    0,
				total:  1
			})

		})
		it('Slicing the same code three times', async() => {
			const slicer = new BenchmarkSlicer()
			const request = {
				request: 'text' as const,
				content: `library(x)
a <- 3
b <- a + 4
c <- 5
d <- b + 5
cat(c, d)
cat(d)`
			}
			await slicer.init(request)
			await slicer.slice('2@a')
			await slicer.slice('2@a', '4@c')
			await slicer.slice('7@d')
			const { stats, statInfo } = await retrieveStatsSafe(slicer, request)

			assert.deepStrictEqual(stats.input, {
				numberOfLines:                   7,
				numberOfCharacters:              63,
				numberOfNonWhitespaceCharacters: 44,
				// checked manually
				numberOfRTokens:                 56,
				numberOfNormalizedTokens:        31
			}, statInfo)
			assert.deepStrictEqual(stats.dataflow, {
				numberOfNodes:               23,
				numberOfEdges:               38,
				numberOfCalls:               9,
				numberOfFunctionDefinitions: 0
			}, statInfo)

			assert.strictEqual(stats.perSliceMeasurements.numberOfSlices, 3, `sliced three times ${statInfo}`)

			assert.deepStrictEqual(stats.perSliceMeasurements.sliceSize, {
				// only one entry
				lines:                   { min: 2,  max: 5,  median: 3,  mean: (2+3+5)/3,          std: 1.247219128924647,  total: 10 },
				characters:              { min: 17, max: 41, median: 24, mean: 27.333333333333332, std: 10.077477638553981, total: 82 },
				nonWhitespaceCharacters: { min: 14, max: 27, median: 18, mean: 19.666666666666668, std: 5.436502143433363,  total: 59 },
				tokens:                  { min: 13, max: 35, median: 19, mean: 22.333333333333332, std: 9.285592184789413,  total: 67 },
				normalizedTokens:        { min: 8,  max: 19, median: 11, mean: (8+11+19)/3,        std: 4.642796092394707,  total: 38 },
				dataflowNodes:           { min: 3,  max: 14, median: 6,  mean: (3+6+14)/3,         std: 4.642796092394707,  total: 23 },
				autoSelected:            { min: 1,  max: 1,  median: 1,  mean: 1,                  std: 0,                  total: 3  } // always select one library statement
			}, statInfo)

			assert.deepStrictEqual(stats.perSliceMeasurements.sliceCriteriaSizes, {
				min:    1,
				max:    2,
				median: 1,
				mean:   (1+2+1)/3,
				std:    0.4714045207910317,
				total:  4
			}, statInfo)

		})
	})
})