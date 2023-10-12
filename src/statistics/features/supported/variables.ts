import { Feature, FeatureProcessorInput } from '../feature'
import { Writable } from 'ts-essentials'
import { isSpecialSymbol, NodeId, RType, visitAst } from '../../../r-bridge'
import { appendStatisticsFile } from '../../output'
import { EdgeType } from '../../../dataflow'


const initialVariableInfo = {
	numberOfVariableUses:  0,
	numberOfDefinitions:   0,
	numberOfRedefinitions: 0,
	// we failed to get the type/role, should be 0 :D
	unknownVariables:      0
}

export type VariableInfo = Writable<typeof initialVariableInfo>


function visitVariables(info: VariableInfo, input: FeatureProcessorInput): void {

	// same-def-def edges are bidirectional, we want to avoid counting them twice!
	const redefinedBlocker = new Set<NodeId>()

	visitAst(input.normalizedRAst.ast,
		node => {
			if(node.type !== RType.Symbol || isSpecialSymbol(node)) {
				return
			}

			// search for the node in the DF graph
			const mayNode = input.dataflow.graph.get(node.info.id)

			if(mayNode === undefined) {
				info.unknownVariables++
				return
			}

			const [dfNode, edges] = mayNode
			if(dfNode.tag === 'variable-definition') {
				info.numberOfDefinitions++
				const lexeme = node.info.fullLexeme ?? node.lexeme
				appendStatisticsFile(variables.name, 'definedVariables', [{
					name:     lexeme,
					location: node.location.start
				}], input.filepath)
				// check for redefinitions
				const hasRedefinitions = [...edges.entries()].some(([target, edge]) => !redefinedBlocker.has(target) && edge.types.has(EdgeType.SameDefDef))
				if(hasRedefinitions) {
					info.numberOfRedefinitions++
					redefinedBlocker.add(node.info.id)
					appendStatisticsFile(variables.name, 'redefinedVariables', [{
						name:     lexeme,
						location: node.location.start
					}], input.filepath)
				}
			} else if(dfNode.tag === 'use') {
				info.numberOfVariableUses++
				appendStatisticsFile(variables.name, 'usedVariables', [{
					name:     node.info.fullLexeme ?? node.lexeme,
					location: node.location.start
				}], input.filepath)
			}
		}
	)
}


export const variables: Feature<VariableInfo> = {
	name:        'Variables',
	description: 'Variable Usage, Assignments, and Redefinitions',

	process(existing: VariableInfo, input: FeatureProcessorInput): VariableInfo {
		visitVariables(existing, input)
		return existing
	},

	initialValue: initialVariableInfo
}