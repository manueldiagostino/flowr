import { internalPrinter, StepOutputFormat } from '../../print/print'
import { IStep, StepHasToBeExecuted } from '../step'
import { autoSelectLibrary, AutoSelectPredicate, reconstructToCode, SliceResult } from '../../../slicing'
import { DeepReadonly } from 'ts-essentials'
import { NormalizedAst } from '../../../r-bridge'
import { SliceRequiredInput } from './30-slice'
import { guard } from '../../../util/assert'

export const ReconstructRequiredInput = {
	...SliceRequiredInput,
	/** If you want to auto-select something in the reconstruction add it here, otherwise, it will use the default defined alongside {@link reconstructToCode}*/
	autoSelectIf: autoSelectLibrary as AutoSelectPredicate
} as const

export const NAIVE_RECONSTRUCT = {
	name:        'reconstruct',
	description: 'Reconstruct R code from the static slice',
	processor:   (results: { normalize?: NormalizedAst, slice?: SliceResult }, input: Partial<typeof ReconstructRequiredInput>) => {
		guard(results.normalize !== undefined && results.slice !== undefined, 'Required input not provided')
		return reconstructToCode(results.normalize, results.slice.result, input.autoSelectIf)
	},
	executed: StepHasToBeExecuted.OncePerRequest,
	printer:  {
		[StepOutputFormat.Internal]: internalPrinter
	},
	dependencies:  [ 'slice' ],
	requiredInput: ReconstructRequiredInput
} as const satisfies DeepReadonly<IStep<'reconstruct', (results: { normalize?: NormalizedAst, slice?: SliceResult }, input: Partial<typeof ReconstructRequiredInput>) => ReturnType<typeof reconstructToCode>>>
