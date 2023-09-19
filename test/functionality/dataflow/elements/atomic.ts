/**
 * Here we cover dataflow extraction for atomic statements (no expression lists).
 * Yet, some constructs (like for-loops) require the combination of statements, they are included as well.
 * This will not include functions!
 */
import { assertDataflow, withShell } from '../../helper/shell'
import { DataflowGraph, EdgeType, initializeCleanEnvironments } from '../../../../src/dataflow'
import { RAssignmentOpPool, RNonAssignmentBinaryOpPool, RUnaryOpPool } from '../../helper/provider'
import { appendEnvironments, define } from '../../../../src/dataflow/environments'
import { UnnamedArgumentPrefix } from '../../../../src/dataflow/internal/process/functions/argument'
import { GlobalScope, LocalScope } from '../../../../src/dataflow/environments/scopes'
import { MIN_VERSION_PIPE } from '../../../../src/r-bridge/lang-4.x/ast/model/versions'

describe("Atomic dataflow information", withShell((shell) => {
	describe("uninteresting leafs", () => {
		for(const input of ["42", '"test"', "TRUE", "NA", "NULL"]) {
			assertDataflow(input, shell, input, new DataflowGraph())
		}
	})

	assertDataflow("simple variable", shell,
		"xylophone",
		new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "xylophone" })
	)

	describe('access', () => {
		describe('const access', () => {
			assertDataflow('single constant', shell,
				'a[2]',
				new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "a", when: 'maybe' })
					.addVertex({ tag: 'use', id: "2", name: `${UnnamedArgumentPrefix}2` })
					.addEdge("0", "2", EdgeType.Reads, "always")
			)
			assertDataflow('double constant', shell,
				'a[[2]]',
				new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "a", when: 'maybe' })
					.addVertex({ tag: 'use', id: "2", name: `${UnnamedArgumentPrefix}2` })
					.addEdge("0", "2", EdgeType.Reads, "always")
			)
			assertDataflow('dollar constant', shell,
				'a$b',
				new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "a", when: 'maybe' })
			)
			assertDataflow('at constant', shell,
				'a@b',
				new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "a", when: 'maybe' })
			)
			assertDataflow('chained constant', shell,
				'a[2][3]',
				new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "a", when: 'maybe' })
					.addVertex({ tag: 'use', id: "2", name: `${UnnamedArgumentPrefix}2` })
					.addEdge("0", "2", EdgeType.Reads, "always")
					.addVertex({ tag: 'use', id: "5", name: `${UnnamedArgumentPrefix}5` })
					.addEdge("0", "5", EdgeType.Reads, "always")
			)
			assertDataflow('chained mixed constant', shell,
				'a[2]$a',
				new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "a", when: 'maybe' })
					.addVertex({ tag: 'use', id: "2", name: `${UnnamedArgumentPrefix}2` })
					.addEdge("0", "2", EdgeType.Reads, "always")
			)
		})
		assertDataflow("chained bracket access with variables", shell,
			"a[x][y]",
			new DataflowGraph()
				.addVertex({ tag: 'use', id: "0", name: "a", when: 'maybe'})
				.addVertex({ tag: 'use', id: "1", name: "x" })
				.addVertex({ tag: 'use', id: "4", name: "y" })
				.addVertex({ tag: 'use', id: "2", name: `${UnnamedArgumentPrefix}2` })
				.addVertex({ tag: 'use', id: "5", name: `${UnnamedArgumentPrefix}5` })
				.addEdge("0", "2", EdgeType.Reads, "always")
				.addEdge("0", "5", EdgeType.Reads, "always")
				.addEdge("2", "1", EdgeType.Reads, "always")
				.addEdge("5", "4", EdgeType.Reads, "always")
		)
		assertDataflow("assign on access", shell,
			"a[x] <- 5",
			new DataflowGraph()
				.addVertex({ tag: 'variable-definition', id: "0", name: "a", scope: LocalScope, when: 'maybe' })
				.addVertex({ tag: 'use', id: "1", name: "x" })
				.addVertex({ tag: 'use', id: "2", name: `${UnnamedArgumentPrefix}2` })
				.addEdge("0", "2", EdgeType.Reads, "always")
				.addEdge("2", "1", EdgeType.Reads, "always")
		)
	})

	describe("unary operators", () => {
		for(const opSuite of RUnaryOpPool) {
			describe(`${opSuite.label} operations`, () => {
				for(const op of opSuite.pool) {
					const inputDifferent = `${op.str}x`
					assertDataflow(`${op.str}x`, shell,
						inputDifferent,
						new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "x" })
					)
				}
			})
		}
	})

	// these will be more interesting whenever we have more information on the edges (like modification etc.)
	describe("non-assignment binary operators", () => {
		for(const opSuite of RNonAssignmentBinaryOpPool) {
			describe(`${opSuite.label}`, () => {
				for(const op of opSuite.pool) {
					describe(`${op.str}`, () => {
						const inputDifferent = `x ${op.str} y`
						assertDataflow(`${inputDifferent} (different variables)`,
							shell,
							inputDifferent,
							new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "x" }).addVertex({ tag: 'use', id: "1", name: "y" })
						)

						const inputSame = `x ${op.str} x`
						assertDataflow(`${inputSame} (same variables)`,
							shell,
							inputSame,
							new DataflowGraph()
								.addVertex({ tag: 'use', id: "0", name: "x" })
								.addVertex({ tag: 'use', id: "1", name: "x" })
								.addEdge("0", "1", EdgeType.SameReadRead, "always")
						)
					})
				}
			})
		}
	})

	describe("Pipes", () => {
		describe("Passing one argument", () => {
			assertDataflow("No parameter function", shell, "x |> f()",
				new DataflowGraph()
					.addVertex({ tag: 'use', id: "0", name: "x" })
					.addVertex({
						tag:  'function-call',
						id:   "3",
						name: "f",
						args: [{ name: `${UnnamedArgumentPrefix}1`, scope: LocalScope, nodeId: '1', used: 'always' }]
					})
					.addVertex({ tag: 'use', id: "1", name: `${UnnamedArgumentPrefix}1` })
					.addEdge("3", "1", EdgeType.Argument, "always")
					.addEdge("1", "0", EdgeType.Reads, "always"),
				{ minRVersion: MIN_VERSION_PIPE }
			)
			assertDataflow("Nested calling", shell, "x |> f() |> g()",
				new DataflowGraph()
					.addVertex({ tag: 'use', id: "0", name: "x" })
					.addVertex({
						tag:  'function-call',
						id:   "3",
						name: "f",
						args: [{ name: `${UnnamedArgumentPrefix}1`, scope: LocalScope, nodeId: '1', used: 'always' }]
					})
					.addVertex({
						tag:  'function-call',
						id:   "7",
						name: "g",
						args: [{ name: `${UnnamedArgumentPrefix}5`, scope: LocalScope, nodeId: '5', used: 'always' }]
					})
					.addVertex({ tag: 'use', id: "1", name: `${UnnamedArgumentPrefix}1` })
					.addVertex({ tag: 'use', id: "5", name: `${UnnamedArgumentPrefix}5` })
					.addEdge("3", "1", EdgeType.Argument, "always")
					.addEdge("7", "5", EdgeType.Argument, "always")
					.addEdge("5", "3", EdgeType.Reads, "always")
					.addEdge("1", "0", EdgeType.Reads, "always"),
				{ minRVersion: MIN_VERSION_PIPE }
			)
			assertDataflow("Multi-Parameter function", shell, "x |> f(y,z)",
				new DataflowGraph()
					.addVertex({ tag: 'use', id: "0", name: "x" })
					.addVertex({
						tag:  'function-call',
						id:   "7",
						name: "f",
						args: [
							{ name: `${UnnamedArgumentPrefix}1`, scope: LocalScope, nodeId: '1', used: 'always' },
							{ name: `${UnnamedArgumentPrefix}4`, scope: LocalScope, nodeId: '4', used: 'always' },
							{ name: `${UnnamedArgumentPrefix}6`, scope: LocalScope, nodeId: '6', used: 'always' }
						]
					})
					.addVertex({ tag: 'use', id: "1", name: `${UnnamedArgumentPrefix}1` })
					.addVertex({ tag: 'use', id: "4", name: `${UnnamedArgumentPrefix}4` })
					.addVertex({ tag: 'use', id: "6", name: `${UnnamedArgumentPrefix}6` })
					.addVertex({ tag: 'use', id: "0", name: 'x' })
					.addVertex({ tag: 'use', id: "3", name: 'y' })
					.addVertex({ tag: 'use', id: "5", name: 'z' })
					.addEdge("7", "1", EdgeType.Argument, "always")
					.addEdge("7", "4", EdgeType.Argument, "always")
					.addEdge("7", "6", EdgeType.Argument, "always")
					.addEdge("1", "0", EdgeType.Reads, "always")
					.addEdge("4", "3", EdgeType.Reads, "always")
					.addEdge("6", "5", EdgeType.Reads, "always"),
				{ minRVersion: MIN_VERSION_PIPE }
			)
		})
	})

	describe("assignments", () => {
		for(const op of RAssignmentOpPool) {
			describe(`${op.str}`, () => {
				const scope = op.str.length > 2 ? GlobalScope : LocalScope // love it
				const swapSourceAndTarget = op.str === "->" || op.str === "->>"

				const constantAssignment = swapSourceAndTarget ? `5 ${op.str} x` : `x ${op.str} 5`
				assertDataflow(`${constantAssignment} (constant assignment)`,
					shell,
					constantAssignment,
					new DataflowGraph().addVertex({ tag: 'variable-definition', id: swapSourceAndTarget ? "1" : "0", name: "x", scope })
				)

				const variableAssignment = `x ${op.str} y`
				const dataflowGraph = new DataflowGraph()
				if(swapSourceAndTarget) {
					dataflowGraph
						.addVertex({ tag: 'use', id: "0", name: "x" })
						.addVertex({ tag: 'variable-definition', id: "1", name: "y", scope })
						.addEdge("1", "0", EdgeType.DefinedBy, "always")
				} else {
					dataflowGraph
						.addVertex({ tag: 'variable-definition', id: "0", name: "x", scope })
						.addVertex({ tag: 'use', id: "1", name: "y" })
						.addEdge("0", "1", EdgeType.DefinedBy, "always")
				}
				assertDataflow(`${variableAssignment} (variable assignment)`,
					shell,
					variableAssignment,
					dataflowGraph
				)

				const circularAssignment = `x ${op.str} x`

				const circularGraph = new DataflowGraph()
				if(swapSourceAndTarget) {
					circularGraph
						.addVertex({ tag: 'use', id: "0", name: "x" })
						.addVertex({ tag: 'variable-definition', id: "1", name: "x", scope })
						.addEdge("1", "0", EdgeType.DefinedBy, "always")
				} else {
					circularGraph
						.addVertex({ tag: 'variable-definition', id: "0", name: "x", scope })
						.addVertex({ tag: 'use', id: "1", name: "x" })
						.addEdge("0", "1", EdgeType.DefinedBy, "always")
				}

				assertDataflow(`${circularAssignment} (circular assignment)`,
					shell,
					circularAssignment,
					circularGraph
				)
			})
		}
		describe(`nested assignments`, () => {
			assertDataflow(`"x <- y <- 1"`, shell,
				"x <- y <- 1",
				new DataflowGraph()
					.addVertex({ tag: 'variable-definition', id: "0", name: "x", scope: LocalScope })
					.addVertex({ tag: 'variable-definition', id: "1", name: "y", scope: LocalScope })
					.addEdge("0", "1", EdgeType.DefinedBy, "always")
			)
			assertDataflow(`"1 -> x -> y"`, shell,
				"1 -> x -> y",
				new DataflowGraph()
					.addVertex({ tag: 'variable-definition', id: "1", name: "x", scope: LocalScope })
					.addVertex({ tag: 'variable-definition', id: "3", name: "y", scope: LocalScope })
					.addEdge("3", "1", EdgeType.DefinedBy, "always")
			)
			// still by indirection (even though y is overwritten?)
			assertDataflow(`"x <- 1 -> y"`, shell,
				"x <- 1 -> y",
				new DataflowGraph()
					.addVertex({ tag: 'variable-definition', id: "0", name: "x", scope: LocalScope })
					.addVertex({ tag: 'variable-definition', id: "2", name: "y", scope: LocalScope })
					.addEdge("0", "2", EdgeType.DefinedBy, "always")
			)
			assertDataflow(`"x <- y <- z"`, shell,
				"x <- y <- z",
				new DataflowGraph()
					.addVertex({ tag: 'variable-definition', id: "0", name: "x", scope: LocalScope })
					.addVertex({ tag: 'variable-definition', id: "1", name: "y", scope: LocalScope })
					.addVertex({ tag: 'use', id: "2", name: "z" })
					.addEdge("0", "1", EdgeType.DefinedBy, "always")
					.addEdge("1", "2", EdgeType.DefinedBy, "always")
					.addEdge("0", "2", EdgeType.DefinedBy, "always")
			)
		})

		describe(`known impact assignments`, () => {
			describe('loops return invisible null', () => {
				for(const assignment of [ { str: '<-', defId: ['0','0','0'], readId: ['1','1','1'], swap: false },
					{ str: '<<-', defId: ['0','0','0'], readId: ['1','1','1'], swap: false }, { str: '=', defId: ['0','0','0'], readId: ['1','1','1'], swap: false },
					/* two for parenthesis necessary for precedence */
					{ str: '->', defId: ['3', '4', '7'], readId: ['0','0','0'], swap: true }, { str: '->>', defId: ['3', '4', '7'], readId: ['0','0','0'], swap: true }] ) {
					describe(`${assignment.str}`, () => {
						const scope = assignment.str.length > 2 ? GlobalScope : LocalScope

						for(const wrapper of [(x: string) => x, (x: string) => `{ ${x} }`]) {
							const build = (a: string, b: string) => assignment.swap ? `(${wrapper(b)}) ${assignment.str} ${a}` : `${a} ${assignment.str} ${wrapper(b)}`

							const repeatCode = build('x', 'repeat x')
							assertDataflow(`"${repeatCode}"`, shell, repeatCode, new DataflowGraph()
								.addVertex({ tag: 'variable-definition', id: assignment.defId[0], name: "x", scope })
								.addVertex({ tag: 'use', id: assignment.readId[0], name: "x" })
							)

							const whileCode = build('x', 'while (x) 3')
							assertDataflow(`"${whileCode}"`, shell, whileCode, new DataflowGraph()
								.addVertex({ tag: 'variable-definition', id: assignment.defId[1], name: "x", scope })
								.addVertex({ tag: 'use', id: assignment.readId[1], name: "x" }))

							const forCode = build('x', 'for (x in 1:4) 3')
							assertDataflow(`"${forCode}"`, shell, forCode,
								new DataflowGraph()
									.addVertex({ tag: 'variable-definition', id: assignment.defId[2], name: "x", scope })
									.addVertex({ tag: 'variable-definition', id: assignment.readId[2], name: "x", scope: LocalScope })
							)
						}
					})
				}
			})
		})
		describe('assignment with function call', () => {
			const environmentWithX = define(
				{ name: 'x', nodeId: '4', kind: EdgeType.Argument, definedAt: '4', scope: LocalScope, used: 'always' },
				LocalScope,
				initializeCleanEnvironments()
			)
			assertDataflow(`define call with multiple args should only be defined by the call-return`, shell, `a <- foo(x=3,y,z)`,
				new DataflowGraph()
					.addVertex({ tag: 'variable-definition', id: '0', name: "a", scope: LocalScope })
					.addVertex({
						tag:  'function-call',
						id:   '9',
						name: "foo",
						args: [
							['x', { name: 'x', nodeId: '4', scope: LocalScope, used: 'always' }],
							{ name: `${UnnamedArgumentPrefix}6`, nodeId: '6', scope: LocalScope, used: 'always' },
							{ name: `${UnnamedArgumentPrefix}8`, nodeId: '8', scope: LocalScope, used: 'always' },
						]
					})
					.addVertex({ tag: 'use', id: '4', name: "x" })
					.addVertex({ tag: 'use', id: '5', name: "y", environment: environmentWithX })
					.addVertex({ tag: 'use', id: '6', name: `${UnnamedArgumentPrefix}6`, environment: environmentWithX })
					.addVertex({ tag: 'use', id: '7', name: "z", environment: environmentWithX })
					.addVertex({ tag: 'use', id: '8', name: `${UnnamedArgumentPrefix}8`, environment: environmentWithX })
					.addEdge('0', '9', EdgeType.DefinedBy, 'always')
					.addEdge('9', '4', EdgeType.Argument, 'always')
					.addEdge('9', '6', EdgeType.Argument, 'always')
					.addEdge('9', '8', EdgeType.Argument, 'always')
					.addEdge('6', '5', EdgeType.Reads, 'always')
					.addEdge('8', '7', EdgeType.Reads, 'always')
			)
		})
	})

	describe("if-then-else", () => {
		// spacing issues etc. are dealt with within the parser, however, braces are not allowed to introduce scoping artifacts
		for(const b of [
			{ label: "without braces", func: (x: string) => `${x}` },
			{ label: "with braces", func: (x: string) => `{ ${x} }` },
		]) {
			describe(`Variant ${b.label}`, () => {
				describe(`if-then, no else`, () => {
					assertDataflow(`completely constant`, shell,
						`if (TRUE) ${b.func("1")}`,
						new DataflowGraph()
					)
					assertDataflow(`compare cond.`, shell,
						`if (x > 5) ${b.func("1")}`,
						new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "x" })
					)
					assertDataflow(`compare cond. symbol in then`, shell,
						`if (x > 5) ${b.func("y")}`,
						new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "x" })
							.addVertex({ tag: 'use', id: "3", name: "y", when: 'maybe' })
					)
					assertDataflow(`all variables`, shell,
						`if (x > y) ${b.func("z")}`,
						new DataflowGraph()
							.addVertex({ tag: 'use', id: "0", name: "x" })
							.addVertex({ tag: 'use', id: "1", name: "y" })
							.addVertex({ tag: 'use', id: "3", name: "z", when: 'maybe' })
					)
					assertDataflow(`all variables, some same`, shell,
						`if (x > y) ${b.func("x")}`,
						new DataflowGraph()
							.addVertex({ tag: 'use', id: "0", name: "x" })
							.addVertex({ tag: 'use', id: "1", name: "y" })
							.addVertex({ tag: 'use', id: "3", name: "x", when: 'maybe' })
							.addEdge("0", "3", EdgeType.SameReadRead, "maybe")
					)
					assertDataflow(`all same variables`, shell,
						`if (x > x) ${b.func("x")}`,
						new DataflowGraph()
							.addVertex({ tag: 'use', id: "0", name: "x" })
							.addVertex({ tag: 'use', id: "1", name: "x" })
							.addVertex({ tag: 'use', id: "3", name: "x", when: 'maybe' })
							.addEdge("0", "1", EdgeType.SameReadRead, "always")
							// theoretically, they just have to be connected, so 0 is just hardcoded
							.addEdge("0", "3", EdgeType.SameReadRead, "maybe")
					)
					assertDataflow(`definition in if`, shell,
						`if (x <- 3) ${b.func("x")}`,
						new DataflowGraph()
							.addVertex({ tag: 'variable-definition', id: "0", name: "x", scope: LocalScope, when: 'always' })
							.addVertex({ tag: 'use', id: "3", name: "x", when: 'maybe', environment: define({ name: 'x', definedAt: '2', used: 'always', kind: 'variable', scope: LocalScope, nodeId: '0'}, LocalScope, initializeCleanEnvironments())  })
							.addEdge("3", "0", EdgeType.Reads, "always")
					)
				})

				describe(`if-then, with else`, () => {
					assertDataflow(`completely constant`, shell,
						"if (TRUE) { 1 } else { 2 }",
						new DataflowGraph()
					)
					assertDataflow(`compare cond.`, shell,
						"if (x > 5) { 1 } else { 42 }",
						new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "x" })
					)
					assertDataflow(`compare cond. symbol in then`, shell,
						"if (x > 5) { y } else { 42 }",
						new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "x" }).addVertex({ tag: 'use', id: "3", name: "y", when: 'maybe' })
					)
					assertDataflow(`compare cond. symbol in then & else`, shell,
						"if (x > 5) { y } else { z }",
						new DataflowGraph()
							.addVertex({ tag: 'use', id: "0", name: "x" })
							.addVertex({ tag: 'use', id: "3", name: "y", when: 'maybe' })
							.addVertex({ tag: 'use', id: "5", name: "z", when: 'maybe' })
					)
					assertDataflow(`all variables`, shell,
						"if (x > y) { z } else { a }",
						new DataflowGraph()
							.addVertex({ tag: 'use', id: "0", name: "x" })
							.addVertex({ tag: 'use', id: "1", name: "y" })
							.addVertex({ tag: 'use', id: "3", name: "z", when: 'maybe' })
							.addVertex({ tag: 'use', id: "5", name: "a", when: 'maybe' })
					)
					assertDataflow(`all variables, some same`, shell,
						"if (y > x) { x } else { y }",
						new DataflowGraph()
							.addVertex({ tag: 'use', id: "0", name: "y" })
							.addVertex({ tag: 'use', id: "1", name: "x" })
							.addVertex({ tag: 'use', id: "3", name: "x", when: 'maybe' })
							.addVertex({ tag: 'use', id: "5", name: "y", when: 'maybe' })
							.addEdge("1", "3", EdgeType.SameReadRead, "maybe")
							.addEdge("0", "5", EdgeType.SameReadRead, "maybe")
					)
					assertDataflow(`all same variables`, shell,
						"if (x > x) { x } else { x }",
						new DataflowGraph()
							.addVertex({ tag: 'use', id: "0", name: "x" })
							.addVertex({ tag: 'use', id: "1", name: "x" })
							.addVertex({ tag: 'use', id: "3", name: "x", when: 'maybe' })
							.addVertex({ tag: 'use', id: "5", name: "x", when: 'maybe' })
							// 0 is just hardcoded, they actually just have to be connected
							.addEdge("0", "1", EdgeType.SameReadRead, "always")
							.addEdge("0", "3", EdgeType.SameReadRead, "maybe")
							.addEdge("0", "5", EdgeType.SameReadRead, "maybe")
					)
				})
			})
		}
	})
	describe("inline non-strict boolean operations", () => {
		const environmentWithY = define(
			{ name: 'y', nodeId: '0', kind: 'variable', definedAt: '2', scope: LocalScope, used: 'always' },
			LocalScope,
			initializeCleanEnvironments()
		)
		const environmentWithOtherY = define(
			{ name: 'y', nodeId: '4', kind: 'variable', definedAt: '6', scope: LocalScope, used: 'always' },
			LocalScope,
			initializeCleanEnvironments()
		)
		assertDataflow(`define call with multiple args should only be defined by the call-return`, shell, `y <- 15; x && (y <- 13); y`,
			new DataflowGraph()
				.addVertex({ id: '0', tag: 'variable-definition', name: 'y', scope: LocalScope })
				.addVertex({ id: '4', tag: 'variable-definition', name: 'y', scope: LocalScope, environment: environmentWithY })
				.addVertex({ id: '3', tag: 'use', name: 'x', scope: LocalScope, environment: environmentWithY })
				.addVertex({ id: '8', tag: 'use', name: 'y', scope: LocalScope, environment: appendEnvironments(environmentWithY, environmentWithOtherY) })
				.addEdge('8', '0', EdgeType.Reads, 'always')
				.addEdge('8', '4', EdgeType.Reads, 'always')
				.addEdge('0', '4', EdgeType.SameDefDef, 'always')
		)
	})

	describe('loops', () => {
		describe("for", () => {
			assertDataflow("simple constant for-loop", shell,
				`for(i in 1:10) { 1 }`,
				new DataflowGraph().addVertex({ tag: 'variable-definition', id: "0", name: "i", scope: LocalScope })
			)
			assertDataflow("using loop variable in body", shell,
				`for(i in 1:10) { i }`,
				new DataflowGraph()
					.addVertex({ tag: 'variable-definition', id: "0", name: "i", scope: LocalScope })
					.addVertex({ tag: 'use', id: "4", name: "i", when: 'maybe', environment: define({ name: 'i', definedAt: '6', used: 'always', kind: 'variable', scope: LocalScope, nodeId: '0'}, LocalScope, initializeCleanEnvironments()) })
					.addEdge("4", "0", EdgeType.Reads, "maybe")
			)
		})

		describe("repeat", () => {
			assertDataflow("simple constant repeat", shell,
				`repeat 2`,
				new DataflowGraph()
			)
			assertDataflow("using loop variable in body", shell,
				`repeat x`,
				new DataflowGraph().addVertex({ tag: 'use', id: "0", name: "x" })
			)
			assertDataflow("using loop variable in body", shell,
				`repeat { x <- 1 }`,
				new DataflowGraph().addVertex({ tag: 'variable-definition', id: "0", name: "x", scope: LocalScope })
			)
			assertDataflow("using variable in body", shell,
				`repeat { x <- y }`,
				new DataflowGraph()
					.addVertex({ tag: 'variable-definition', id: "0", name: "x", scope: LocalScope })
					.addVertex({ tag: 'use', id: "1", name: "y" })
					.addEdge("0", "1", EdgeType.DefinedBy, "always")
			)
		})

		describe("while", () => {
			assertDataflow("simple constant while", shell,
				`while (TRUE) 2`,
				new DataflowGraph()
			)
			assertDataflow("using variable in body", shell,
				`while (TRUE) x`,
				new DataflowGraph().addVertex({ tag: 'use', id: "1", name: "x", when: 'maybe' })
			)
			assertDataflow("assignment in loop body", shell,
				`while (TRUE) { x <- 3 }`,
				new DataflowGraph().addVertex({ tag: 'variable-definition', id: "1", name: "x", scope: LocalScope, when: 'maybe' })
			)
			assertDataflow('def compare in loop', shell, `while ((x <- x - 1) > 0) { x }`,
				new DataflowGraph()
					.addVertex({ tag: 'variable-definition', id: '0', name: 'x', scope: LocalScope })
					.addVertex({ tag: 'use', id: '1', name: 'x' })
					.addVertex({ tag: 'use', id: '7', name: 'x', when: 'maybe', environment: define({ name: 'x', nodeId: '0', definedAt: '4', used: 'always', kind: 'variable', scope: LocalScope }, LocalScope, initializeCleanEnvironments()) })
					.addEdge('7', '0', EdgeType.Reads, 'maybe')
					.addEdge('0', '1', EdgeType.DefinedBy, 'always')
			)
		})
	})
}))