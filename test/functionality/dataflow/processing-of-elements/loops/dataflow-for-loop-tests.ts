import { assertDataflow, withShell } from '../../../_helper/shell'
import { emptyGraph } from '../../../_helper/dataflow/dataflowgraph-builder'
import { argumentInCall, defaultEnv } from '../../../_helper/dataflow/environment-builder'
import { BuiltIn } from '../../../../../src/dataflow'
import { EmptyArgument, OperatorDatabase } from '../../../../../src'
import { label } from '../../../_helper/label'

describe('for', withShell(shell => {
	assertDataflow(label('Single-vector for Loop', ['for-loop', 'name-normal', 'numbers']),
		shell, 'for(i in 0) i',  emptyGraph()
			.use('2', { controlDependencies: [] })
			.reads('2', '0')
			.argument('4', '2')
			.call('4', [argumentInCall('0'), argumentInCall('1'), argumentInCall('2')], { returns: [], reads: ['0', '1', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('i', '0', '4') })
			.argument('4', ['0', '1'])
			.nse('4', '2')
			.defineVariable('0', { definedBy: ['1'] })
			.constant('1')
	)

	describe('Potential redefinition with break', () => {
		assertDataflow(label('Potential redefinition inside the same loop', ['repeat-loop', 'name-normal', ...OperatorDatabase['<-'].capabilities, 'numbers', 'if', 'break']),
			shell,
			`repeat {
  x <- 2
  if(z) break
  x <- 3
}
x`, emptyGraph()
				.use('5')
				.use('14')
				.reads('14', ['2', '9'])
				.call('4', [argumentInCall('2'), argumentInCall('3')], { returns: ['2'], reads: [BuiltIn] })
				.call('6', [], { returns: [], reads: [BuiltIn], controlDependency: ['8'], environment: defaultEnv().defineVariable('x', '2', '4') })
				.call('8', [argumentInCall('5'), argumentInCall('6'), EmptyArgument], { returns: ['6'], reads: [BuiltIn, '5'], onlyBuiltIn: true, environment: defaultEnv().defineVariable('x', '2', '4') })
				.call('11', [argumentInCall('9'), argumentInCall('10')], { returns: ['9'], reads: [BuiltIn], controlDependency: [], environment: defaultEnv().defineVariable('x', '2', '4') })
				.call('12', [argumentInCall('4'), argumentInCall('8'), argumentInCall('11')], { returns: ['11'], reads: [BuiltIn], environment: defaultEnv().defineVariable('x', '2', '4').defineVariable('x', '9', '11', []) })
				.call('13', [argumentInCall('12')], { returns: [], reads: [BuiltIn] })
				.nse('13', '12')
				.constant('3')
				.defineVariable('2', { definedBy: ['3', '4'] })
				.constant('10')
				.defineVariable('9', { definedBy: ['10', '11'], controlDependency: [] })
		)
	})

	assertDataflow(label('Read in for Loop', ['name-normal', ...OperatorDatabase['<-'].capabilities, 'numbers', 'newlines', 'for-loop']), shell, 'x <- 12\nfor(i in 1:10) x ', emptyGraph()
		.use('7', { controlDependencies: [] })
		.reads('7', '0')
		.call('2', [argumentInCall('0'), argumentInCall('1')], { returns: ['0'], reads: [BuiltIn] })
		.call('6', [argumentInCall('4'), argumentInCall('5')], { returns: [], reads: ['4', '5', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('x', '0', '2') })
		.call('9', [argumentInCall('3'), argumentInCall('6'), argumentInCall('7')], { returns: [], reads: ['3', '6', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('x', '0', '2').defineVariable('i', '3', '9') })
		.nse('9', '7')
		.constant('1')
		.defineVariable('0', { definedBy: ['1', '2'] })
		.defineVariable('3', { definedBy: ['6'] })
		.constant('4')
		.constant('5')
	)
	assertDataflow(label('Read after for loop', ['for-loop', 'name-normal', ...OperatorDatabase['<-'].capabilities, 'numbers', 'newlines']), shell, 'for(i in 1:10) { x <- 12 }\n x', emptyGraph()
		.use('11')
		.reads('11', '6')
		.call('3', [argumentInCall('1'), argumentInCall('2')], { returns: [], reads: ['1', '2', BuiltIn], onlyBuiltIn: true })
		.call('8', [argumentInCall('6'), argumentInCall('7')], { returns: ['6'], reads: [BuiltIn], controlDependency: [] })
		.call('9', [argumentInCall('8')], { returns: ['8'], reads: [BuiltIn], controlDependency: [] })
		.call('10', [argumentInCall('0'), argumentInCall('3'), argumentInCall('9')], { returns: [], reads: ['0', '3', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('i', '0', '10') })
		.nse('10', '9')
		.defineVariable('0', { definedBy: ['3'] })
		.constant('1')
		.constant('2')
		.constant('7', { controlDependency: ['10'] })
		.defineVariable('6', { definedBy: ['7', '8'], controlDependency: [] })
	)


	assertDataflow(label('Read after for loop with outer def', ['name-normal', ...OperatorDatabase['<-'].capabilities, 'numbers', 'newlines', 'for-loop']), shell, 'x <- 9\nfor(i in 1:10) { x <- 12 }\n x',  emptyGraph()
		.use('14')
		.reads('14', ['0', '9'])
		.call('2', [argumentInCall('0'), argumentInCall('1')], { returns: ['0'], reads: [BuiltIn] })
		.call('6', [argumentInCall('4'), argumentInCall('5')], { returns: [], reads: ['4', '5', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('x', '0', '2') })
		.call('11', [argumentInCall('9'), argumentInCall('10')], { returns: ['9'], reads: [BuiltIn], controlDependency: [] })
		.call('12', [argumentInCall('11')], { returns: ['11'], reads: [BuiltIn], controlDependency: [] })
		.call('13', [argumentInCall('3'), argumentInCall('6'), argumentInCall('12')], { returns: [], reads: ['3', '6', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('x', '0', '2', []).defineVariable('x', '9', '11', []).defineVariable('i', '3', '13') })
		.nse('13', '12')
		.constant('1')
		.defineVariable('0', { definedBy: ['1', '2'] })
		.defineVariable('3', { definedBy: ['6'] })
		.constant('4')
		.constant('5')
		.constant('10', { controlDependency: ['13'] })
		.defineVariable('9', { definedBy: ['10', '11'], controlDependency: [] })
	)
	assertDataflow(label('redefinition within loop', ['name-normal', ...OperatorDatabase['<-'].capabilities, 'numbers', 'newlines', 'for-loop']), shell, 'x <- 9\nfor(i in 1:10) { x <- x }\n x',  emptyGraph()
		.use('10', { controlDependencies: [] })
		.reads('10', ['9', '0'])
		.use('14')
		.reads('14', ['0', '9'])
		.call('2', [argumentInCall('0'), argumentInCall('1')], { returns: ['0'], reads: [BuiltIn] })
		.call('6', [argumentInCall('4'), argumentInCall('5')], { returns: [], reads: ['4', '5', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('x', '0', '2') })
		.call('11', [argumentInCall('9'), argumentInCall('10')], { returns: ['9'], reads: [BuiltIn], controlDependency: [] })
		.call('12', [argumentInCall('11')], { returns: ['11'], reads: [BuiltIn], controlDependency: [] })
		.call('13', [argumentInCall('3'), argumentInCall('6'), argumentInCall('12')], { returns: [], reads: ['3', '6', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('x', '0', '2', []).defineVariable('x', '9', '11', []).defineVariable('i', '3', '13') })
		.nse('13', '12')
		.constant('1')
		.defineVariable('0', { definedBy: ['1', '2'] })
		.defineVariable('3', { definedBy: ['6'] })
		.constant('4')
		.constant('5')
		.defineVariable('9', { definedBy: ['10', '11'], controlDependency: [] })
	)

	assertDataflow(label('double redefinition within loop', ['name-normal', ...OperatorDatabase['<-'].capabilities, 'numbers', 'newlines', 'for-loop', 'semicolons']), shell, 'x <- 9\nfor(i in 1:10) { x <- x; x <- x }\n x', emptyGraph()
		.use('10', { controlDependencies: [] })
		.reads('10', ['12', '0'])
		.use('13', { controlDependencies: ['16'] })
		.reads('13', '9')
		.use('17')
		.reads('17', ['0', '9', '12'])
		.call('2', [argumentInCall('0'), argumentInCall('1')], { returns: ['0'], reads: [BuiltIn] })
		.call('6', [argumentInCall('4'), argumentInCall('5')], { returns: [], reads: ['4', '5', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('x', '0', '2') })
		.call('11', [argumentInCall('9'), argumentInCall('10')], { returns: ['9'], reads: [BuiltIn], controlDependency: [] })
		.call('14', [argumentInCall('12'), argumentInCall('13')], { returns: ['12'], reads: [BuiltIn], controlDependency: [], environment: defaultEnv().defineVariable('x', '9', '11', ['16']) })
		.call('15', [argumentInCall('11'), argumentInCall('14')], { returns: ['14'], reads: [BuiltIn], controlDependency: [], environment: defaultEnv().defineVariable('x', '9', '11', ['16']) })
		.call('16', [argumentInCall('3'), argumentInCall('6'), argumentInCall('15')], { returns: [], reads: ['3', '6', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('x', '0', '2', []).defineVariable('x', '9', '11', []).defineVariable('x', '12', '14', []).defineVariable('i', '3', '16') })
		.nse('16', '15')
		.constant('1')
		.defineVariable('0', { definedBy: ['1', '2'] })
		.defineVariable('3', { definedBy: ['6'] })
		.constant('4')
		.constant('5')
		.defineVariable('9', { definedBy: ['10', '11'], controlDependency: [] })
		.defineVariable('12', { definedBy: ['13', '14'], controlDependency: [] })
	)

	assertDataflow(label('loop-variable redefined within loop', ['name-normal', 'for-loop', 'semicolons', 'newlines', 'numbers']), shell, 'for(i in 1:10) { i; i <- 12 }\n i', emptyGraph()
		.use('6', { controlDependencies: [] })
		.reads('6', '0')
		.use('12')
		.reads('12', ['0', '7'])
		.call('3', [argumentInCall('1'), argumentInCall('2')], { returns: [], reads: ['1', '2', BuiltIn], onlyBuiltIn: true })
		.call('9', [argumentInCall('7'), argumentInCall('8')], { returns: ['7'], reads: [BuiltIn], controlDependency: [] })
		.call('10', [argumentInCall('6'), argumentInCall('9')], { returns: ['9'], reads: [BuiltIn], controlDependency: [] })
		.call('11', [argumentInCall('0'), argumentInCall('3'), argumentInCall('10')], { returns: [], reads: ['0', '3', BuiltIn], onlyBuiltIn: true, environment: defaultEnv().defineVariable('i', '0', '11', []).defineVariable('i', '7', '9', []) })
		.nse('11', '10')
		.defineVariable('0', { definedBy: ['3'] })
		.constant('1')
		.constant('2')
		.constant('8', { controlDependency: ['11'] })
		.defineVariable('7', { definedBy: ['8', '9'], controlDependency: [] })
	)
}))
