import type { RNode } from '../../../r-bridge/lang-4.x/ast/model/model';
import type { ParentInformation } from '../../../r-bridge/lang-4.x/ast/model/processing/decorate';
import { RType } from '../../../r-bridge/lang-4.x/ast/model/type';
import { Identifier } from '../../../dataflow/environments/identifier';
import { vectorLogger } from '../logger';

export type VectorFunctionType = 'concatenate' | 'arithmetic' | 'length' | 'random' | 'sequence' | 'unknown';

/**
 * Detects the type of vector function from an AST node.
 * @param node - The AST node to analyze
 * @returns The detected function type
 */
export function detectVectorFunctionType(node: RNode<ParentInformation>): VectorFunctionType {
	if(node.type !== RType.FunctionCall && node.type !== RType.BinaryOp && node.type !== RType.UnaryOp) {
		vectorLogger.debug(`Decision: function type 'unknown' for node type '${node.type}'`);
		return 'unknown';
	}

	let functionName: string | undefined;
	if(node.type === RType.FunctionCall) {
		if(node.named) {
			functionName = Identifier.getName(node.functionName.content);
		}
	} else {
		functionName = node.operator;
	}

	if(functionName === undefined) {
		vectorLogger.debug(`Decision: function type 'unknown' for node type '${node.type}' (no function name)`);
		return 'unknown';
	}

	if(functionName === 'c') {
		vectorLogger.debug(`Decision: function type 'concatenate' for node type '${node.type}'`);
		return 'concatenate';
	}
	if(['+', '-', '*', '/'].includes(functionName)) {
		vectorLogger.debug(`Decision: function type 'arithmetic' for node type '${node.type}'`);
		return 'arithmetic';
	}
	if(functionName === 'length') {
		vectorLogger.debug(`Decision: function type 'length' for node type '${node.type}'`);
		return 'length';
	}
	if(['runif', 'rnorm', 'rbinom', 'rexp', 'rpois'].includes(functionName)) {
		vectorLogger.debug(`Decision: function type 'random' for node type '${node.type}'`);
		return 'random';
	}
	if(functionName === ':') {
		vectorLogger.debug(`Decision: function type 'sequence' for node type '${node.type}'`);
		return 'sequence';
	}

	vectorLogger.debug(`Decision: function type 'unknown' for node type '${node.type}' (functionName='${functionName}')`);
	return 'unknown';
}
