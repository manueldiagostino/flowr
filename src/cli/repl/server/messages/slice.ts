import { SlicingCriteria } from '../../../../slicing'
import { LAST_PER_FILE_STEP, LAST_STEP, StepResults } from '../../../../core'
import { FlowrBaseMessage, RequestMessageDefinition } from './messages'
import Joi from 'joi'

/**
 * Can only be sent after you have sent the {@link FileAnalysisRequestMessage}.
 * Using the same `filetoken` as in the {@link FileAnalysisRequestMessage} you
 * can slice the respective file given the respective criteria.
 */
export interface SliceRequestMessage extends FlowrBaseMessage {
	type:      'request-slice',
	/** The {@link FileAnalysisRequestMessage#filetoken} of the file/data to slice */
	filetoken: string,
	/** The slicing criteria to use */
	criterion: SlicingCriteria
}

export interface SliceResponseMessage extends FlowrBaseMessage {
	type:    'response-slice',
	/** only contains the results of the slice steps to not repeat ourselves */
	results: Omit<StepResults<typeof LAST_STEP>, keyof StepResults<typeof LAST_PER_FILE_STEP>>
}

export const requestSliceMessage: RequestMessageDefinition<SliceRequestMessage> = {
	type:   'request-slice',
	schema: Joi.object({
		type:      Joi.string().valid('request-slice').required(),
		id:        Joi.string().optional(),
		filetoken: Joi.string().required(),
		criterion: Joi.array().items(Joi.string().regex(/\d+:\d+|\d+@.*|\$\d+/)).min(0).required()
	})
}
