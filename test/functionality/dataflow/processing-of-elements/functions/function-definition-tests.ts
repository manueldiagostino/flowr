import { assertDataflow, withShell } from '../../../_helper/shell'
import { BuiltIn, EdgeType, initializeCleanEnvironments } from '../../../../../src/dataflow'
import {
	define,
	popLocalEnvironment,
	pushLocalEnvironment
} from '../../../../../src/dataflow/environments'
import { UnnamedArgumentPrefix } from '../../../../../src/dataflow/internal/process/functions/argument'
import { GlobalScope, LocalScope } from '../../../../../src/dataflow/environments/scopes'
import { emptyGraph } from '../../../_helper/dataflowgraph-builder'

describe('Function Definition', withShell(shell => {
	describe('Only functions', () => {
		assertDataflow('unknown read in function', shell, 'function() { x }',
			emptyGraph()
				.addVertex({
					tag:        'function-definition',
					id:         '2',
					name:       '2',
					scope:      LocalScope,
					when:       'always',
					exitPoints: ['0'],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [{ nodeId: '0', used: 'always', name: 'x', scope: LocalScope }],
						scope:             LocalScope,
						graph:             new Set(['0']),
						environments:      pushLocalEnvironment(initializeCleanEnvironments())
					}
				}).addVertex({
					tag:         'use',
					id:          '0',
					name:        'x',
					environment: pushLocalEnvironment(initializeCleanEnvironments()),
					when:        'always'
				}, false)
		)

		const envWithXDefined = define(
			{ nodeId: '0', scope: 'local', name: 'x', used: 'always', kind: 'parameter', definedAt: '1' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments()))
		assertDataflow('read of parameter', shell, 'function(x) { x }',
			emptyGraph()
				.addVertex({
					tag:        'function-definition',
					id:         '4',
					name:       '4',
					scope:      LocalScope,
					when:       'always',
					exitPoints: ['2'],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['0', '2']),
						environments:      envWithXDefined
					}
				})
				.addVertex({
					tag:         'variable-definition',
					id:          '0',
					name:        'x',
					environment: pushLocalEnvironment(initializeCleanEnvironments()),
					scope:       LocalScope,
					when:        'always'
				}, false)
				.addVertex({
					tag:         'use',
					id:          '2',
					name:        'x',
					environment: envWithXDefined,
					when:        'always'
				}, false)
				.reads('2', '0')
		)
		assertDataflow('read of parameter in return', shell, 'function(x) { return(x) }',
			emptyGraph()
				.addVertex({
					tag:        'function-definition',
					id:         '7',
					name:       '7',
					scope:      LocalScope,
					when:       'always',
					exitPoints: ['5'],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['4', '5', '3', '0']),
						environments:      envWithXDefined
					}
				}).addVertex({
					tag:         'variable-definition',
					id:          '0',
					name:        'x',
					environment: pushLocalEnvironment(initializeCleanEnvironments()),
					scope:       LocalScope,
					when:        'always'
				}, false)
				.uses('3', 'x', 'always', envWithXDefined, false)
				.addVertex({
					tag:         'function-call',
					id:          '5',
					name:        'return',
					environment: envWithXDefined,
					when:        'always',
					args:        [{ nodeId: '4', used: 'always', name: `${UnnamedArgumentPrefix}4`, scope: LocalScope }]
				}, false)
				.addVertex({
					tag:         'use',
					id:          '4',
					name:        `${UnnamedArgumentPrefix}4`,
					environment: envWithXDefined,
					when:        'always',
				}, false)
				.reads('5', BuiltIn)
				.addEdge('5', BuiltIn, EdgeType.Calls, 'always')
				.reads('3', '0')
				.addEdge('5', '4', EdgeType.Argument, 'always')
				.addEdge('5', '4', EdgeType.Returns, 'always')
				.reads('4', '3')
		)

		describe('x', () => {
			assertDataflow('return parameter named', shell, 'function(x) { return(x=x) }',
				emptyGraph()
					.addVertex({
						tag:        'function-definition',
						id:         '8',
						name:       '8',
						scope:      LocalScope,
						when:       'always',
						exitPoints: ['6'],
						subflow:    {
							out:               [],
							unknownReferences: [],
							in:                [],
							scope:             LocalScope,
							graph:             new Set(['5', '6', '4', '0']),
							environments:      envWithXDefined
						}
					}).addVertex({
						tag:         'variable-definition',
						id:          '0',
						name:        'x',
						environment: pushLocalEnvironment(initializeCleanEnvironments()),
						scope:       LocalScope,
						when:        'always'
					}, false)
					.addVertex({
						tag:         'use',
						id:          '4',
						name:        'x',
						environment: envWithXDefined,
						when:        'always'
					}, false)
					.addVertex({
						tag:         'function-call',
						id:          '6',
						name:        'return',
						environment: envWithXDefined,
						when:        'always',
						args:        [['x', { nodeId: '5', used: 'always', name: 'x', scope: LocalScope }]]
					}, false)
					.addVertex({
						tag:         'use',
						id:          '5',
						name:        'x',
						environment: envWithXDefined,
						when:        'always',
					}, false)
					.reads('6', BuiltIn)
					.addEdge('6', BuiltIn, EdgeType.Calls, 'always')
					.reads('4', '0')
					.addEdge('6', '5', EdgeType.Argument, 'always')
					.addEdge('6', '5', EdgeType.Returns, 'always')
					.reads('5', '4')
			)
		})

		const envWithoutParams = pushLocalEnvironment(initializeCleanEnvironments())
		const envWithXParam = define(
			{ nodeId: '0', scope: 'local', name: 'x', used: 'always', kind: 'parameter', definedAt: '1' },
			LocalScope,
			envWithoutParams
		)
		const envWithXYParam = define(
			{ nodeId: '2', scope: 'local', name: 'y', used: 'always', kind: 'parameter', definedAt: '3' },
			LocalScope,
			envWithXParam
		)
		const envWithXYZParam = define(
			{ nodeId: '4', scope: 'local', name: 'z', used: 'always', kind: 'parameter', definedAt: '5' },
			LocalScope,
			envWithXYParam
		)

		assertDataflow('read of one parameter', shell, 'function(x,y,z) y',
			emptyGraph()
				.addVertex({
					tag:        'function-definition',
					id:         '8',
					name:       '8',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '6' ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['0','2', '4', '6']),
						environments:      envWithXYZParam
					}
				})
				.definesVariable('0', 'x', LocalScope, 'always', envWithoutParams, false)
				.definesVariable('2', 'y', LocalScope, 'always', envWithXParam, false)
				.definesVariable('4', 'z', LocalScope, 'always', envWithXYParam, false)
				.uses('6', 'y', 'always', envWithXYZParam, false)
				.reads('6', '2')
		)
	})
	describe('Scoping of body', () => {
		assertDataflow('previously defined read in function', shell, 'x <- 3; function() { x }',
			emptyGraph()
				.definesVariable('0', 'x')
				.addVertex({
					tag:        'function-definition',
					id:         '5',
					name:       '5',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '3' ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [ { nodeId: '3', scope: LocalScope, name: 'x', used: 'always' } ],
						scope:             LocalScope,
						graph:             new Set(['3']),
						environments:      pushLocalEnvironment(initializeCleanEnvironments())
					}
				})
				.uses('3', 'x', 'always', pushLocalEnvironment(initializeCleanEnvironments()), false)
		)
		const envWithXDefined = define(
			{nodeId: '0', scope: 'local', name: 'x', used: 'always', kind: 'variable', definedAt: '2' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments()))

		assertDataflow('local define with <- in function, read after', shell, 'function() { x <- 3; }; x',
			emptyGraph()
				.uses('5', 'x')
				.addVertex({
					tag:        'function-definition',
					id:         '4',
					name:       '4',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '2' /* the assignment */ ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['0']),
						environments:      envWithXDefined
					}
				})
				.definesVariable('0', 'x', LocalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()), false)
				.addVertex({ tag: 'exit-point', id: '2', name: '<-', when: 'always', environment: envWithXDefined }, false)
				.addEdge('2', '0', EdgeType.Relates, 'always')
		)
		assertDataflow('local define with = in function, read after', shell, 'function() { x = 3; }; x',
			emptyGraph()
				.uses('5', 'x')
				.addVertex({
					tag:        'function-definition',
					id:         '4',
					name:       '4',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '2', ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['0']),
						environments:      envWithXDefined
					}
				})
				.definesVariable('0', 'x', LocalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()), false)
				.addVertex({ tag: 'exit-point', id: '2', name: '=', when: 'always', environment: envWithXDefined }, false)
				.addEdge('2', '0', EdgeType.Relates, 'always')
		)

		const envWithXDefinedR = define(
			{nodeId: '1', scope: 'local', name: 'x', used: 'always', kind: 'variable', definedAt: '2' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments()))
		assertDataflow('local define with -> in function, read after', shell, 'function() { 3 -> x; }; x',
			emptyGraph()
				.uses('5', 'x')
				.addVertex({
					tag:        'function-definition',
					id:         '4',
					name:       '4',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '2' ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['1']),
						environments:      envWithXDefinedR
					}
				})
				.definesVariable('1', 'x', LocalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()), false)
				.addVertex({ tag: 'exit-point', id: '2', name: '->', when: 'always', environment: envWithXDefinedR }, false)
				.addEdge('2', '1', EdgeType.Relates, 'always')
		)
		const envWithXDefinedGlobal = define(
			{nodeId: '0', scope: GlobalScope, name: 'x', used: 'always', kind: 'variable', definedAt: '2' },
			GlobalScope,
			pushLocalEnvironment(initializeCleanEnvironments()))
		assertDataflow('global define with <<- in function, read after', shell, 'function() { x <<- 3; }; x',
			emptyGraph()
				.uses('5', 'x')
				.addVertex({
					tag:         'function-definition',
					id:          '4',
					name:        '4',
					scope:       LocalScope,
					when:        'always',
					exitPoints:  [ '2' ],
					environment: popLocalEnvironment(envWithXDefinedGlobal),
					subflow:     {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['0']),
						environments:      envWithXDefinedGlobal
					}
				})
				.definesVariable('0', 'x', GlobalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()), false)
				.addVertex({ tag: 'exit-point', id: '2', name: '<<-', when: 'always', environment: envWithXDefinedGlobal }, false)
				.addEdge('2', '0', EdgeType.Relates, 'always')
		)
		const envWithXDefinedGlobalR = define(
			{nodeId: '1', scope: GlobalScope, name: 'x', used: 'always', kind: 'variable', definedAt: '2' },
			GlobalScope,
			pushLocalEnvironment(initializeCleanEnvironments()))
		assertDataflow('global define with ->> in function, read after', shell, 'function() { 3 ->> x; }; x',
			emptyGraph()
				.uses('5', 'x')
				.addVertex({
					tag:         'function-definition',
					id:          '4',
					name:        '4',
					scope:       LocalScope,
					when:        'always',
					exitPoints:  [ '2' ],
					environment: popLocalEnvironment(envWithXDefinedGlobalR),
					subflow:     {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['1']),
						environments:      envWithXDefinedGlobalR
					}
				})
				.definesVariable('1', 'x', GlobalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()), false)
				.addVertex({ tag: 'exit-point', id: '2', name: '->>', when: 'always', environment: envWithXDefinedGlobalR }, false)
				.addEdge('2', '1', EdgeType.Relates, 'always')
		)
		const envDefXSingle = define(
			{nodeId: '3', scope: LocalScope, name: 'x', used: 'always', kind: 'variable', definedAt: '5' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments()))
		assertDataflow('shadow in body', shell, 'x <- 2; function() { x <- 3; x }; x',
			emptyGraph()
				.definesVariable('0', 'x')
				.addVertex({
					tag:         'use',
					id:          '9',
					name:        'x',
					environment: define({
						nodeId:    '0',
						definedAt: '2',
						used:      'always',
						name:      'x',
						scope:     LocalScope,
						kind:      'variable'
					}, LocalScope, initializeCleanEnvironments())
				})
				.reads('9', '0')
				.addVertex({
					tag:        'function-definition',
					id:         '8',
					name:       '8',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '6' ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['6', '3']),
						environments:      envDefXSingle
					}
				}).addVertex({
					tag:         'use',
					id:          '6',
					name:        'x',
					environment: define({ nodeId: '3', definedAt: '5', used: 'always', name: 'x', scope: LocalScope, kind: 'variable'}, LocalScope, pushLocalEnvironment(initializeCleanEnvironments())),
					when:        'always'
				}, false)
				.addVertex({
					tag:         'variable-definition',
					id:          '3',
					name:        'x',
					environment: pushLocalEnvironment(initializeCleanEnvironments()),
					scope:       LocalScope,
					when:        'always'
				}, false)
				.reads('6', '3')
		)
		assertDataflow('shadow in body with closure', shell, 'x <- 2; function() { x <- x; x }; x',
			emptyGraph()
				.definesVariable('0', 'x')
				.addVertex({
					tag:         'use',
					id:          '9',
					name:        'x',
					environment: define(
						{ nodeId: '0', scope: LocalScope, name: 'x', used: 'always', kind: 'variable', definedAt: '2' },
						LocalScope,
						initializeCleanEnvironments())
				})
				.reads('9', '0')
				.addVertex({
					tag:        'function-definition',
					id:         '8',
					name:       '8',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '6' ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [ { nodeId: '4', used: 'always', name: 'x', scope: LocalScope} ],
						scope:             LocalScope,
						graph:             new Set(['3', '4', '6']),
						environments:      envDefXSingle
					}
				}).addVertex({
					tag:         'variable-definition',
					id:          '3',
					name:        'x',
					environment: pushLocalEnvironment(initializeCleanEnvironments()),
					scope:       LocalScope,
					when:        'always'
				}, false)
				.addVertex({
					tag:         'use',
					id:          '4',
					name:        'x',
					environment: pushLocalEnvironment(initializeCleanEnvironments()),
					when:        'always'
				}, false)
				.addVertex({
					tag:         'use',
					id:          '6',
					name:        'x',
					environment: define({
						nodeId:    '3',
						scope:     LocalScope,
						name:      'x',
						used:      'always',
						kind:      'variable',
						definedAt: '5'
					}, LocalScope, pushLocalEnvironment(initializeCleanEnvironments())),
					when: 'always'
				}, false)
				.reads('6', '3')
				.addEdge('3', '4', EdgeType.DefinedBy, 'always')
		)
	})
	describe('Scoping of parameters', () => {
		const envWithXDefined = define(
			{nodeId: '3', scope: 'local', name: 'x', used: 'always', kind: 'parameter', definedAt: '4' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments()))
		assertDataflow('parameter shadows', shell, 'x <- 3; function(x) { x }',
			emptyGraph()
				.definesVariable('0', 'x')
				.addVertex({
					tag:        'function-definition',
					id:         '7',
					name:       '7',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '5' ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['3', '5']),
						environments:      envWithXDefined
					}
				})
				.definesVariable('3', 'x', LocalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()), false)
				.addVertex({
					tag:         'use',
					id:          '5',
					name:        'x',
					environment: envWithXDefined,
					when:        'always'
				}, false)
				.reads('5', '3')
		)
	})
	describe('Access dot-dot-dot', () => {
		const envWithParam = define(
			{nodeId: '0', scope: 'local', name: '...', used: 'always', kind: 'parameter', definedAt: '1' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments()))
		assertDataflow('parameter shadows', shell, 'function(...) { ..11 }',
			emptyGraph()
				.addVertex({
					tag:        'function-definition',
					id:         '4',
					name:       '4',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '2' ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['0', '2']),
						environments:      envWithParam
					}
				})
				.definesVariable('0', '...', LocalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()), false)
				.addVertex({
					tag:         'use',
					id:          '2',
					name:        '..11',
					environment: envWithParam,
					when:        'always'
				}, false)
				.reads('2', '0')
		)
	})
	describe('Using named arguments', () => {
		const envWithA = define(
			{ nodeId: '0', scope: LocalScope, name: 'a', used: 'always', kind: 'parameter', definedAt: '2' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments())
		)
		const envWithAB = define(
			{ nodeId: '3', scope: LocalScope, name: 'b', used: 'always', kind: 'parameter', definedAt: '5' },
			LocalScope,
			envWithA
		)
		assertDataflow('Read first parameter', shell, 'function(a=3, b=a) { b }',
			emptyGraph()
				.addVertex({
					tag:        'function-definition',
					id:         '8',
					name:       '8',
					exitPoints: ['6'],
					scope:      LocalScope,
					when:       'always',
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						environments:      envWithAB,
						graph:             new Set(['0', '3', '4', '6'])
					}
				}).addVertex({
					tag:         'variable-definition',
					id:          '0',
					name:        'a',
					environment: pushLocalEnvironment(initializeCleanEnvironments()),
					scope:       LocalScope,
					when:        'always'
				}, false)
				.addVertex({
					tag:         'variable-definition',
					id:          '3',
					name:        'b',
					environment: envWithA,
					scope:       LocalScope,
					when:        'always'
				}, false)
				.addVertex({ tag: 'use', id: '4', name: 'a', environment: envWithA, when: 'always' }, false)
				.addVertex({ tag: 'use', id: '6', name: 'b', environment: envWithAB, when: 'always' }, false)
				.reads('4', '0')
				.addEdge('3', '4', EdgeType.DefinedBy, 'maybe' /* default values can be overridden */)
				.reads('6', '3')
		)

		const envWithFirstParam = define(
			{ nodeId: '0', scope: LocalScope, name: 'a', used: 'always', kind: 'parameter', definedAt: '2' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments())
		)
		const envWithBothParam = define(
			{ nodeId: '3', scope: LocalScope, name: 'm', used: 'always', kind: 'parameter', definedAt: '5' },
			LocalScope,
			envWithFirstParam
		)
		const envWithBothParamFirstB = define(
			{ nodeId: '6', scope: LocalScope, name: 'b', used: 'always', kind: 'variable', definedAt: '8' },
			LocalScope,
			envWithBothParam
		)
		const envWithBothParamSecondB = define(
			{ nodeId: '10', scope: LocalScope, name: 'b', used: 'always', kind: 'variable', definedAt: '12' },
			LocalScope,
			envWithBothParam
		)
		assertDataflow('Read later definition', shell, 'function(a=b, m=3) { b <- 1; a; b <- 5; a + 1 }',
			emptyGraph()
				.addVertex({
					tag:        'function-definition',
					id:         '17',
					name:       '17',
					scope:      LocalScope,
					when:       'always',
					exitPoints: ['15'],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						environments:      envWithBothParamSecondB,
						graph:             new Set(['0', '3', '10', '6', '1', '9', '13'])
					}
				})
				.definesVariable('0', 'a', LocalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()) , false)
				.definesVariable('3', 'm', LocalScope, 'always', envWithFirstParam , false)
				.definesVariable('10', 'b', LocalScope, 'always', envWithBothParamFirstB , false)
				.definesVariable('6', 'b', LocalScope, 'always', envWithBothParam , false)
				.addVertex({ tag: 'use', id: '1', name: 'b', scope: LocalScope, when: 'always', environment: pushLocalEnvironment(initializeCleanEnvironments()) }, false)
				.addVertex({ tag: 'use', id: '9', name: 'a', scope: LocalScope, when: 'always', environment: envWithBothParamFirstB }, false)
				.addVertex({ tag: 'use', id: '13', name: 'a', scope: LocalScope, when: 'always', environment: envWithBothParamSecondB }, false)
				.addVertex({ tag: 'exit-point', id: '15', name: '+', scope: LocalScope, when: 'always', environment: envWithBothParamSecondB }, false)
				.addEdge('15', '13', EdgeType.Relates, 'always')
				.addEdge('13', '9', EdgeType.SameReadRead, 'always')
				.reads('9', '0')
				.reads('13', '0')
				.addEdge('0', '1', EdgeType.DefinedBy, 'maybe')
				.reads('1', '6')
				.addEdge('10', '6', EdgeType.SameDefDef, 'always')
		)
	})
	describe('Using special argument', () => {
		const envWithA = define(
			{ nodeId: '0', scope: LocalScope, name: 'a', used: 'always', kind: 'parameter', definedAt: '1' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments())
		)
		const envWithASpecial = define(
			{ nodeId: '2', scope: LocalScope, name: '...', used: 'always', kind: 'parameter', definedAt: '3' },
			LocalScope,
			envWithA
		)
		assertDataflow('Return ...', shell, 'function(a, ...) { foo(...) }',
			emptyGraph()
				.addVertex({
					tag:        'function-definition',
					id:         '9',
					name:       '9',
					scope:      LocalScope,
					when:       'always',
					exitPoints: ['7'],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						environments:      envWithASpecial,
						graph:             new Set(['0', '2', '5', '7', '6'])
					}
				})
				.definesVariable('0', 'a', LocalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()) , false)
				.definesVariable('2', '...', LocalScope, 'always', envWithA , false)
				.addVertex({ tag: 'use', id: '5', name: '...', scope: LocalScope, when: 'always', environment: envWithASpecial }, false)
				.addVertex({
					tag:         'function-call',
					id:          '7', name:        'foo',
					scope:       LocalScope,
					when:        'always',
					environment: envWithASpecial,
					args:        [ { nodeId: '6', name: `${UnnamedArgumentPrefix}6`, scope: LocalScope, used: 'always'  } ]
				}, false)
				.addVertex({ tag: 'use', id: '6', name: `${UnnamedArgumentPrefix}6`, when: 'always', environment: envWithASpecial }, false)
				.addEdge('7', '6', EdgeType.Argument, 'always')
				.reads('6', '5')
				.reads('5', '2')
		)
	})
	describe('Bind environment to correct exit point', () => {
		const envWithG = define(
			{ nodeId: '0', scope: LocalScope, name: 'g', used: 'always', kind: 'function', definedAt: '4' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments())
		)
		const envWithFirstY = define(
			{ nodeId: '5', scope: LocalScope, name: 'y', used: 'always', kind: 'variable', definedAt: '7' },
			LocalScope,
			envWithG
		)
		const finalEnv = define(
			{ nodeId: '15', scope: LocalScope, name: 'y', used: 'always', kind: 'variable', definedAt: '17' },
			LocalScope,
			envWithG
		)
		assertDataflow('Two possible exit points to bind y closure', shell, `function() {
  g <- function() { y }
  y <- 5
  if(z)
    return(g)
  y <- 3
  g
}`,
		emptyGraph()
			.addVertex({
				tag:        'function-definition',
				id:         '20',
				name:       '20',
				scope:      LocalScope,
				when:       'always',
				exitPoints: ['12','18'],
				subflow:    {
					out:               [],
					unknownReferences: [],
					in:                [ {nodeId: '8', name: 'z', used: 'always', scope: LocalScope} ],
					scope:             LocalScope,
					environments:      finalEnv,
					graph:             new Set(['0', '5', '15', '8', '10', '18', '11', '12', '3'])
				}
			})
			.definesVariable('0', 'g', LocalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()) , false)
			.definesVariable('5', 'y', LocalScope, 'always', envWithG , false)
			.definesVariable('15', 'y', LocalScope, 'always', envWithFirstY , false)
			.addVertex({ tag: 'use', id: '8', name: 'z', scope: LocalScope, when: 'always', environment: envWithFirstY }, false)
			.addVertex({ tag: 'use', id: '10', name: 'g', scope: LocalScope, when: 'always', environment: envWithFirstY }, false)
			.addVertex({ tag: 'use', id: '18', name: 'g', scope: LocalScope, when: 'always', environment: finalEnv }, false)
			.addVertex({ tag: 'use', id: '11', name: `${UnnamedArgumentPrefix}11`, scope: LocalScope, when: 'always', environment: envWithFirstY }, false)
			.addVertex({
				tag:         'function-call',
				id:          '12',
				name:        'return',
				scope:       LocalScope,
				when:        'maybe',
				environment: envWithFirstY,
				args:        [ { nodeId: '11', name: `${UnnamedArgumentPrefix}11`, scope: LocalScope, used: 'always'  } ]
			}, false)
			.addVertex({
				tag:         'function-definition',
				id:          '3',
				name:        '3',
				scope:       LocalScope,
				when:        'always',
				environment: pushLocalEnvironment(initializeCleanEnvironments()),
				exitPoints:  ['1'],
				subflow:     {
					out:               [],
					unknownReferences: [],
					in:                [],
					scope:             LocalScope,
					environments:      pushLocalEnvironment(pushLocalEnvironment(initializeCleanEnvironments())),
					graph:             new Set(['1'])
				}
			}, false)
			.addEdge('0', '3', EdgeType.DefinedBy, 'always')
			.reads('1', '5', 'maybe')
			.reads('1', '15', 'maybe')
			.reads('18', '0')
			.reads('10', '0')
			.reads('11', '10')
			.addEdge('12', '11', EdgeType.Argument, 'always')
			.addEdge('12', '11', EdgeType.Returns, 'always')
			.reads('12', BuiltIn, 'maybe')
			.addEdge('12', BuiltIn, EdgeType.Calls, 'maybe')
			.addEdge('5', '15', EdgeType.SameDefDef, 'always')

			.addVertex({ tag: 'use', id: '1', name: 'y', scope: LocalScope, when: 'always', environment: pushLocalEnvironment(pushLocalEnvironment(initializeCleanEnvironments())) }, false)
		)
	})
	describe('Late binding of environment variables', () => {
		assertDataflow('define after function definition', shell, 'function() { x }; x <- 3',
			emptyGraph()
				.definesVariable('3', 'x')
				.addVertex({
					tag:        'function-definition',
					id:         '2',
					name:       '2',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '0' ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [{
							nodeId: '0',
							scope:  LocalScope,
							name:   'x',
							used:   'always'
						}],
						scope:        LocalScope,
						graph:        new Set(['0']),
						environments: pushLocalEnvironment(initializeCleanEnvironments())
					}
				})
				.addVertex({
					tag:         'use',
					id:          '0',
					name:        'x',
					environment: pushLocalEnvironment(initializeCleanEnvironments()),
					when:        'always'
				}, false)
		)
	})

	describe('Nested Function Definitions', () => {
		const withXParameterInOuter = define(
			{nodeId: '1', scope: LocalScope, name: 'x', used: 'always', kind: 'function', definedAt: '9' },
			LocalScope,
			pushLocalEnvironment(initializeCleanEnvironments()))
		const withinNestedFunctionWithoutParam = pushLocalEnvironment(pushLocalEnvironment(initializeCleanEnvironments()))
		const withinNestedFunctionWithParam = define(
			{nodeId: '2', scope: LocalScope, name: 'x', used: 'always', kind: 'parameter', definedAt: '3' },
			LocalScope,
			withinNestedFunctionWithoutParam
		)
		const withinNestedFunctionWithDef = define(
			{nodeId: '4', scope: LocalScope, name: 'x', used: 'always', kind: 'variable', definedAt: '6' },
			LocalScope,
			pushLocalEnvironment(pushLocalEnvironment(initializeCleanEnvironments()))
		)
		const envWithA = define(
			{ nodeId: '0', scope: LocalScope, name: 'a', used: 'always', kind: 'function', definedAt: '13' },
			LocalScope,
			initializeCleanEnvironments()
		)
		const envWithAB = define(
			{ nodeId: '14', scope: LocalScope, name: 'b', used: 'always', kind: 'variable', definedAt: '16' },
			LocalScope,
			envWithA
		)
		assertDataflow('double nested functions', shell, 'a <- function() { x <- function(x) { x <- b }; x }; b <- 3; a',
			emptyGraph()
				.definesVariable('0', 'a')
				.addVertex( {
					tag:         'variable-definition',
					id:          '14',
					name:        'b',
					scope:       LocalScope,
					environment: envWithA
				})
				.uses('17', 'a', 'always', envWithAB)
				.reads('17', '0', 'always')
				.addVertex({
					tag:        'function-definition',
					id:         '12',
					name:       '12',
					scope:      LocalScope,
					when:       'always',
					exitPoints: [ '10' ],
					subflow:    {
						out:               [],
						unknownReferences: [],
						in:                [],
						scope:             LocalScope,
						graph:             new Set(['10', '1', '8']),
						environments:      withXParameterInOuter
					}
				})
				.addEdge('0', '12', EdgeType.DefinedBy, 'always')

				.addVertex({ tag: 'use', id: '10', name: 'x', environment: withXParameterInOuter }, false)
				.definesVariable('1', 'x', LocalScope, 'always', pushLocalEnvironment(initializeCleanEnvironments()), false)
				.addVertex({
					tag:         'function-definition',
					id:          '8',
					name:        '8',
					environment: pushLocalEnvironment(initializeCleanEnvironments()),
					scope:       LocalScope,
					when:        'always',
					exitPoints:  [ '6' ],
					subflow:     {
						out:               [],
						unknownReferences: [],
						in:                [{
							nodeId: '5',
							scope:  LocalScope,
							name:   'x',
							used:   'always'
						}],
						scope:        LocalScope,
						graph:        new Set(['5', '4', '2']),
						environments: withinNestedFunctionWithDef
					}
				}, false)
				.reads('10', '1')
				.addEdge('1', '8', EdgeType.DefinedBy, 'always')

				.addVertex({ tag: 'use', id: '5', name: 'b', environment: withinNestedFunctionWithParam }, false)
				.addVertex({ tag: 'exit-point', id: '6', name: '<-', environment: withinNestedFunctionWithDef }, false)
				.addEdge('6', '4', EdgeType.Relates, 'always')
				.addEdge('6', '5', EdgeType.Relates, 'always')
				.definesVariable('4', 'x', LocalScope, 'always', withinNestedFunctionWithParam, false)
				.definesVariable('2', 'x', LocalScope, 'always', withinNestedFunctionWithoutParam, false)
				.addEdge('4', '5', EdgeType.DefinedBy, 'always')
				.addEdge('2', '4', EdgeType.SameDefDef, 'always')
		)
	})
}))
