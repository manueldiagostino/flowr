import type { RNode } from '../../../r-bridge/lang-4.x/ast/model/model';
import type { ParentInformation } from '../../../r-bridge/lang-4.x/ast/model/processing/decorate';
import { RType } from '../../../r-bridge/lang-4.x/ast/model/type';
import { Identifier } from '../../../dataflow/environments/identifier';
import { vectorLogger } from '../logger';
import type { VectorAttr } from '../../domains/vector-attr-domain';

export type VectorFunctionType = 'concatenate' | 'arithmetic' | 'length' | 'random' | 'sequence' | 'unknown';

/**
 * The set of attribute setter function names (e.g., 'names&lt;-', 'dim&lt;-', 'class&lt;-', 'other&lt;-')
 */
export const VectorAttrSetters = ['names<-', 'dim<-', 'class<-', 'other<-'] as const;

export type VectorAttrSetter = typeof VectorAttrSetters[number];

/**
 * Pattern to match any attribute setter function (ending with the assignment operator)
 */
const AttrSetterPattern = /^(\w+)<-$/;

/**
 * Checks if a function name is an attribute setter.
 * Matches explicit setters (names, dim, class, other with assignment suffix) or any pattern ending with assignment.
 */
export function isAttributeSetter(name: string): name is VectorAttrSetter {
	return VectorAttrSetters.includes(name as VectorAttrSetter) || AttrSetterPattern.test(name);
}

/**
 * Maps an attribute setter function name to the corresponding VectorAttr.
 * Unknown setters (not in VectorAttrSetters) fall back to 'other'.
 */
export function attrSetterToAttr(setter: string): VectorAttr {
	// Check if it's a known setter
	if(VectorAttrSetters.includes(setter as VectorAttrSetter)) {
		// Remove the assignment suffix to get the attribute name
		return setter.slice(0, -2) as VectorAttr;
	}
	// Fallback: any other setter pattern maps to 'other'
	return 'other';
}

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
