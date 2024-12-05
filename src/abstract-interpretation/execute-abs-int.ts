import type { NormalizedAst } from '../r-bridge/lang-4.x/ast/model/processing/decorate';
import { SignAnalysis } from './analysis/nonrelational/value/sign/sign-analysis';

export function areResultsEqual(
	result1: AbstractInterpretationResults,
	result2: AbstractInterpretationResults
): boolean {
	if(result1.points.length !== result2.points.length) {
		return false;
	}
  
	for(let i = 0; i < result1.points.length; i++) {
		const point1 = result1.points[i];
		const point2 = result2.points[i];
  
		if(point1.programPoint !== point2.programPoint) {
			return false;
		}
  
		const env1Keys = Object.keys(point1.environment);
		const env2Keys = Object.keys(point2.environment);
  
		if(env1Keys.length !== env2Keys.length) {
			return false;
		}
  
		for(const key of env1Keys) {
			if(point1.environment[key] !== point2.environment[key]) {
				return false;
			}
		}
	}
  
	return true;
}

export interface AbstractInterpretationResult {
	programPoint: string;
	environment:  Record<string, string>; 
}
  
export interface AbstractInterpretationResults {
	points: AbstractInterpretationResult[];
}

export function executeAbsInt(normalizedAST: NormalizedAst, _input: string): Readonly<AbstractInterpretationResults> {

	const signAnalysis = new SignAnalysis();
	signAnalysis.fold(normalizedAST.ast);

	return signAnalysis.getResults();
	
}
