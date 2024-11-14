import { DeepReadonly } from "ts-essentials";
import { IPipelineStep, PipelineStepStage } from "../../pipeline-step";
import { internalPrinter, StepOutputFormat } from "../../../print/print";
import { NormalizedAst } from "../../../../r-bridge/lang-4.x/ast/model/processing/decorate";

function processor ( ) {
    return 'ciao';
}

export const ABSINT_ANALYSIS = {
    name:               'absInt', 
    humanReadableName:  'absInt', 
    description:        'Abstract interpretation analysis',
    executed:           PipelineStepStage.OncePerRequest,
    processor,
    dependencies:       [],
    printer:            {
                            [StepOutputFormat.Internal]: internalPrinter,
		                    [StepOutputFormat.Json]:     JSON.stringify,
                        },
    requiredInput:      {}
} as const satisfies DeepReadonly<IPipelineStep<'absInt', typeof processor>>;