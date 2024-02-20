import { DataflowGraph, diffGraphsToMermaidUrl, EdgeType } from '../../../../src/dataflow'
import { assert } from 'chai'

function test(cmp: (x: boolean) => void, a: DataflowGraph, b: DataflowGraph, text: string) {
	try {
		cmp(a.equals(b))
	} catch(e) {
		// only calculate the dataflow graphs if it fails
		const diff = diffGraphsToMermaidUrl({ label: 'left', graph: a }, { label: 'right', graph: b }, undefined, '')
		console.error(text + '; diff:\n', diff)
		throw e
	}
}

describe('Equal', () => {
	const raw = (name: string, a: DataflowGraph, b: DataflowGraph, text: string, cmp: (x: boolean) => void) => {
		return it(name, () => {
			// as the comparison is relatively quick, we allow explicit checks for commutativity
			test(cmp, a, b, 'a;b' + text)
			test(cmp, b, a, 'b;a' + text)
		})
	}

	describe('Positive', () => {
		const eq = (name: string, a: DataflowGraph, b: DataflowGraph) => {
			raw(name, a, b, 'should be equal', x => assert.isTrue(x))
		}

		eq('Empty graphs', new DataflowGraph(), new DataflowGraph())
		eq('Same vertex', new DataflowGraph().uses('0', 'x'), new DataflowGraph().uses('0', 'x'))
	})
	describe('Negative', () => {
		const neq = (name: string, a: DataflowGraph, b: DataflowGraph) => {
			raw(name, a, b, 'should differ', x => assert.isFalse(x))
		}
		describe('More elements', () => {
			neq('Additional root vertex', new DataflowGraph(), new DataflowGraph().uses('0', 'x'))
			neq('Additional non-root vertex', new DataflowGraph(), new DataflowGraph().uses('0', 'x', undefined, undefined, false))
			neq('Additional edge', new DataflowGraph(), new DataflowGraph().reads('0', '1', 'always'))
		})
		describe('Different elements', () => {
			describe('Different vertices', () => {
				const rhs = new DataflowGraph().uses('0', 'x')
				neq('Id', new DataflowGraph().uses('1', 'x'), rhs)
				neq('Name', new DataflowGraph().uses('0', 'y'), rhs)
				neq('Tag', new DataflowGraph().addVertex({ id: '0', name: 'x', tag: 'exit-point' }), rhs)
			})
			describe('Different edges', () => {
				const rhs = new DataflowGraph().reads('0', '1', 'always')
				neq('Source Id', new DataflowGraph().reads('2', '1', 'always'), rhs)
				neq('Target Id', new DataflowGraph().reads('0', '2', 'always'), rhs)
				neq('Type', new DataflowGraph().addEdge('0', '1', EdgeType.Calls, 'always'), rhs)
				neq('Attribute', new DataflowGraph().reads('0', '1', 'maybe'), rhs)
			})
		})
	})
})
