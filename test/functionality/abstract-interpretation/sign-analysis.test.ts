import { describe, it, expect } from 'vitest';
import { RShell } from '../../../src/r-bridge/shell';
import { PipelineExecutor } from '../../../src/core/pipeline-executor';
import { DEFAULT_ABSINT_PIPELINE } from '../../../src/core/steps/pipeline/default-pipelines';
import type { AbstractInterpretationResults } from '../../../src/abstract-interpretation/execute-abs-int';
import { areResultsEqual } from '../../../src/abstract-interpretation/execute-abs-int';

describe('Sign Analysis Tests', () => {

	const shell = new RShell();

	it('file from testfiles/abstract-interpretation/sign-test-1.R', async() => {
        
		const pipeline = new PipelineExecutor(DEFAULT_ABSINT_PIPELINE, {
			shell,
			domain:  'sign',
			request: { request: 'file', content: 'test/testfiles/abstract-interpretation/sign-test-1.R' },
		});

		const result = await pipeline.allRemainingSteps();
		const resultAbsInt = result.abstract_interpretation.points;

		const expected: AbstractInterpretationResults = {
			points: [
				{
					programPoint: '1,1,1,6',
					environment:  {
						x: '(0)',
					},
				},
				{
					programPoint: '2,1,2,15',
					environment:  {
						x:         '(0)',
						max_value: '(>=0)',
					},
				},
				{
					programPoint: '3,1,3,9',
					environment:  {
						x:         '(0)',
						max_value: '(>=0)',
						step:      '(>=0)',
					},
				},
				{
					programPoint: '5,1,7,1',
					environment:  {
						x:         '(>=0)',
						max_value: '(>=0)',
						step:      '(>=0)',
					},
				},
			],
		};
          
		expect(areResultsEqual({ points: resultAbsInt }, expected)).toBe(true);
	});

	it('file from testfiles/abstract-interpretation/sign-test-2.R', async() => {
        
		const pipeline = new PipelineExecutor(DEFAULT_ABSINT_PIPELINE, {
			shell,
			domain:  'sign',
			request: { request: 'file', content: 'test/testfiles/abstract-interpretation/sign-test-2.R' },
		});

		const result = await pipeline.allRemainingSteps();
		const resultAbsInt = result.abstract_interpretation.points;

		const expected: AbstractInterpretationResults = {
			points: [
				{
					programPoint: '1,1,1,6',
					environment:  {
						x: '(0)',
					},
				},
				{
					programPoint: '2,1,2,6',
					environment:  {
						x: '(0)',
						y: '(0)',
					},
				},
				{
					programPoint: '3,1,3,15',
					environment:  {
						x:         '(0)',
						y:         '(0)',
						max_value: '(>=0)',
					},
				},
				{
					programPoint: '4,1,4,9',
					environment:  {
						x:         '(0)',
						y:         '(0)',
						max_value: '(>=0)',
						step:      '(>=0)',
					},
				},
				{
					programPoint: '7,3,7,8',
					environment:  {
						x:         '(0)',
						y:         '(>=0)',
						max_value: '(>=0)',
						step:      '(>=0)',
					},
				},
				{
					programPoint: '9,3,9,9',
					environment:  {
						x:         '(0)',
						y:         '(<=0)',
						max_value: '(>=0)',
						step:      '(>=0)',
					},
				},
				{
					programPoint: '8,8,10,1',
					environment:  {
						x:         '(0)',
						y:         '(<=0)',
						max_value: '(>=0)',
						step:      '(>=0)',
					},
				},
				{
					programPoint: '6,1,10,1',
					environment:  {
						x:         '(0)',
						y:         '(TOP)',
						max_value: '(>=0)',
						step:      '(>=0)',
					},
				},
				{
					programPoint: '12,1,17,1',
					environment:  {
						x:         '(>=0)',
						y:         '(TOP)',
						max_value: '(>=0)',
						step:      '(>=0)',
					},
				},
			],
		};
          
		expect(areResultsEqual({ points: resultAbsInt }, expected)).toBe(true);
	});

	it('file from testfiles/abstract-interpretation/sign-test-3.R', async() => {
        
		const pipeline = new PipelineExecutor(DEFAULT_ABSINT_PIPELINE, {
			shell,
			domain:  'sign',
			request: { request: 'file', content: 'test/testfiles/abstract-interpretation/sign-test-3.R' },
		});

		const result = await pipeline.allRemainingSteps();
		const resultAbsInt = result.abstract_interpretation.points;

		const expected: AbstractInterpretationResults = {
			points: [
				{
					programPoint: '1,1,1,18',
					environment:  {
						outer_counter: '(>=0)',
					},
				},
				{
					programPoint: '2,1,2,18',
					environment:  {
						outer_counter: '(>=0)',
						inner_counter: '(>=0)',
					},
				},
				{
					programPoint: '3,1,3,15',
					environment:  {
						outer_counter: '(>=0)',
						inner_counter: '(>=0)',
						threshold:     '(<=0)',
					},
				},
				{
					programPoint: '4,1,4,9',
					environment:  {
						outer_counter: '(>=0)',
						inner_counter: '(>=0)',
						threshold:     '(<=0)',
						step:          '(>=0)',
					},
				},
				{
					programPoint: '5,1,5,11',
					environment:  {
						outer_counter: '(>=0)',
						inner_counter: '(>=0)',
						threshold:     '(<=0)',
						step:          '(>=0)',
						limit:         '(>=0)',
					},
				},
				{
					programPoint: '7,1,23,1',
					environment:  {
						outer_counter: '(>=0)',
						inner_counter: '(>=0)',
						threshold:     '(<=0)',
						step:          '(>=0)',
						limit:         '(>=0)',
						a:             '(>=0)',
						b:             '(<=0)',
					},
				},
			],
		};
          
		expect(areResultsEqual({ points: resultAbsInt }, expected)).toBe(true);
	});

	it('file from testfiles/abstract-interpretation/sign-test-4.R', async() => {
        
		const pipeline = new PipelineExecutor(DEFAULT_ABSINT_PIPELINE, {
			shell,
			domain:  'sign',
			request: { request: 'file', content: 'test/testfiles/abstract-interpretation/sign-test-4.R' },
		});

		const result = await pipeline.allRemainingSteps();
		const resultAbsInt = result.abstract_interpretation.points;

		const expected: AbstractInterpretationResults = {
			points: [
				{
					'programPoint': '1,1,1,18',
					'environment':  {
						'outer_counter': '(0)'
					}
				},
				{
					'programPoint': '2,1,2,19',
					'environment':  {
						'outer_counter': '(0)',
						'inner_counter': '(<=0)'
					}
				},
				{
					'programPoint': '3,1,3,16',
					'environment':  {
						'outer_counter': '(0)',
						'inner_counter': '(<=0)',
						'threshold':     '(<=0)'
					}
				},
				{
					'programPoint': '4,1,4,9',
					'environment':  {
						'outer_counter': '(0)',
						'inner_counter': '(<=0)',
						'threshold':     '(<=0)',
						'step':          '(>=0)'
					}
				},
				{
					'programPoint': '5,1,5,10',
					'environment':  {
						'outer_counter': '(0)',
						'inner_counter': '(<=0)',
						'threshold':     '(<=0)',
						'step':          '(>=0)',
						'limit':         '(>=0)'
					}
				},
				{
					'programPoint': '7,1,19,1',
					'environment':  {
						'outer_counter': '(>=0)',
						'inner_counter': '(TOP)',
						'threshold':     '(<=0)',
						'step':          '(>=0)',
						'limit':         '(>=0)'
					}
				}
			],
		};
          
		expect(areResultsEqual({ points: resultAbsInt }, expected)).toBe(true);
	});

});