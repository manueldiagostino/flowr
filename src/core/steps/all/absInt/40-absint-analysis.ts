import type { DeepReadonly } from 'ts-essentials';
import type { IPipelineStep } from '../../pipeline-step';
import { PipelineStepStage } from '../../pipeline-step';
import { internalPrinter, StepOutputFormat } from '../../../print/print';
import type { NormalizedAst } from '../../../../r-bridge/lang-4.x/ast/model/processing/decorate';
import { executeAbsInt } from '../../../../absInt/execute-abs-int';

export interface AbsInteRequiredInput {
	readonly domain: string,
}

function processor(results: { normalize?: NormalizedAst }, input : Partial<AbsInteRequiredInput>) {
	return executeAbsInt(results.normalize as NormalizedAst, input.domain as string);
}

export const ABSINT_ANALYSIS = {
	name:              'absInt',
	humanReadableName: 'absInt',
	description:       'Abstract interpretation analysis',
	processor,
	executed:          PipelineStepStage.OncePerRequest,
	dependencies:		    [ 'normalize' ],
	printer:           {
		[StepOutputFormat.Internal]: internalPrinter,
	},
	requiredInput: undefined as unknown as AbsInteRequiredInput
} as const satisfies DeepReadonly<IPipelineStep<'absInt', typeof processor>>;