import { PipelineExecutor } from "../core/pipeline-executor";
import { DEFAULT_ABSINT_PIPELINE } from "../core/steps/pipeline/default-pipelines";
import { NormalizedAst } from "../r-bridge/lang-4.x/ast/model/processing/decorate";

export interface Analyzer {

    domain:         true;  
    normalizedAst:  NormalizedAst | undefined;
    pipeline:       PipelineExecutor<typeof DEFAULT_ABSINT_PIPELINE>;
    analyze():      void;


}