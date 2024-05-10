import type { NodeId, ParentInformation, RFunctionArgument, RSymbol } from '../../r-bridge'
import type { DataflowProcessorInformation } from '../processor'
import { ExitPointType } from '../info'
import type { DataflowInformation  } from '../info'
import { processKnownFunctionCall } from '../internal/process/functions/call/known-call-handling'
import { EdgeType } from '../graph'
import { processSourceCall } from '../internal/process/functions/call/built-in/built-in-source'
import { processAccess } from '../internal/process/functions/call/built-in/built-in-access'
import { processIfThenElse } from '../internal/process/functions/call/built-in/built-in-if-then-else'
import { processAssignment } from '../internal/process/functions/call/built-in/built-in-assignment'
import { processSpecialBinOp } from '../internal/process/functions/call/built-in/built-in-logical-bin-op'
import { processPipe } from '../internal/process/functions/call/built-in/built-in-pipe'
import { processForLoop } from '../internal/process/functions/call/built-in/built-in-for-loop'
import { processRepeatLoop } from '../internal/process/functions/call/built-in/built-in-repeat-loop'
import { processWhileLoop } from '../internal/process/functions/call/built-in/built-in-while-loop'
import type { Identifier, IdentifierDefinition, IdentifierReference } from './identifier'
import { guard } from '../../util/assert'
import { processReplacementFunction } from '../internal/process/functions/call/built-in/built-in-replacement'
import { processQuote } from '../internal/process/functions/call/built-in/built-in-quote'
import { processFunctionDefinition } from '../internal/process/functions/call/built-in/built-in-function-definition'
import { processExpressionList } from '../internal/process/functions/call/built-in/built-in-expression-list'
import { processGet } from '../internal/process/functions/call/built-in/built-in-get'

export const BuiltIn = 'built-in'

export type BuiltInIdentifierProcessor = <OtherInfo>(
	name:   RSymbol<OtherInfo & ParentInformation>,
	args:   readonly RFunctionArgument<OtherInfo & ParentInformation>[],
	rootId: NodeId,
	data:   DataflowProcessorInformation<OtherInfo & ParentInformation>,
) => DataflowInformation

export type BuiltInIdentifierProcessorWithConfig<Config> = <OtherInfo>(
	name:   RSymbol<OtherInfo & ParentInformation>,
	args:   readonly RFunctionArgument<OtherInfo & ParentInformation>[],
	rootId: NodeId,
	data:   DataflowProcessorInformation<OtherInfo & ParentInformation>,
	config: Config
) => DataflowInformation

export interface BuiltInIdentifierDefinition extends IdentifierReference {
	kind:      'built-in-function'
	definedAt: typeof BuiltIn
	processor: BuiltInIdentifierProcessor
}

export interface BuiltInIdentifierConstant<T = unknown> extends IdentifierReference {
	kind:      'built-in-value'
	definedAt: typeof BuiltIn
	value:     T
}

function defaultBuiltInProcessor<OtherInfo>(
	name: RSymbol<OtherInfo & ParentInformation>,
	args: readonly RFunctionArgument<OtherInfo & ParentInformation>[],
	rootId: NodeId,
	data: DataflowProcessorInformation<OtherInfo & ParentInformation>,
	config: { returnsNthArgument?: number | 'last', cfg?: ExitPointType, readAllArguments?: boolean }
): DataflowInformation {
	const { information: res, processedArguments } = processKnownFunctionCall({ name, args, rootId, data })
	if(config.returnsNthArgument !== undefined) {
		const arg = config.returnsNthArgument === 'last' ? processedArguments[args.length - 1] : processedArguments[config.returnsNthArgument]
		if(arg !== undefined) {
			res.graph.addEdge(rootId, arg.entryPoint, { type: EdgeType.Returns })
		}
	}
	if(config.readAllArguments) {
		for(const arg of processedArguments) {
			if(arg) {
				res.graph.addEdge(rootId, arg.entryPoint, { type: EdgeType.Reads })
			}
		}
	}

	if(config.cfg !== undefined) {
		res.exitPoints = [...res.exitPoints, { type: config.cfg, nodeId: rootId, controlDependencies: data.controlDependencies }]
	}
	return res
}

export function registerBuiltInFunctions<Config, Proc extends BuiltInIdentifierProcessorWithConfig<Config>>(
	processor: Proc,
	config: Config,
	...names: readonly Identifier[]
): void {
	for(const name of names) {
		guard(!BuiltInMemory.has(name), `Built-in ${name} already defined`)
		BuiltInMemory.set(name, [{
			kind:                'built-in-function',
			definedAt:           BuiltIn,
			controlDependencies: undefined,
			processor:           (name, args, rootId, data) => processor(name, args, rootId, data, config),
			name,
			nodeId:              BuiltIn
		}])
	}
}

/* registers all combinations of replacements */
export function registerReplacementFunctions(
	standardConfig: {makeMaybe?: boolean},
	assignments: readonly ('<-' | '<<-')[],
	...prefixes: readonly Identifier[]
): void {
	for(const assignment of assignments) {
		for(const prefix of prefixes) {
			const effectiveName = `${prefix}${assignment}`
			guard(!BuiltInMemory.has(effectiveName), `Built-in ${effectiveName} already defined`)
			BuiltInMemory.set(effectiveName, [{
				kind:                'built-in-function',
				definedAt:           BuiltIn,
				processor:           (name, args, rootId, data) => processReplacementFunction(name, args, rootId, data, { ...standardConfig, assignmentOperator: assignment }),
				name:                effectiveName,
				controlDependencies: undefined,
				nodeId:              BuiltIn
			}])
		}
	}
}


function registerSimpleFunctions(...names: readonly Identifier[]): void {
	registerBuiltInFunctions(defaultBuiltInProcessor, { readAllArguments: true }, ...names)
}

function registerBuiltInConstant<T>(name: Identifier, value: T): void {
	guard(!BuiltInMemory.has(name), `Built-in ${name} already defined`)
	BuiltInMemory.set(name, [{
		kind:                'built-in-value',
		definedAt:           BuiltIn,
		controlDependencies: undefined,
		value,
		name,
		nodeId:              BuiltIn
	}])
}

export const BuiltInMemory = new Map<Identifier, IdentifierDefinition[]>()

registerBuiltInConstant('NULL', null)
registerBuiltInConstant('NA', null)
registerBuiltInConstant('TRUE', true)
registerBuiltInConstant('T', true)
registerBuiltInConstant('FALSE', false)
registerBuiltInConstant('F', false)
registerSimpleFunctions('~', '+', '-', '*', '/', '^', '!', '?', '**', '==', '!=', '>', '<', '>=', '<=', '%%', '%/%', '%*%', ':', 'list')
registerBuiltInFunctions(defaultBuiltInProcessor,   {},                                                   'cat', 'switch') /* returns null */
registerBuiltInFunctions(defaultBuiltInProcessor,   { returnsNthArgument: 0 },                            'print', '(')
registerBuiltInFunctions(defaultBuiltInProcessor,   { returnsNthArgument: 0, cfg: ExitPointType.Return }, 'return')
registerBuiltInFunctions(defaultBuiltInProcessor,   { cfg: ExitPointType.Break },                         'break')
registerBuiltInFunctions(defaultBuiltInProcessor,   { cfg: ExitPointType.Next },                          'next')
registerBuiltInFunctions(processExpressionList,     {},                                                   '{')
registerBuiltInFunctions(processSourceCall,         {},                                                   'source')
registerBuiltInFunctions(processAccess,             { treatIndicesAsString: false },                      '[', '[[')
registerBuiltInFunctions(processAccess,             { treatIndicesAsString: true },                       '$', '@')
registerBuiltInFunctions(processIfThenElse,         {},                                                   'if')
registerBuiltInFunctions(processGet,                {},                                                   'get')
registerBuiltInFunctions(processAssignment,         {},                                                   '<-', ':=', '=', 'assign')
registerBuiltInFunctions(processAssignment,         { quoteSource: true },                                'delayedAssign')
registerBuiltInFunctions(processAssignment,         { superAssignment: true },                            '<<-')
registerBuiltInFunctions(processAssignment,         { swapSourceAndTarget: true },                        '->')
registerBuiltInFunctions(processAssignment,         { superAssignment: true, swapSourceAndTarget: true }, '->>')
registerBuiltInFunctions(processSpecialBinOp,       { lazy: true },                                       '&&', '||', '&', '|')
registerBuiltInFunctions(processPipe,               {},                                                   '|>')
registerBuiltInFunctions(processFunctionDefinition, {},                                                   'function', '\\')
registerBuiltInFunctions(processQuote,              { quoteArgumentsWithIndex: 0 },                       'quote', 'substitute', 'bquote')
registerBuiltInFunctions(processForLoop,            {},                                                   'for')
registerBuiltInFunctions(processRepeatLoop,         {},                                                   'repeat')
registerBuiltInFunctions(processWhileLoop,          {},                                                   'while')
/* they are all mapped to `<-` but we separate super assignments */
registerReplacementFunctions({ makeMaybe: true },  ['<-', '<<-'], '[', '[[', '$', '@', 'names', 'dimnames', 'attributes', 'attr', 'class', 'levels', 'rownames', 'colnames')