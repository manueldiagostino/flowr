import type { DeepReadonly } from 'ts-essentials';
import type { IPipelineStep } from '../../pipeline-step';
import { PipelineStepStage } from '../../pipeline-step';
import { internalPrinter, StepOutputFormat } from '../../../print/print';

function processor() {
	return 'ciao';
}

export const ABSINT_ANALYSIS = {
	name:              'absInt',
	humanReadableName: 'absInt',
	description:       'Abstract interpretation analysis',
	executed:          PipelineStepStage.OncePerRequest,
	processor,
	dependencies:      [],
	printer:           {
		[StepOutputFormat.Internal]: internalPrinter,
		[StepOutputFormat.Json]:     JSON.stringify,
	},
	requiredInput: {},
} as const satisfies DeepReadonly<IPipelineStep<'absInt', typeof processor>>;
